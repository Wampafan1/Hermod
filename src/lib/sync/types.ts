/**
 * Incremental sync types — cursor strategies and watermark tracking.
 * Types derived from Zod schemas in validations/bifrost.ts (single source of truth).
 */

import type { z } from "zod";
import type { cursorStrategySchema, cursorConfidenceSchema } from "@/lib/validations/bifrost";

export type CursorStrategy = z.infer<typeof cursorStrategySchema>;
export type CursorConfidence = z.infer<typeof cursorConfidenceSchema>;

export interface ColumnSchema {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  isIndexed?: boolean;
}

export interface CursorConfig {
  strategy: CursorStrategy;
  cursorColumn: string | null;
  cursorColumnType: string | null;
  primaryKey: string | null;
  confidence: CursorConfidence;
  reasoning: string;
  warnings: string[];
  candidates: CursorCandidate[];
}

export interface CursorCandidate {
  column: string;
  strategy: CursorStrategy;
  score: number;
  reason: string;
}

export interface WatermarkRecord {
  routeId: string;
  tableName: string;
  watermark: string;
  watermarkType: CursorStrategy;
  rowsSynced?: number;
}
