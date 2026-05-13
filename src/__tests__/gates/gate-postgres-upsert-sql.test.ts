import { describe, expect, it } from "vitest";
import { buildUpsertBatchSql } from "@/lib/gates/push-executor";

function compact(sql: string | null): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("gate Postgres UPSERT SQL casts", () => {
  it("casts bigint values and nulls in the VALUES source", () => {
    const sql = buildUpsertBatchSql(
      "POSTGRES",
      "public",
      "weekly_file",
      ["customer_id", "__cont"],
      ["customer_id"],
      [
        { customer_id: "C-1", __cont: "00123" },
        { customer_id: "C-2", __cont: null },
      ],
      {
        customer_id: "text",
        __cont: "bigint",
      }
    );

    const allSql = compact([sql.countExistingSql, sql.updateExistingSql, sql.insertMissingSql].join(" "));

    expect(allSql).toContain("'00123'::bigint");
    expect(allSql).toContain("NULL::bigint");
    expect(allSql).not.toContain("'00123',");
  });

  it("casts simplified INTEGER destinations to bigint for Postgres-created Gate columns", () => {
    const sql = buildUpsertBatchSql(
      "POSTGRES",
      "public",
      "weekly_file",
      ["customer_id", "__cont"],
      ["customer_id"],
      [{ customer_id: "C-1", __cont: "5" }],
      {
        customer_id: "STRING",
        __cont: "INTEGER",
      }
    );

    expect(compact(sql.insertMissingSql)).toContain("'5'::bigint");
  });

  it("quotes identifiers safely and matches on the configured key", () => {
    const sql = buildUpsertBatchSql(
      "POSTGRES",
      "public",
      "weekly file",
      ["customer id", "__cont"],
      ["customer id"],
      [{ "customer id": "C-1", __cont: "10" }],
      {
        "customer id": "text",
        __cont: "bigint",
      }
    );

    const allSql = compact([sql.countExistingSql, sql.updateExistingSql, sql.insertMissingSql].join(" "));

    expect(allSql).toContain('"public"."weekly file"');
    expect(allSql).toContain('"customer id"');
    expect(allSql).toContain('"__cont"');
    expect(allSql).toContain('T."customer id" IS NOT DISTINCT FROM S."customer id"');
    expect(allSql).toContain("WHERE NOT EXISTS");
  });
});
