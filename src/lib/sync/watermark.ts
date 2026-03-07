/**
 * Watermark Service — reads and writes per-table watermarks for incremental sync.
 *
 * Called by the BifrostEngine during execution, NOT by detection.
 */

import { prisma } from "@/lib/db";
import type { WatermarkRecord, CursorStrategy } from "./types";

// ─── Read ────────────────────────────────────────────

export async function getWatermark(
  routeId: string,
  tableName: string
): Promise<string | null> {
  const row = await prisma.pipelineWatermark.findUnique({
    where: { routeId_tableName: { routeId, tableName } },
    select: { watermark: true },
  });
  return row?.watermark ?? null;
}

// ─── Write ───────────────────────────────────────────

export async function setWatermark(record: WatermarkRecord): Promise<void> {
  const key = { routeId: record.routeId, tableName: record.tableName };
  await prisma.pipelineWatermark.upsert({
    where: { routeId_tableName: key },
    create: {
      routeId: record.routeId,
      tableName: record.tableName,
      watermark: record.watermark,
      watermarkType: record.watermarkType,
      rowsSynced: record.rowsSynced ?? null,
    },
    update: {
      watermark: record.watermark,
      watermarkType: record.watermarkType,
      rowsSynced: record.rowsSynced ?? null,
      runAt: new Date(),
    },
  });
}

// ─── Query Helpers ───────────────────────────────────

/**
 * Build the WHERE clause fragment for incremental extraction.
 * Returns null for full_refresh or first run (no watermark).
 */
export function buildIncrementalClause(
  cursorColumn: string,
  strategy: CursorStrategy,
  watermark: string | null
): string | null {
  if (strategy === "full_refresh" || !watermark) return null;

  if (strategy === "timestamp_cursor") {
    return `${cursorColumn} > '${watermark}'`;
  }
  if (strategy === "integer_id_cursor") {
    return `${cursorColumn} > ${watermark}`;
  }
  if (strategy === "rowversion_cursor") {
    return `${cursorColumn} > 0x${watermark}`;
  }
  return null;
}

/**
 * Extract the new watermark value from a result set.
 * Returns null if result set is empty or strategy is full_refresh.
 */
export function extractNewWatermark(
  rows: Record<string, unknown>[],
  cursorColumn: string,
  strategy: CursorStrategy
): string | null {
  if (!rows.length || strategy === "full_refresh") return null;

  const values = rows.map((r) => r[cursorColumn]).filter((v) => v != null);
  if (!values.length) return null;

  if (strategy === "timestamp_cursor") {
    const max = values.reduce((a, b) =>
      new Date(a as string) > new Date(b as string) ? a : b
    );
    return new Date(max as string).toISOString();
  }

  if (strategy === "integer_id_cursor") {
    return String(Math.max(...values.map(Number)));
  }

  if (strategy === "rowversion_cursor") {
    const max = values.reduce((a, b) =>
      BigInt(`0x${a}`) > BigInt(`0x${b}`) ? a : b
    );
    return String(max);
  }

  return null;
}
