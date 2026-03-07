// src/lib/sync/index.ts
export { detectCursorStrategy, inferPrimaryKey } from "./cursor-detection";
export { getWatermark, setWatermark, buildIncrementalClause, extractNewWatermark } from "./watermark";
export type {
  CursorStrategy,
  CursorConfidence,
  CursorConfig,
  CursorCandidate,
  ColumnSchema,
  WatermarkRecord,
} from "./types";
