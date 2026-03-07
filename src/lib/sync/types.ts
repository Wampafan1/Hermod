/**
 * Incremental sync types — cursor strategies and watermark tracking.
 */

export type CursorStrategy =
  | "timestamp_cursor"
  | "integer_id_cursor"
  | "rowversion_cursor"
  | "full_refresh";

export type CursorConfidence = "high" | "medium" | "low";

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
