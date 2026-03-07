/**
 * Helheim — Dead Letter Queue for failed Bifrost chunks.
 *
 * Failed chunks are compressed (gzip) and stored in the DB.
 * Exponential backoff retry: 5min → 30min → 2hr, max 3 retries.
 */

import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
import { prisma } from "@/lib/db";
import type { HelheimErrorType } from "../types";
import { DEFAULT_MAX_RETRIES, RETRY_DELAYS_SEC } from "../types";

// ─── Error Classification ────────────────────────────

export function classifyError(error: unknown): HelheimErrorType {
  if (!(error instanceof Error)) return "load_failure";

  const msg = error.message.toLowerCase();

  if (msg.includes("auth") || msg.includes("credential") || msg.includes("permission") || msg.includes("403")) {
    return "auth_failure";
  }
  if (msg.includes("timeout") || msg.includes("deadline") || msg.includes("etimedout")) {
    return "timeout";
  }
  if (msg.includes("transform") || msg.includes("forge") || msg.includes("blueprint")) {
    return "transform_failure";
  }

  return "load_failure";
}

// ─── Retry Scheduling ────────────────────────────────

function getNextRetryAt(currentCount: number): Date {
  const delaySec = RETRY_DELAYS_SEC[Math.min(currentCount, RETRY_DELAYS_SEC.length - 1)];
  return new Date(Date.now() + delaySec * 1000);
}

// ─── Payload Compression ─────────────────────────────

export async function compressPayload(rows: Record<string, unknown>[]): Promise<string> {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const compressed = await gzipAsync(Buffer.from(ndjson, "utf8"));
  return compressed.toString("base64");
}

export async function decompressPayload(payload: string): Promise<Record<string, unknown>[]> {
  const buffer = await gunzipAsync(Buffer.from(payload, "base64"));
  return buffer
    .toString("utf8")
    .split("\n")
    .filter((line: string) => line.length > 0)
    .map((line: string) => JSON.parse(line));
}

// ─── Enqueue ─────────────────────────────────────────

export async function enqueueDeadLetter(
  routeId: string,
  jobId: string,
  chunkIndex: number,
  rows: Record<string, unknown>[],
  error: unknown
): Promise<string> {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  const entry = await prisma.helheimEntry.create({
    data: {
      routeId,
      jobId,
      chunkIndex,
      rowCount: rows.length,
      errorType: classifyError(error),
      errorMessage: errorObj.message,
      errorDetails: extractErrorDetails(error) as any,
      payload: await compressPayload(rows),
      retryCount: 0,
      maxRetries: DEFAULT_MAX_RETRIES,
      nextRetryAt: getNextRetryAt(0),
      status: "pending",
    },
  });

  return entry.id;
}

// ─── Retry ───────────────────────────────────────────

/**
 * Atomically claim a retry entry using optimistic locking.
 * Returns true if this worker claimed it, false if another worker got it first.
 */
export async function claimRetry(entryId: string): Promise<boolean> {
  const result = await prisma.helheimEntry.updateMany({
    where: {
      id: entryId,
      status: { in: ["pending", "retrying"] },
    },
    data: {
      status: "retrying",
      lastRetriedAt: new Date(),
    },
  });
  return result.count > 0;
}

/** @deprecated Use claimRetry() for atomic claim. Kept for backwards compat. */
export async function markRetrying(entryId: string): Promise<void> {
  await claimRetry(entryId);
}

export async function markRecovered(entryId: string): Promise<void> {
  await prisma.helheimEntry.update({
    where: { id: entryId },
    data: { status: "recovered" },
  });
}

export async function markRetryFailed(
  entryId: string,
  currentRetryCount: number,
  maxRetries: number,
  error: unknown
): Promise<void> {
  const newCount = currentRetryCount + 1;
  const exhausted = newCount >= maxRetries;
  const errorObj = error instanceof Error ? error : new Error(String(error));

  await prisma.helheimEntry.update({
    where: { id: entryId },
    data: {
      status: exhausted ? "dead" : "pending",
      retryCount: newCount,
      nextRetryAt: exhausted ? null : getNextRetryAt(newCount),
      errorMessage: errorObj.message,
      lastRetriedAt: new Date(),
    },
  });
}

// ─── Query ───────────────────────────────────────────

export async function getDueRetries(): Promise<
  Array<{ id: string; routeId: string; payload: string; retryCount: number; maxRetries: number }>
> {
  return prisma.helheimEntry.findMany({
    where: {
      OR: [
        // Normal pending retries
        {
          status: "pending",
          nextRetryAt: { lte: new Date() },
        },
        // Recover entries stuck in "retrying" (worker crashed mid-retry)
        {
          status: "retrying",
          lastRetriedAt: { lte: new Date(Date.now() - 5 * 60_000) },
        },
      ],
    },
    select: {
      id: true,
      routeId: true,
      payload: true,
      retryCount: true,
      maxRetries: true,
    },
    take: 100,
  });
}

// ─── Helpers ─────────────────────────────────────────

function extractErrorDetails(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof Error)) return null;

  const details: Record<string, unknown> = {};

  // BigQuery errors often have a response property with detailed info
  if ("errors" in error && Array.isArray((error as Record<string, unknown>).errors)) {
    details.errors = (error as Record<string, unknown>).errors;
  }

  if ("code" in error) {
    details.code = (error as Record<string, unknown>).code;
  }

  if (error.stack) {
    details.stack = error.stack.split("\n").slice(0, 5).join("\n");
  }

  return Object.keys(details).length > 0 ? details : null;
}
