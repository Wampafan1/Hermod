/**
 * Column configuration — defines how a query column maps to the output spreadsheet.
 * Each entry has a stable UUID that survives reorders and is used to key template formatting.
 */
export interface ColumnConfig {
  /** Stable UUID — survives reorders, used to key template styles */
  id: string;
  /** Source column name from the query result (null for formula-only columns) */
  sourceColumn: string | null;
  /** Display name shown in the header row and Excel output */
  displayName: string;
  /** Whether this column is visible in the output */
  visible: boolean;
  /** Optional Excel formula (e.g., "=D2*1.3"). If set, sourceColumn data is ignored. */
  formula?: string;
  /** Column width in Excel character-width units (e.g., 8.43 = Excel default) */
  width: number;
}

/**
 * Generate a stable column ID using the Web Crypto API (available in Node 15+ and all browsers).
 */
function generateId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Prettify a SQL column name into a display name.
 * e.g., "employee_id" → "Employee Id", "firstName" → "First Name"
 */
function prettifyColumnName(name: string): string {
  // Split on underscores, hyphens, and camelCase boundaries
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Auto-generate a column config from query result columns.
 * Used on first run or when no config exists.
 */
export function generateColumnConfig(columns: string[]): ColumnConfig[] {
  return columns.map((col) => ({
    id: generateId(),
    sourceColumn: col,
    displayName: prettifyColumnName(col),
    visible: true,
    width: 8.43,
  }));
}

/**
 * Reconcile an existing column config against new query result columns.
 *
 * - Matched columns (sourceColumn exists in new query): kept in place
 * - New columns (in query but not in any config entry): appended at end with defaults
 * - Missing columns (config references a column no longer in query): kept but flagged
 *
 * Returns the updated config and a list of warnings.
 */
export function reconcileColumnConfig(
  existingConfig: ColumnConfig[],
  newColumns: string[]
): { config: ColumnConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  const newColumnSet = new Set(newColumns);
  const usedSourceColumns = new Set<string>();

  // Keep existing config entries, flag missing ones
  const reconciled = existingConfig.map((entry) => {
    if (entry.sourceColumn && !newColumnSet.has(entry.sourceColumn)) {
      // Source column no longer in query results
      if (!entry.formula) {
        warnings.push(
          `Column "${entry.displayName}" (source: ${entry.sourceColumn}) is no longer in the query results`
        );
      }
    }
    if (entry.sourceColumn) {
      usedSourceColumns.add(entry.sourceColumn);
    }
    return { ...entry };
  });

  // Append new columns not already in config
  for (const col of newColumns) {
    if (!usedSourceColumns.has(col)) {
      reconciled.push({
        id: generateId(),
        sourceColumn: col,
        displayName: prettifyColumnName(col),
        visible: true,
        width: 8.43,
      });
      warnings.push(`New column "${col}" added to config`);
    }
  }

  return { config: reconciled, warnings };
}

/**
 * Build mapped columns and rows from raw query data using column config.
 * Returns the display names as columns and remapped row data.
 */
export function applyColumnConfig(
  config: ColumnConfig[],
  rawColumns: string[],
  rawRows: Record<string, unknown>[]
): { columns: string[]; rows: Record<string, unknown>[]; configIds: string[] } {
  const visibleConfig = config.filter((c) => c.visible);
  const columns = visibleConfig.map((c) => c.displayName);
  const configIds = visibleConfig.map((c) => c.id);

  const rows = rawRows.map((rawRow) => {
    const mapped: Record<string, unknown> = {};
    for (const entry of visibleConfig) {
      if (entry.formula) {
        // Formula columns — value computed in the spreadsheet, pass placeholder
        mapped[entry.displayName] = "";
      } else if (entry.sourceColumn && entry.sourceColumn in rawRow) {
        mapped[entry.displayName] = rawRow[entry.sourceColumn];
      } else {
        mapped[entry.displayName] = "";
      }
    }
    return mapped;
  });

  return { columns, rows, configIds };
}

/**
 * Check if a source column still exists in the query results.
 */
export function isMissing(entry: ColumnConfig, queryColumns: string[]): boolean {
  if (!entry.sourceColumn) return false; // Formula-only columns aren't "missing"
  return !queryColumns.includes(entry.sourceColumn);
}

/**
 * Create a new formula-only column config entry.
 */
export function createFormulaColumn(
  displayName: string,
  formula: string
): ColumnConfig {
  return {
    id: generateId(),
    sourceColumn: null,
    displayName,
    visible: true,
    formula,
    width: 8.43,
  };
}

/** Approximate pixels per Excel character-width unit */
export const PX_PER_EXCEL_WIDTH = 7;

/**
 * Migrate old pixel-based widths (120+) to Excel character-width units.
 * Any width > 50 is assumed to be in old pixel format.
 */
export function migrateConfigWidths(config: ColumnConfig[]): ColumnConfig[] {
  return config.map((c) => ({
    ...c,
    width: c.width > 50 ? Math.round((c.width / PX_PER_EXCEL_WIDTH) * 100) / 100 : c.width,
  }));
}
