/**
 * Helheim — Dead Letter Queue for failed Bifrost chunks.
 *
 * Failed chunks are compressed (gzip) and stored in the DB.
 * Exponential backoff retry: 5min → 30min → 2hr, max 3 retries.
 */

import { gzipSync, gunzipSync } from "zlib";
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

export function compressPayload(rows: Record<string, unknown>[]): string {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const compressed = gzipSync(Buffer.from(ndjson, "utf8"));
  return compressed.toString("base64");
}

export function decompressPayload(payload: string): Record<string, unknown>[] {
  const buffer = gunzipSync(Buffer.from(payload, "base64"));
  return buffer
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
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
      payload: compressPayload(rows),
      retryCount: 0,
      maxRetries: DEFAULT_MAX_RETRIES,
      nextRetryAt: getNextRetryAt(0),
      status: "pending",
    },
  });

  return entry.id;
}

// ─── Retry ───────────────────────────────────────────

export async function markRetrying(entryId: string): Promise<void> {
  await prisma.helheimEntry.update({
    where: { id: entryId },
    data: {
      status: "retrying",
      lastRetriedAt: new Date(),
    },
  });
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
