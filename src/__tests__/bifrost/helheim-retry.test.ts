import { describe, it, expect } from "vitest";

/**
 * Tests for the Helheim retry writeDisposition fix.
 *
 * Root cause: worker.ts used route.destConfig directly for retries,
 * which preserved WRITE_TRUNCATE — every retry wiped the destination table.
 * Fix: retries always override writeDisposition to WRITE_APPEND.
 *
 * These are logic-level tests that verify the destConfig override pattern
 * without needing full DB/worker mocks.
 */

describe("Helheim retry — writeDisposition override", () => {
  /**
   * Simulates the destConfig construction used in processHelheimRetries().
   * This mirrors the exact pattern from worker.ts.
   */
  function buildRetryDestConfig(routeDestConfig: Record<string, unknown>) {
    return {
      ...routeDestConfig,
      writeDisposition: "WRITE_APPEND",
    };
  }

  it("overrides WRITE_TRUNCATE to WRITE_APPEND", () => {
    const routeConfig = {
      dataset: "sparkstone_dashboards",
      table: "item",
      writeDisposition: "WRITE_TRUNCATE",
      autoCreateTable: true,
    };

    const retryConfig = buildRetryDestConfig(routeConfig);

    expect(retryConfig.writeDisposition).toBe("WRITE_APPEND");
    expect(retryConfig.dataset).toBe("sparkstone_dashboards");
    expect(retryConfig.table).toBe("item");
    expect(retryConfig.autoCreateTable).toBe(true);
  });

  it("preserves WRITE_APPEND when already set", () => {
    const routeConfig = {
      dataset: "test",
      table: "test_table",
      writeDisposition: "WRITE_APPEND",
      autoCreateTable: false,
    };

    const retryConfig = buildRetryDestConfig(routeConfig);

    expect(retryConfig.writeDisposition).toBe("WRITE_APPEND");
  });

  it("overrides WRITE_EMPTY to WRITE_APPEND", () => {
    const routeConfig = {
      dataset: "test",
      table: "test_table",
      writeDisposition: "WRITE_EMPTY",
      autoCreateTable: true,
    };

    const retryConfig = buildRetryDestConfig(routeConfig);

    expect(retryConfig.writeDisposition).toBe("WRITE_APPEND");
  });

  it("does not mutate the original route config", () => {
    const routeConfig = {
      dataset: "test",
      table: "test_table",
      writeDisposition: "WRITE_TRUNCATE",
      autoCreateTable: true,
    };

    buildRetryDestConfig(routeConfig);

    expect(routeConfig.writeDisposition).toBe("WRITE_TRUNCATE");
  });

  it("preserves schema and other config properties", () => {
    const routeConfig = {
      dataset: "test",
      table: "test_table",
      writeDisposition: "WRITE_TRUNCATE",
      autoCreateTable: true,
      schema: { fields: [{ name: "id", type: "INTEGER", mode: "REQUIRED" }] },
    };

    const retryConfig = buildRetryDestConfig(routeConfig);

    expect(retryConfig.writeDisposition).toBe("WRITE_APPEND");
    expect(retryConfig.schema).toEqual(routeConfig.schema);
  });
});
