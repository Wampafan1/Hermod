import { describe, expect, it } from "vitest";
import {
  buildHermodConstraintName,
  buildMssqlReplaceKeySql,
  buildMysqlReplaceKeySql,
  buildPostgresReplaceKeySql,
  buildReplaceKeyConstraintPlan,
  validateKeyReplacementSafety,
} from "@/lib/gates/key-ddl";

describe("Gate key DDL generation", () => {
  it("generates Postgres unique constraint replacement SQL", () => {
    const ddl = buildPostgresReplaceKeySql({
      providerType: "POSTGRES",
      schema: "public",
      table: "Customer Orders",
      oldKey: ["customer_id"],
      newKey: ["customer_id", "line_number"],
      existingConstraintName: "hermod_customer_orders_customer_id_uk",
      constraintName: "hermod_customer_orders_hardened_uk",
    });

    expect(ddl).toEqual([
      'ALTER TABLE "public"."Customer Orders" DROP CONSTRAINT "hermod_customer_orders_customer_id_uk";',
      'ALTER TABLE "public"."Customer Orders" ADD CONSTRAINT "hermod_customer_orders_hardened_uk" UNIQUE ("customer_id", "line_number");',
    ]);
  });

  it("generates Postgres primary key replacement SQL", () => {
    const ddl = buildPostgresReplaceKeySql({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["id"],
      newKey: ["id", "line_no"],
      existingConstraintName: "hermod_orders_id_pk",
      constraintName: "hermod_orders_id_line_pk",
      replacePrimaryKey: true,
    });

    expect(ddl[1]).toBe(
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "hermod_orders_id_line_pk" PRIMARY KEY ("id", "line_no");'
    );
  });

  it("generates SQL Server unique constraint replacement SQL", () => {
    const ddl = buildMssqlReplaceKeySql({
      providerType: "MSSQL",
      schema: "dbo",
      table: "orders",
      oldKey: ["customer_id"],
      newKey: ["customer_id", "line_number"],
      existingConstraintName: "hermod_orders_old_uk",
      constraintName: "hermod_orders_new_uk",
    });

    expect(ddl).toEqual([
      "ALTER TABLE [dbo].[orders] DROP CONSTRAINT [hermod_orders_old_uk];",
      "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [hermod_orders_new_uk] UNIQUE ([customer_id], [line_number]);",
    ]);
  });

  it("generates SQL Server primary key replacement SQL", () => {
    const ddl = buildMssqlReplaceKeySql({
      providerType: "MSSQL",
      schema: "dbo",
      table: "orders",
      oldKey: ["id"],
      newKey: ["id", "line_no"],
      existingConstraintName: "hermod_orders_id_pk",
      constraintName: "hermod_orders_id_line_pk",
      replacePrimaryKey: true,
    });

    expect(ddl[1]).toBe(
      "ALTER TABLE [dbo].[orders] ADD CONSTRAINT [hermod_orders_id_line_pk] PRIMARY KEY ([id], [line_no]);"
    );
  });

  it("generates MySQL unique index replacement SQL", () => {
    const ddl = buildMysqlReplaceKeySql({
      providerType: "MYSQL",
      schema: "app",
      table: "orders",
      oldKey: ["customer_id"],
      newKey: ["customer_id", "line_number"],
      existingConstraintName: "hermod_orders_old_uk",
      constraintName: "hermod_orders_new_uk",
    });

    expect(ddl).toEqual([
      "DROP INDEX `hermod_orders_old_uk` ON `app`.`orders`;",
      "CREATE UNIQUE INDEX `hermod_orders_new_uk` ON `app`.`orders` (`customer_id`, `line_number`);",
    ]);
  });

  it("generates MySQL primary key replacement SQL", () => {
    const ddl = buildMysqlReplaceKeySql({
      providerType: "MYSQL",
      schema: "app",
      table: "orders",
      oldKey: ["id"],
      newKey: ["id", "line_no"],
      existingConstraintName: "PRIMARY",
      replacePrimaryKey: true,
    });

    expect(ddl).toEqual([
      "ALTER TABLE `app`.`orders` DROP PRIMARY KEY;",
      "ALTER TABLE `app`.`orders` ADD PRIMARY KEY (`id`, `line_no`);",
    ]);
  });

  it("quotes unsafe identifiers", () => {
    const ddl = buildPostgresReplaceKeySql({
      providerType: "POSTGRES",
      schema: "public",
      table: 'weird"table',
      oldKey: ["old"],
      newKey: ['customer"id'],
      constraintName: "hermod_weird_uk",
    });

    expect(ddl[0]).toContain('"weird""table"');
    expect(ddl[0]).toContain('"customer""id"');
  });

  it("uses deterministic Hermod constraint names", () => {
    const first = buildHermodConstraintName("orders", ["customer_id", "line_number"], "uk");
    const second = buildHermodConstraintName("orders", ["customer_id", "line_number"], "uk");

    expect(first).toBe(second);
    expect(first).toMatch(/^hermod_/);
    expect(first.length).toBeLessThanOrEqual(63);
  });

  it("blocks primary key replacement when foreign keys depend on it", () => {
    const plan = buildReplaceKeyConstraintPlan({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["id"],
      newKey: ["id", "line_no"],
      existingConstraintName: "hermod_orders_id_pk",
      replacePrimaryKey: true,
      foreignKeyDependencyCount: 2,
    });

    expect(plan.blocked).toBe(true);
    expect(plan.blockReason).toContain("foreign key dependencies");
    expect(plan.ddl).toEqual([]);
  });

  it("refuses to drop unknown arbitrary constraints", () => {
    const safety = validateKeyReplacementSafety({
      providerType: "POSTGRES",
      schema: "public",
      table: "orders",
      oldKey: ["customer_id"],
      newKey: ["customer_id", "line_number"],
      existingConstraintName: "orders_customer_id_key",
    });

    expect(safety.blocked).toBe(true);
    expect(safety.blockReason).toContain("unmanaged");
  });
});
