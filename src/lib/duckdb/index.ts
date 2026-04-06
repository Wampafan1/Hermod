// DuckDB Analytical Engine — Nidavellir Foundation
// Barrel export for all public APIs

export { createAnalyticsSession } from "./engine";
export type {
  AnalyticsSession,
  TableInfo,
  TableProfile,
  ColumnInfo,
  ColumnProfile,
  CSVLoadOptions,
  ExcelLoadOptions,
} from "./engine";

export { analyzeCSV, analyzeExcel, analyzeRows, analyzeFile, FileAnalysisError } from "./file-analyzer";
export type { FileAnalysisResult, AnalyzedColumn, FullAnalysisResult } from "./file-analyzer";

export {
  toHermodType,
  toInferredType,
  toPostgresType,
  toBigQueryType,
  toDisplayType,
} from "./type-mapper";
