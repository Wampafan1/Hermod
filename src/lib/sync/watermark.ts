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
 * Rejects column names containing SQL injection vectors.
 * Allows Unicode letters/digits (accented, CJK, etc.) but blocks
 * quotes, semicolons, comments, and whitespace.
 */
const UNSAFE_IDENTIFIER_CHARS = /[;"'`\\\/\*\-\s\n\r]/;

function quoteIdentifier(column: string): string {
  if (!column || UNSAFE_IDENTIFIER_CHARS.test(column)) {
    throw new Error(`Invalid cursor column name: "${column}"`);
  }
  return `"${column}"`;
}

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

  const col = quoteIdentifier(cursorColumn);

  if (strategy === "timestamp_cursor") {
    // Strict ISO-8601 validation — rejects lax Date.parse formats like "Tue Jan 01 2024"
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(watermark)) {
      throw new Error(`Invalid timestamp watermark: "${watermark}"`);
    }
    return `${col} > '${watermark}'`;
  }
  if (strategy === "integer_id_cursor") {
    // Validate watermark is a valid integer
    if (!/^\d+$/.test(watermark)) {
      throw new Error(`Invalid integer watermark: "${watermark}"`);
    }
    return `${col} > ${watermark}`;
  }
  if (strategy === "rowversion_cursor") {
    // Validate watermark is a valid hex string
    if (!/^[0-9a-fA-F]+$/.test(watermark)) {
      throw new Error(`Invalid rowversion watermark: "${watermark}"`);
    }
    return `${col} > 0x${watermark}`;
  }
  return null;
}

/** Convert a rowversion value (Buffer or string) to a hex string. */
function toHexString(val: unknown): string {
  if (Buffer.isBuffer(val)) {
    return val.toString("hex");
  }
  return String(val);
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
    // Values may be Date objects (from drivers) or strings — coerce uniformly
    const dates = values
      .map((v) => (v instanceof Date ? v : new Date(String(v))))
      .filter((d) => !isNaN(d.getTime()));
    if (!dates.length) return null;
    const max = dates.reduce((a, b) => (a > b ? a : b));
    return max.toISOString();
  }

  if (strategy === "integer_id_cursor") {
    const nums = values.map(Number).filter((n) => !isNaN(n));
    if (!nums.length) return null;
    return String(Math.max(...nums));
  }

  if (strategy === "rowversion_cursor") {
    const hexValues = values.map(toHexString).filter((h) => /^[0-9a-fA-F]+$/.test(h));
    if (!hexValues.length) return null;
    const max = hexValues.reduce((a, b) =>
      BigInt(`0x${a}`) > BigInt(`0x${b}`) ? a : b
    );
    return max;
  }

  return null;
}
