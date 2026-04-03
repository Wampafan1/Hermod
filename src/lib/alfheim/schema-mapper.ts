// ---------------------------------------------------------------------------
// Alfheim Schema Mapper — flatten nested JSON records into tabular rows
// ---------------------------------------------------------------------------

import type {
  ColumnMapping,
  ChildTableMapping,
  SchemaMapping,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

const MAX_SAMPLE_RECORDS = 50;

// ---------------------------------------------------------------------------
// flattenRecord
// ---------------------------------------------------------------------------

/**
 * Flatten a single API record into a main row + optional child-table rows
 * using an explicit `SchemaMapping`.
 */
export function flattenRecord(
  record: Record<string, unknown>,
  schema: SchemaMapping,
  parentId?: unknown,
): {
  main: Record<string, unknown>;
  children: Record<string, Record<string, unknown>[]>;
} {
  const main: Record<string, unknown> = {};

  for (const col of schema.columns) {
    const raw = getByPath(record, col.jsonPath);
    main[col.columnName] = coerce(raw, col.dataType);
  }

  const children: Record<string, Record<string, unknown>[]> = {};

  if (schema.childTables) {
    for (const child of schema.childTables) {
      const arr = getByPath(record, child.jsonPath);
      if (!Array.isArray(arr)) {
        children[child.tableName] = [];
        continue;
      }

      children[child.tableName] = arr.map((element) => {
        const row: Record<string, unknown> = {};
        // Inject foreign key
        row[child.foreignKey] = parentId ?? null;
        for (const col of child.columns) {
          const raw = getByPath(element as Record<string, unknown>, col.jsonPath);
          row[col.columnName] = coerce(raw, col.dataType);
        }
        return row;
      });
    }
  }

  return { main, children };
}

// ---------------------------------------------------------------------------
// inferSchema
// ---------------------------------------------------------------------------

/**
 * Analyze sample records and produce a `SchemaMapping` with inferred types.
 * Only inspects the first `MAX_SAMPLE_RECORDS` records.
 */
export function inferSchema(
  sampleRecords: Record<string, unknown>[],
  maxDepth = 3,
): SchemaMapping {
  const records = sampleRecords.slice(0, MAX_SAMPLE_RECORDS);
  if (records.length === 0) return { columns: [] };

  const columns: ColumnMapping[] = [];
  const childTables: ChildTableMapping[] = [];

  // Collect all unique keys across sampled records at this level
  const allKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r)) allKeys.add(k);
  }

  for (const key of allKeys) {
    inferKey(key, key, records, columns, childTables, 1, maxDepth);
  }

  return {
    columns,
    ...(childTables.length > 0 ? { childTables } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Traverse a dot-notation path on an object. */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Coerce a raw value to the declared data type. */
function coerce(
  value: unknown,
  dataType: ColumnMapping["dataType"],
): unknown {
  if (value === null || value === undefined) return null;

  switch (dataType) {
    case "INTEGER": {
      if (typeof value === "number") return Math.trunc(value);
      const n = parseFloat(String(value));
      return Number.isNaN(n) ? null : Math.trunc(n);
    }
    case "FLOAT": {
      if (typeof value === "number") return value;
      const n = parseFloat(String(value));
      return Number.isNaN(n) ? null : n;
    }
    case "BOOLEAN": {
      if (typeof value === "boolean") return value;
      const s = String(value).toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
      return null;
    }
    case "TIMESTAMP": {
      if (typeof value === "string") return value;
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
    case "JSON": {
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    }
    case "STRING":
    default:
      return String(value);
  }
}

/** Normalize a key segment into a valid SQL-friendly column name. */
function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Detect the data type of a non-null primitive value. */
function detectType(value: unknown): ColumnMapping["dataType"] {
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "FLOAT";
  }
  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) return "TIMESTAMP";
    // Check numeric string
    const n = Number(value);
    if (!Number.isNaN(n) && value.trim() !== "") {
      return Number.isInteger(n) ? "INTEGER" : "FLOAT";
    }
  }
  return "STRING";
}

/** Merge two detected types into a compatible supertype. */
function mergeTypes(
  a: ColumnMapping["dataType"],
  b: ColumnMapping["dataType"],
): ColumnMapping["dataType"] {
  if (a === b) return a;
  // INTEGER + FLOAT → FLOAT
  if (
    (a === "INTEGER" && b === "FLOAT") ||
    (a === "FLOAT" && b === "INTEGER")
  )
    return "FLOAT";
  // Everything else → STRING as the universal fallback
  return "STRING";
}

/**
 * Recursively infer schema for a single key across all sampled records.
 * Appends to `columns` or `childTables` as appropriate.
 */
function inferKey(
  key: string,
  jsonPath: string,
  records: Record<string, unknown>[],
  columns: ColumnMapping[],
  childTables: ChildTableMapping[],
  depth: number,
  maxDepth: number,
): void {
  let detectedType: ColumnMapping["dataType"] | null = null;
  let nullable = false;
  let isObjectKey = false;
  let isArrayOfObjects = false;
  let isArrayOfPrimitives = false;

  // Gather values across all records for this key
  const values: unknown[] = [];
  for (const r of records) {
    const v = r[key];
    if (v === undefined || v === null) {
      nullable = true;
      continue;
    }
    values.push(v);
  }

  // If no non-null values, it's a nullable STRING
  if (values.length === 0) {
    columns.push({
      jsonPath,
      columnName: normalizeColumnName(jsonPath.replace(/\./g, "_")),
      dataType: "STRING",
      nullable: true,
    });
    return;
  }

  // Classify by first non-null value
  const sample = values[0];

  if (Array.isArray(sample)) {
    // Check if array of objects or array of primitives
    const hasObject = values.some(
      (v) =>
        Array.isArray(v) &&
        v.length > 0 &&
        typeof v[0] === "object" &&
        v[0] !== null &&
        !Array.isArray(v[0]),
    );
    if (hasObject) {
      isArrayOfObjects = true;
    } else {
      isArrayOfPrimitives = true;
    }
  } else if (typeof sample === "object" && sample !== null) {
    isObjectKey = true;
  }

  // --- Array of objects → child table ---
  if (isArrayOfObjects) {
    // Collect all child elements for inference
    const childRecords: Record<string, unknown>[] = [];
    for (const v of values) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            childRecords.push(item as Record<string, unknown>);
          }
        }
      }
    }

    const childSchema = inferSchema(childRecords, maxDepth);
    childTables.push({
      jsonPath: key,
      tableName: key,
      foreignKey: "parent_id",
      columns: childSchema.columns,
    });
    return;
  }

  // --- Array of primitives → JSON ---
  if (isArrayOfPrimitives) {
    columns.push({
      jsonPath,
      columnName: normalizeColumnName(jsonPath.replace(/\./g, "_")),
      dataType: "JSON",
      nullable,
    });
    return;
  }

  // --- Nested object → recurse or JSON ---
  if (isObjectKey) {
    if (depth >= maxDepth) {
      columns.push({
        jsonPath,
        columnName: normalizeColumnName(jsonPath.replace(/\./g, "_")),
        dataType: "JSON",
        nullable,
      });
      return;
    }

    // Collect sub-keys across all records
    const subKeys = new Set<string>();
    const subRecords: Record<string, unknown>[] = [];
    for (const v of values) {
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        const obj = v as Record<string, unknown>;
        subRecords.push(obj);
        for (const sk of Object.keys(obj)) subKeys.add(sk);
      }
    }

    for (const subKey of subKeys) {
      const childJsonPath = `${jsonPath}.${subKey}`;
      // Build sub-record array with just this nested object's values
      const subValues: Record<string, unknown>[] = subRecords.map((sr) => ({
        [subKey]: sr[subKey],
      }));
      inferKey(
        subKey,
        childJsonPath,
        subValues,
        columns,
        childTables,
        depth + 1,
        maxDepth,
      );
    }
    return;
  }

  // --- Primitive → detect type ---
  for (const v of values) {
    const t = detectType(v);
    detectedType = detectedType === null ? t : mergeTypes(detectedType, t);
  }

  columns.push({
    jsonPath,
    columnName: normalizeColumnName(jsonPath.replace(/\./g, "_")),
    dataType: detectedType ?? "STRING",
    nullable,
  });
}
