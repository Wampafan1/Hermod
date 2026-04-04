/**
 * DuckDB ↔ Hermod ↔ PostgreSQL ↔ BigQuery type mapping.
 *
 * DuckDB infers types from the full dataset. This module translates
 * those types into the various type systems used across Hermod.
 */

// Hermod simplified types (matches alfheim/types.ts ColumnMapping.dataType)
type HermodType = "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "TIMESTAMP" | "JSON";

/** Map a DuckDB column type to Hermod's simplified type system */
export function toHermodType(duckdbType: string): HermodType {
  const t = duckdbType.toUpperCase().replace(/\(.*\)/, "").trim();

  switch (t) {
    case "BOOLEAN":
      return "BOOLEAN";

    case "TINYINT":
    case "SMALLINT":
    case "INTEGER":
    case "INT":
    case "BIGINT":
    case "HUGEINT":
    case "UINTEGER":
    case "UBIGINT":
    case "UTINYINT":
    case "USMALLINT":
    case "UHUGEINT":
      return "INTEGER";

    case "FLOAT":
    case "DOUBLE":
    case "DECIMAL":
    case "REAL":
      return "FLOAT";

    case "DATE":
    case "TIMESTAMP":
    case "TIMESTAMP_S":
    case "TIMESTAMP_MS":
    case "TIMESTAMP_NS":
    case "TIMESTAMP WITH TIME ZONE":
    case "TIMESTAMPTZ":
    case "TIMESTAMP_TZ":
      return "TIMESTAMP";

    case "STRUCT":
    case "MAP":
    case "LIST":
    case "ARRAY":
    case "UNION":
      return "JSON";

    // VARCHAR, BLOB, UUID, ENUM, INTERVAL, TIME, etc. → STRING
    default:
      return "STRING";
  }
}

/** Simplified display type for the UI */
export function toInferredType(duckdbType: string): string {
  const hermod = toHermodType(duckdbType);
  switch (hermod) {
    case "INTEGER":
      return "integer";
    case "FLOAT":
      return "number";
    case "BOOLEAN":
      return "boolean";
    case "TIMESTAMP": {
      const t = duckdbType.toUpperCase().replace(/\(.*\)/, "").trim();
      return t === "DATE" ? "date" : "datetime";
    }
    case "JSON":
      return "json";
    default:
      return "string";
  }
}

/** Map DuckDB type to PostgreSQL CREATE TABLE type */
export function toPostgresType(duckdbType: string): string {
  const t = duckdbType.toUpperCase().replace(/\(.*\)/, "").trim();

  switch (t) {
    case "BOOLEAN":
      return "BOOLEAN";
    case "TINYINT":
    case "SMALLINT":
      return "SMALLINT";
    case "INTEGER":
    case "INT":
      return "INTEGER";
    case "BIGINT":
    case "HUGEINT":
    case "UBIGINT":
    case "UHUGEINT":
      return "BIGINT";
    case "UINTEGER":
      return "BIGINT"; // unsigned int may exceed PG int range
    case "UTINYINT":
    case "USMALLINT":
      return "INTEGER";
    case "FLOAT":
    case "REAL":
      return "REAL";
    case "DOUBLE":
      return "DOUBLE PRECISION";
    case "DECIMAL":
      return "NUMERIC";
    case "DATE":
      return "DATE";
    case "TIMESTAMP":
    case "TIMESTAMP_S":
    case "TIMESTAMP_MS":
    case "TIMESTAMP_NS":
      return "TIMESTAMP";
    case "TIMESTAMP WITH TIME ZONE":
    case "TIMESTAMPTZ":
    case "TIMESTAMP_TZ":
      return "TIMESTAMPTZ";
    case "TIME":
      return "TIME";
    case "INTERVAL":
      return "INTERVAL";
    case "UUID":
      return "UUID";
    case "BLOB":
      return "BYTEA";
    case "STRUCT":
    case "MAP":
    case "LIST":
    case "ARRAY":
    case "UNION":
      return "JSONB";
    default:
      return "TEXT";
  }
}

/** Map DuckDB type to BigQuery schema type */
export function toBigQueryType(duckdbType: string): string {
  const t = duckdbType.toUpperCase().replace(/\(.*\)/, "").trim();

  switch (t) {
    case "BOOLEAN":
      return "BOOLEAN";
    case "TINYINT":
    case "SMALLINT":
    case "INTEGER":
    case "INT":
    case "BIGINT":
    case "HUGEINT":
    case "UINTEGER":
    case "UBIGINT":
    case "UTINYINT":
    case "USMALLINT":
    case "UHUGEINT":
      return "INT64";
    case "FLOAT":
    case "REAL":
    case "DOUBLE":
    case "DECIMAL":
      return "FLOAT64";
    case "DATE":
      return "DATE";
    case "TIMESTAMP":
    case "TIMESTAMP_S":
    case "TIMESTAMP_MS":
    case "TIMESTAMP_NS":
    case "TIMESTAMP WITH TIME ZONE":
    case "TIMESTAMPTZ":
    case "TIMESTAMP_TZ":
      return "TIMESTAMP";
    case "TIME":
      return "TIME";
    case "BLOB":
      return "BYTES";
    case "STRUCT":
      return "RECORD";
    case "LIST":
    case "ARRAY":
      return "REPEATED";
    default:
      return "STRING";
  }
}

/** Map DuckDB type to a human-readable label for the UI */
export function toDisplayType(duckdbType: string): string {
  const t = duckdbType.toUpperCase().replace(/\(.*\)/, "").trim();

  switch (t) {
    case "BOOLEAN":
      return "Boolean";
    case "TINYINT":
    case "SMALLINT":
    case "INTEGER":
    case "INT":
      return "Integer";
    case "BIGINT":
    case "HUGEINT":
    case "UBIGINT":
    case "UHUGEINT":
      return "Big Integer";
    case "UINTEGER":
    case "UTINYINT":
    case "USMALLINT":
      return "Unsigned Integer";
    case "FLOAT":
    case "REAL":
      return "Float";
    case "DOUBLE":
      return "Double";
    case "DECIMAL":
      return "Decimal";
    case "DATE":
      return "Date";
    case "TIMESTAMP":
    case "TIMESTAMP_S":
    case "TIMESTAMP_MS":
    case "TIMESTAMP_NS":
      return "Timestamp";
    case "TIMESTAMP WITH TIME ZONE":
    case "TIMESTAMPTZ":
    case "TIMESTAMP_TZ":
      return "Timestamp (TZ)";
    case "TIME":
      return "Time";
    case "INTERVAL":
      return "Interval";
    case "UUID":
      return "UUID";
    case "VARCHAR":
      return "Text";
    case "BLOB":
      return "Binary";
    case "ENUM":
      return "Enum";
    case "STRUCT":
      return "Struct";
    case "MAP":
      return "Map";
    case "LIST":
    case "ARRAY":
      return "Array";
    default:
      return "Text";
  }
}
