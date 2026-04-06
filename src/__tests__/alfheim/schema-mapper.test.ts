import { describe, it, expect } from "vitest";
import { flattenRecord, inferSchema } from "@/lib/alfheim/schema-mapper";
import type {
  SchemaMapping,
  ColumnMapping,
  ChildTableMapping,
} from "@/lib/alfheim/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function col(
  jsonPath: string,
  columnName: string,
  dataType: ColumnMapping["dataType"] = "STRING",
  nullable = false,
): ColumnMapping {
  return { jsonPath, columnName, dataType, nullable };
}

// ---------------------------------------------------------------------------
// flattenRecord
// ---------------------------------------------------------------------------

describe("flattenRecord", () => {
  it("flattens a flat record with matching schema", () => {
    const schema: SchemaMapping = {
      columns: [
        col("id", "id", "INTEGER"),
        col("name", "name", "STRING"),
      ],
    };
    const record = { id: 1, name: "Alice" };
    const result = flattenRecord(record, schema);

    expect(result.main).toEqual({ id: 1, name: "Alice" });
    expect(result.children).toEqual({});
  });

  it("flattens nested objects via dot-notation jsonPath", () => {
    const schema: SchemaMapping = {
      columns: [
        col("address.city", "address_city"),
        col("address.zip", "address_zip"),
      ],
    };
    const record = { address: { city: "NYC", zip: "10001" } };
    const result = flattenRecord(record, schema);

    expect(result.main).toEqual({
      address_city: "NYC",
      address_zip: "10001",
    });
  });

  it("handles deep nesting (3+ levels)", () => {
    const schema: SchemaMapping = {
      columns: [
        col("a.b.c.d", "a_b_c_d", "JSON"),
      ],
    };
    const record = { a: { b: { c: { d: { deep: true } } } } };
    const result = flattenRecord(record, schema);

    // JSON dataType should stringify objects
    expect(result.main.a_b_c_d).toBe('{"deep":true}');
  });

  it("treats array of primitives as JSON column", () => {
    const schema: SchemaMapping = {
      columns: [col("tags", "tags", "JSON")],
    };
    const record = { tags: ["a", "b", "c"] };
    const result = flattenRecord(record, schema);

    expect(result.main.tags).toBe('["a","b","c"]');
  });

  it("extracts child table rows from array of objects", () => {
    const childColumns: ColumnMapping[] = [
      col("sku", "sku", "STRING"),
      col("qty", "qty", "INTEGER"),
    ];
    const schema: SchemaMapping = {
      columns: [col("id", "id", "INTEGER")],
      childTables: [
        {
          jsonPath: "items",
          tableName: "orders_items",
          foreignKey: "order_id",
          columns: childColumns,
        },
      ],
    };
    const record = {
      id: 42,
      items: [
        { sku: "A", qty: 1 },
        { sku: "B", qty: 3 },
      ],
    };
    const result = flattenRecord(record, schema, 42);

    expect(result.main).toEqual({ id: 42 });
    expect(result.children["orders_items"]).toHaveLength(2);
    expect(result.children["orders_items"][0]).toEqual({
      order_id: 42,
      sku: "A",
      qty: 1,
    });
    expect(result.children["orders_items"][1]).toEqual({
      order_id: 42,
      sku: "B",
      qty: 3,
    });
  });

  it("returns null for missing paths", () => {
    const schema: SchemaMapping = {
      columns: [
        col("missing.path", "missing_path"),
        col("also_missing", "also_missing", "INTEGER"),
      ],
    };
    const record = { other: "value" };
    const result = flattenRecord(record, schema);

    expect(result.main.missing_path).toBeNull();
    expect(result.main.also_missing).toBeNull();
  });

  it("returns null for explicit null values", () => {
    const schema: SchemaMapping = {
      columns: [col("name", "name")],
    };
    const record = { name: null };
    const result = flattenRecord(record, schema);

    expect(result.main.name).toBeNull();
  });

  it("coerces types correctly", () => {
    const schema: SchemaMapping = {
      columns: [
        col("count", "count", "INTEGER"),
        col("price", "price", "FLOAT"),
        col("active", "active", "BOOLEAN"),
        col("created", "created", "TIMESTAMP"),
        col("meta", "meta", "JSON"),
      ],
    };
    const record = {
      count: "42",
      price: "19.99",
      active: "true",
      created: "2026-01-15T10:30:00Z",
      meta: { foo: "bar" },
    };
    const result = flattenRecord(record, schema);

    expect(result.main.count).toBe(42);
    expect(result.main.price).toBe(19.99);
    expect(result.main.active).toBe(true);
    expect(result.main.created).toBe("2026-01-15T10:30:00Z");
    expect(result.main.meta).toBe('{"foo":"bar"}');
  });

  it("coerces boolean false and zero correctly", () => {
    const schema: SchemaMapping = {
      columns: [
        col("flag", "flag", "BOOLEAN"),
        col("num", "num", "INTEGER"),
      ],
    };
    const record = { flag: "false", num: "0" };
    const result = flattenRecord(record, schema);

    expect(result.main.flag).toBe(false);
    expect(result.main.num).toBe(0);
  });

  it("handles child table with missing array gracefully", () => {
    const schema: SchemaMapping = {
      columns: [col("id", "id", "INTEGER")],
      childTables: [
        {
          jsonPath: "items",
          tableName: "orders_items",
          foreignKey: "order_id",
          columns: [col("sku", "sku")],
        },
      ],
    };
    const record = { id: 1 };
    const result = flattenRecord(record, schema, 1);

    expect(result.children["orders_items"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// inferSchema
// ---------------------------------------------------------------------------

describe("inferSchema", () => {
  it("infers types from flat records", () => {
    const records = [
      { id: 1, name: "Alice", active: true, score: 3.14 },
      { id: 2, name: "Bob", active: false, score: 2.71 },
    ];
    const schema = inferSchema(records);

    expect(schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jsonPath: "id", columnName: "id", dataType: "INTEGER" }),
        expect.objectContaining({ jsonPath: "name", columnName: "name", dataType: "STRING" }),
        expect.objectContaining({ jsonPath: "active", columnName: "active", dataType: "BOOLEAN" }),
        expect.objectContaining({ jsonPath: "score", columnName: "score", dataType: "FLOAT" }),
      ]),
    );
    // All present in both records → not nullable
    for (const c of schema.columns) {
      expect(c.nullable).toBe(false);
    }
  });

  it("detects nullable columns when some records have missing keys", () => {
    const records = [
      { id: 1, name: "Alice" },
      { id: 2 },
    ];
    const schema = inferSchema(records);

    const nameCol = schema.columns.find((c) => c.columnName === "name");
    expect(nameCol).toBeDefined();
    expect(nameCol!.nullable).toBe(true);

    const idCol = schema.columns.find((c) => c.columnName === "id");
    expect(idCol!.nullable).toBe(false);
  });

  it("detects nullable columns when values are explicitly null", () => {
    const records = [
      { id: 1, name: null },
      { id: 2, name: "Bob" },
    ];
    const schema = inferSchema(records);

    const nameCol = schema.columns.find((c) => c.columnName === "name");
    expect(nameCol!.nullable).toBe(true);
  });

  it("flattens nested objects into dot-path columns", () => {
    const records = [
      { address: { city: "NYC", zip: "10001-A" } },
      { address: { city: "LA", zip: "90001-B" } },
    ];
    const schema = inferSchema(records);

    expect(schema.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jsonPath: "address.city",
          columnName: "address_city",
          dataType: "STRING",
        }),
        expect.objectContaining({
          jsonPath: "address.zip",
          columnName: "address_zip",
          dataType: "STRING",
        }),
      ]),
    );
    expect(schema.childTables ?? []).toHaveLength(0);
  });

  it("produces JSON column when depth exceeds maxDepth", () => {
    const records = [
      { a: { b: { c: { d: "deep" } } } },
    ];
    // maxDepth = 2: key "a" at depth 1 is recursed, key "b" at depth 2
    // hits the limit → becomes JSON column at path "a.b"
    const schema = inferSchema(records, 2);

    const jsonCol = schema.columns.find(
      (c) => c.dataType === "JSON" && c.jsonPath === "a.b",
    );
    expect(jsonCol).toBeDefined();
    expect(jsonCol!.columnName).toBe("a_b");
  });

  it("treats array of primitives as JSON column", () => {
    const records = [{ tags: ["a", "b"] }, { tags: ["c"] }];
    const schema = inferSchema(records);

    const tagsCol = schema.columns.find((c) => c.columnName === "tags");
    expect(tagsCol).toBeDefined();
    expect(tagsCol!.dataType).toBe("JSON");
  });

  it("detects array of objects as child tables", () => {
    const records = [
      {
        id: 1,
        items: [
          { sku: "A", qty: 1 },
          { sku: "B", qty: 2 },
        ],
      },
      {
        id: 2,
        items: [{ sku: "C", qty: 3 }],
      },
    ];
    const schema = inferSchema(records);

    expect(schema.childTables).toHaveLength(1);
    const child = schema.childTables![0];
    expect(child.jsonPath).toBe("items");
    expect(child.tableName).toBe("items");
    expect(child.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jsonPath: "sku", columnName: "sku", dataType: "STRING" }),
        expect.objectContaining({ jsonPath: "qty", columnName: "qty", dataType: "INTEGER" }),
      ]),
    );
  });

  it("detects TIMESTAMP for ISO date strings", () => {
    const records = [
      { created: "2026-01-15T10:30:00Z" },
      { created: "2026-02-20T08:00:00.000Z" },
    ];
    const schema = inferSchema(records);

    const col = schema.columns.find((c) => c.columnName === "created");
    expect(col!.dataType).toBe("TIMESTAMP");
  });

  it("distinguishes INTEGER vs FLOAT", () => {
    const records = [
      { whole: 10, decimal: 3.14 },
      { whole: 20, decimal: 2.71 },
    ];
    const schema = inferSchema(records);

    expect(schema.columns.find((c) => c.columnName === "whole")!.dataType).toBe("INTEGER");
    expect(schema.columns.find((c) => c.columnName === "decimal")!.dataType).toBe("FLOAT");
  });

  it("normalizes column names: lowercase, special chars to underscore", () => {
    const records = [{ "First Name": "Alice", "order-total": 100 }];
    const schema = inferSchema(records);

    expect(schema.columns.map((c) => c.columnName)).toEqual(
      expect.arrayContaining(["first_name", "order_total"]),
    );
  });

  it("uses only first 50 records for inference", () => {
    // Create 100 records, only last 50 have 'extra' field
    const records = Array.from({ length: 100 }, (_, i) => {
      const base: Record<string, unknown> = { id: i };
      if (i >= 50) base.extra = "late";
      return base;
    });
    const schema = inferSchema(records);

    // 'extra' should not appear since it's only in records 50-99
    const extraCol = schema.columns.find((c) => c.columnName === "extra");
    expect(extraCol).toBeUndefined();
  });
});
