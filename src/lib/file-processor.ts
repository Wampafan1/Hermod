/**
 * @deprecated Use analyzeFile() from @/lib/duckdb/file-analyzer instead.
 *
 * This file is a compatibility shim. All file analysis now goes through
 * the unified DuckDB pipeline which provides full-dataset profiling
 * (not 100-row sampling) and integrated UCC primary key detection.
 */

// ─── Legacy Types (kept for backward compat) ────────

export interface DetectedSchema {
  columns: Array<{
    name: string;
    inferredType: "string" | "number" | "date" | "boolean";
    nullable: boolean;
    sampleValues: string[];
  }>;
}

export interface ParsedFile {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  detectedSchema: DetectedSchema;
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  typeChanges: Array<{
    column: string;
    was: string;
    now: string;
  }>;
}

// ─── Deprecated functions — throw clear migration errors ──

/** @deprecated Use analyzeFile() from @/lib/duckdb/file-analyzer */
export async function parseFile(
  _buffer: Buffer,
  _fileName: string,
  _mimeType?: string
): Promise<ParsedFile> {
  throw new Error(
    "[file-processor] parseFile() is deprecated. Use analyzeFile() from @/lib/duckdb/file-analyzer instead."
  );
}

/** @deprecated Use computeSchemaDiff() from @/lib/duckdb/schema-diff */
export function detectSchema(
  _columns: string[],
  _rows: Record<string, unknown>[]
): DetectedSchema {
  throw new Error(
    "[file-processor] detectSchema() is deprecated. Use analyzeFile() from @/lib/duckdb/file-analyzer instead."
  );
}

/** @deprecated Use computeSchemaDiff() from @/lib/duckdb/schema-diff */
export function compareSchemas(
  _baseline: DetectedSchema,
  _current: DetectedSchema
): SchemaDiff | null {
  throw new Error(
    "[file-processor] compareSchemas() is deprecated. Use computeSchemaDiff() from @/lib/duckdb/schema-diff instead."
  );
}

/** @deprecated File route execution is handled by the Gate push executor or Bifrost engine */
export async function executeFileRoute(_params: {
  connectionId: string;
  routeId: string;
  rows: Record<string, unknown>[];
  columns: string[];
  fileEntryId: string;
  tenantId: string;
}): Promise<{ success: boolean; rowsLoaded: number; error?: string }> {
  throw new Error(
    "[file-processor] executeFileRoute() is deprecated. Use the Gate push executor or Bifrost engine."
  );
}
