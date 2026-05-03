import { describe, expect, it } from "vitest";

import { generateCreateTableSql } from "@/lib/gates/alter-generator";
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
});
