import { describe, expect, it } from "vitest";
import { buildUpsertBatchSql } from "@/lib/gates/push-executor";

function compact(sql: string | null): string {
  return (sql ?? "").replace(/\s+/g, " ").trim();
}

describe("gate upsert SQL", () => {
  it("updates matched MySQL keys before inserting missing rows without relying on unique indexes", () => {
    const sql = buildUpsertBatchSql(
      "MYSQL",
      "ops",
      "weekly_file",
      ["customer_id", "name", "week_total"],
      ["customer_id"],
      [
        { customer_id: "C-1", name: "Ada", week_total: 12 },
        { customer_id: "C-2", name: "Grace", week_total: 19 },
      ]
    );
    const allSql = compact([
      sql.countExistingSql,
      sql.updateExistingSql,
      sql.insertMissingSql,
    ].join(" "));

    expect(compact(sql.countExistingSql)).toContain("WHERE EXISTS");
    expect(compact(sql.updateExistingSql)).toContain("UPDATE `ops`.`weekly_file` AS T");
    expect(compact(sql.updateExistingSql)).toContain("T.`week_total` = S.`week_total`");
    expect(compact(sql.insertMissingSql)).toContain("WHERE NOT EXISTS");
    expect(allSql).not.toMatch(/ON DUPLICATE KEY|ON CONFLICT|MERGE/i);
  });

  it("includes newly accepted schema-drift columns in Postgres updates and inserts", () => {
    const sql = buildUpsertBatchSql(
      "POSTGRES",
      "public",
      "weekly_file",
      ["customer_id", "name", "week_total"],
      ["customer_id"],
      [{ customer_id: "C-1", name: "Ada", week_total: 12 }]
    );

    expect(compact(sql.updateExistingSql)).toContain('"week_total" = S."week_total"');
    expect(compact(sql.insertMissingSql)).toContain(
      'INSERT INTO "public"."weekly_file" ("customer_id", "name", "week_total")'
    );
    expect(compact(sql.insertMissingSql)).toContain("WHERE NOT EXISTS");
  });

  it("still inserts missing rows when all mapped columns are part of the key", () => {
    const sql = buildUpsertBatchSql(
      "POSTGRES",
      "public",
      "key_only",
      ["customer_id"],
      ["customer_id"],
      [{ customer_id: "C-1" }]
    );

    expect(sql.updateExistingSql).toBeNull();
    expect(compact(sql.insertMissingSql)).toContain("WHERE NOT EXISTS");
  });
});
