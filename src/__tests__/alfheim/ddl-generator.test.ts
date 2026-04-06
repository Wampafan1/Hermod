import { describe, it, expect } from "vitest";
import { generateDDL } from "../../lib/alfheim/ddl-generator";
import type { SchemaMapping, ColumnMapping, SqlDialect } from "../../lib/alfheim/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allTypesColumns(nullable = false): ColumnMapping[] {
  return [
    { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
    { jsonPath: "name", columnName: "name", dataType: "STRING", nullable },
    { jsonPath: "price", columnName: "price", dataType: "FLOAT", nullable },
    { jsonPath: "active", columnName: "active", dataType: "BOOLEAN", nullable },
    { jsonPath: "created_at", columnName: "created_at", dataType: "TIMESTAMP", nullable },
    { jsonPath: "metadata", columnName: "metadata", dataType: "JSON", nullable },
  ];
}

// ---------------------------------------------------------------------------
// 1. Simple table, all data types, each dialect
// ---------------------------------------------------------------------------

describe("generateDDL — type mapping per dialect", () => {
  const schema: SchemaMapping = { columns: allTypesColumns() };

  it("postgres uses correct types", () => {
    const { statements } = generateDDL("products", schema, "postgres");
    expect(statements).toHaveLength(1);
    const ddl = statements[0];
    expect(ddl).toContain("BIGINT");           // INTEGER
    expect(ddl).toContain("TEXT");             // STRING
    expect(ddl).toContain("DOUBLE PRECISION"); // FLOAT
    expect(ddl).toContain("BOOLEAN");          // BOOLEAN
    expect(ddl).toContain("TIMESTAMPTZ");      // TIMESTAMP
    expect(ddl).toContain("JSONB");            // JSON
  });

  it("mssql uses correct types", () => {
    const { statements } = generateDDL("products", schema, "mssql");
    const ddl = statements[0];
    expect(ddl).toContain("BIGINT");
    expect(ddl).toContain("NVARCHAR(MAX)");    // STRING & JSON
    expect(ddl).toContain("FLOAT");
    expect(ddl).toContain("BIT");
    expect(ddl).toContain("DATETIME2");
  });

  it("mysql uses correct types", () => {
    const { statements } = generateDDL("products", schema, "mysql");
    const ddl = statements[0];
    expect(ddl).toContain("BIGINT");
    expect(ddl).toContain("DOUBLE");
    expect(ddl).toContain("TINYINT(1)");
    expect(ddl).toContain("DATETIME");
    expect(ddl).toContain("JSON");
  });

  it("bigquery uses correct types", () => {
    const { statements } = generateDDL("products", schema, "bigquery");
    const ddl = statements[0];
    expect(ddl).toContain("INT64");
    expect(ddl).toContain("STRING");
    expect(ddl).toContain("FLOAT64");
    expect(ddl).toContain("BOOL");
    expect(ddl).toContain("TIMESTAMP");
    // BigQuery JSON type
    expect(ddl).toMatch(/JSON/);
  });
});

// ---------------------------------------------------------------------------
// 2. Table with child tables — generates 2+ CREATE statements
// ---------------------------------------------------------------------------

describe("generateDDL — child tables", () => {
  const schema: SchemaMapping = {
    columns: [
      { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
      { jsonPath: "status", columnName: "status", dataType: "STRING", nullable: true },
    ],
    childTables: [
      {
        jsonPath: "line_items",
        tableName: "orders_line_items",
        foreignKey: "order_id",
        columns: [
          { jsonPath: "sku", columnName: "sku", dataType: "STRING", nullable: false },
          { jsonPath: "qty", columnName: "qty", dataType: "INTEGER", nullable: false },
        ],
      },
      {
        jsonPath: "tags",
        tableName: "orders_tags",
        foreignKey: "order_id",
        columns: [
          { jsonPath: "tag", columnName: "tag", dataType: "STRING", nullable: false },
        ],
      },
    ],
  };

  it("generates one statement per table (main + children)", () => {
    const { statements } = generateDDL("orders", schema, "postgres");
    expect(statements).toHaveLength(3);
  });

  it("main table statement comes first", () => {
    const { statements } = generateDDL("orders", schema, "postgres");
    expect(statements[0]).toMatch(/CREATE TABLE.*"orders"/i);
  });

  it("child tables include foreign key column", () => {
    const { statements } = generateDDL("orders", schema, "postgres");
    const childDDL = statements[1];
    expect(childDDL).toMatch(/CREATE TABLE.*"orders_line_items"/i);
    expect(childDDL).toContain('"order_id"');
    expect(childDDL).toContain('"sku"');
  });

  it("second child table is also generated", () => {
    const { statements } = generateDDL("orders", schema, "postgres");
    expect(statements[2]).toMatch(/CREATE TABLE.*"orders_tags"/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Nullable vs NOT NULL
// ---------------------------------------------------------------------------

describe("generateDDL — nullable handling", () => {
  it("marks non-nullable columns as NOT NULL", () => {
    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
      ],
    };
    const { statements } = generateDDL("t", schema, "postgres");
    expect(statements[0]).toContain("NOT NULL");
  });

  it("omits NOT NULL for nullable columns", () => {
    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "note", columnName: "note", dataType: "STRING", nullable: true },
      ],
    };
    const { statements } = generateDDL("t", schema, "postgres");
    // The column definition should NOT have "NOT NULL"
    expect(statements[0]).not.toMatch(/"note"\s+TEXT\s+NOT NULL/);
  });

  it("mixed nullable and non-nullable in same table", () => {
    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "id", columnName: "id", dataType: "INTEGER", nullable: false },
        { jsonPath: "note", columnName: "note", dataType: "STRING", nullable: true },
      ],
    };
    const { statements } = generateDDL("t", schema, "postgres");
    const ddl = statements[0];
    expect(ddl).toMatch(/"id"\s+BIGINT\s+NOT NULL/);
    expect(ddl).toMatch(/"note"\s+TEXT(?!\s+NOT NULL)/);
  });
});

// ---------------------------------------------------------------------------
// 4. Column name quoting — each dialect uses correct quote style
// ---------------------------------------------------------------------------

describe("generateDDL — dialect-specific quoting", () => {
  const schema: SchemaMapping = {
    columns: [
      { jsonPath: "a", columnName: "my_col", dataType: "STRING", nullable: true },
    ],
  };

  it("postgres uses double quotes", () => {
    const { statements } = generateDDL("my_table", schema, "postgres");
    expect(statements[0]).toContain('"my_table"');
    expect(statements[0]).toContain('"my_col"');
  });

  it("mssql uses brackets", () => {
    const { statements } = generateDDL("my_table", schema, "mssql");
    expect(statements[0]).toContain("[my_table]");
    expect(statements[0]).toContain("[my_col]");
  });

  it("mysql uses backticks", () => {
    const { statements } = generateDDL("my_table", schema, "mysql");
    expect(statements[0]).toContain("`my_table`");
    expect(statements[0]).toContain("`my_col`");
  });

  it("bigquery uses backticks", () => {
    const { statements } = generateDDL("my_table", schema, "bigquery");
    expect(statements[0]).toContain("`my_table`");
    expect(statements[0]).toContain("`my_col`");
  });
});

// ---------------------------------------------------------------------------
// 5. Name sanitization and truncation warnings
// ---------------------------------------------------------------------------

describe("generateDDL — name sanitization", () => {
  it("replaces special characters with underscores", () => {
    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "a", columnName: "col-with spaces!@#", dataType: "STRING", nullable: true },
      ],
    };
    const { statements } = generateDDL("my-table", schema, "postgres");
    // Special chars replaced with underscores
    expect(statements[0]).toContain('"my_table"');
    expect(statements[0]).toContain('"col_with_spaces___"');
  });

  it("warns when name is truncated (over 128 chars)", () => {
    const longName = "a".repeat(200);
    const schema: SchemaMapping = {
      columns: [
        { jsonPath: "x", columnName: "id", dataType: "INTEGER", nullable: false },
      ],
    };
    const { warnings } = generateDDL(longName, schema, "postgres");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/truncat/i);
  });
});
