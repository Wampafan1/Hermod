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
