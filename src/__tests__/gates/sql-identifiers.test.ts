import { describe, expect, it } from "vitest";

import {
  generateAlterStatements,
  generateCreateTableSql,
  mapSchemaDiffToDestination,
} from "@/lib/gates/alter-generator";
import { fullSqlTableRef, quoteSqlIdentifier } from "@/lib/gates/sql-identifiers";

describe("Gate SQL identifiers", () => {
  it("escapes dialect identifier delimiters", () => {
    expect(quoteSqlIdentifier('bad"name', "postgres")).toBe('"bad""name"');
    expect(quoteSqlIdentifier("bad]name", "mssql")).toBe("[bad]]name]");
    expect(quoteSqlIdentifier("bad`name", "mysql")).toBe("`bad``name`");
    expect(quoteSqlIdentifier("bad`name", "bigquery")).toBe("`bad``name`");
  });

  it("builds escaped qualified table references", () => {
    expect(fullSqlTableRef('sch"ema', 'tab"le', "postgres")).toBe(
      '"sch""ema"."tab""le"'
    );
    expect(fullSqlTableRef("sch]ema", "tab]le", "mssql")).toBe(
      "[sch]]ema].[tab]]le]"
    );
  });

  it("uses escaped identifiers in generated gate DDL", () => {
    const sql = generateCreateTableSql("POSTGRES", 'sch"ema', 'tab"le', [
      { name: 'id"col', duckdbType: "INTEGER", nullable: false },
    ], ['id"col']);

    expect(sql).toContain('"sch""ema"."tab""le"');
    expect(sql).toContain('"id""col" BIGINT NOT NULL');
    expect(sql).toContain('PRIMARY KEY ("id""col")');
  });

  it("uses the gate destination naming style for drift ALTER statements", () => {
    const sourceDiff = {
      added: [{ name: "Total Payable", type: "DOUBLE" }],
      removed: [],
      typeChanged: [],
    };
    const destinationDiff = mapSchemaDiffToDestination(sourceDiff, [
      { sourceColumn: "Entry Type", destinationColumn: "entry_type" },
      { sourceColumn: "Invoice Number", destinationColumn: "invoice_number" },
    ]);

    const statements = generateAlterStatements(
      "POSTGRES",
      "public",
      "loves_line_report",
      destinationDiff,
      sourceDiff
    );

    expect(destinationDiff.added[0].name).toBe("total_payable");
    expect(statements[0]).toMatchObject({
      sql: 'ALTER TABLE "public"."loves_line_report" ADD COLUMN "total_payable" DOUBLE PRECISION;',
      sourceColumn: "Total Payable",
      destinationColumn: "total_payable",
    });
  });
});

describe("Gate drift type-change DDL", () => {
  const typeChangeDiff = (newType: string, oldType = "VARCHAR") => ({
    added: [],
    removed: [],
    typeChanged: [{ name: "amount", oldType, newType }],
  });

  it("Postgres type change includes a USING cast clause", () => {
    const [stmt] = generateAlterStatements("POSTGRES", "public", "t", typeChangeDiff("BIGINT"));
    expect(stmt.sql).toBe(
      'ALTER TABLE "public"."t" ALTER COLUMN "amount" TYPE BIGINT USING ("amount"::BIGINT);'
    );
    expect(stmt.isComment).toBe(false);
  });

  it("Postgres type change to a multi-word type casts with that type", () => {
    const [stmt] = generateAlterStatements("POSTGRES", "public", "t", typeChangeDiff("TIMESTAMP"));
    expect(stmt.sql).toBe(
      'ALTER TABLE "public"."t" ALTER COLUMN "amount" TYPE TIMESTAMPTZ USING ("amount"::TIMESTAMPTZ);'
    );
  });

  it("MySQL type change uses MODIFY COLUMN without a USING clause", () => {
    const [stmt] = generateAlterStatements("MYSQL", "db", "t", typeChangeDiff("BIGINT"));
    expect(stmt.sql).toContain("MODIFY COLUMN");
    expect(stmt.sql).not.toContain("USING");
  });

  it("SQL Server type change uses ALTER COLUMN without a USING clause", () => {
    const [stmt] = generateAlterStatements("MSSQL", "dbo", "t", typeChangeDiff("BIGINT"));
    expect(stmt.sql).toContain("ALTER COLUMN");
    expect(stmt.sql).not.toContain("USING");
  });
});
