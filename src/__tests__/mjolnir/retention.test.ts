import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeStep } from "@/lib/mjolnir/types";
import {
  getMjolnirRetentionMode,
  REDACTED_SAMPLE_VALUE,
  sanitizeAfterFormatting,
  sanitizeAnalysisLog,
  sanitizeBlueprintCreatePayload,
  sanitizeForgeSteps,
  sanitizeSampleFilename,
} from "@/lib/mjolnir/retention";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Mjolnir retention helpers", () => {
  it("sanitizeSampleFilename removes paths and risky characters", () => {
    const sanitized = sanitizeSampleFilename("C:\\Tenants\\Acme:Prod? Before*.xlsx");

    expect(sanitized).toBe("Acme_Prod_ Before_.xlsx");
    expect(sanitized).not.toContain("\\");
    expect(sanitized).not.toContain(":");
    expect(sanitized).not.toContain("?");
    expect(sanitized).not.toContain("*");
  });

  it("sanitizeAnalysisLog removes before/after/sample values", () => {
    const sanitized = sanitizeAnalysisLog({
      matchedColumns: [{ beforeColumn: "Customer", afterColumn: "Customer" }],
      formatChanges: [{
        column: "Customer",
        changeType: "trim",
        beforeValue: " Acme Corp ",
        afterValue: "Acme Corp",
        beforeSample: " Acme Corp ",
        afterSample: "Acme Corp",
        sample: "Acme Corp",
      }],
      beforeData: {
        sampleRows: [{ Customer: "Acme Corp" }],
      },
    });

    expect(sanitized).toMatchObject({
      matchedColumns: [{ beforeColumn: "Customer", afterColumn: "Customer" }],
      formatChanges: [{ column: "Customer", changeType: "trim" }],
    });
    expect(JSON.stringify(sanitized)).not.toContain("Acme Corp");
  });

  it("sanitizeAfterFormatting redacts sensitive header values in STANDARD default mode", () => {
    const sanitized = sanitizeAfterFormatting({
      headerRowCount: 2,
      columnWidths: [12],
      headerRowHeights: [20, 20],
      headerStyles: {},
      headerValues: {
        "0:0": "Acme Corp Executive Summary",
        "1:0": "Customer",
      },
      dataRowStyles: {},
      merges: [],
      freeze: { row: 2, col: 1 },
      columns: ["Customer"],
    });

    expect(sanitized.headerValues).toEqual({
      "0:0": REDACTED_SAMPLE_VALUE,
      "1:0": REDACTED_SAMPLE_VALUE,
    });
    expect(sanitized.columns).toEqual(["Customer"]);
    expect(sanitized.columnWidths).toEqual([12]);
    expect(sanitized.freeze).toEqual({ row: 2, col: 1 });
  });

  it("sanitizeAfterFormatting removes header values in MINIMAL mode", () => {
    const sanitized = sanitizeAfterFormatting({
      headerValues: {
        "0:0": "Acme Corp",
        "0:1": "Total",
      },
      columns: ["Customer"],
    }, "MINIMAL") as { headerValues: Record<string, unknown> };

    expect(sanitized.headerValues).toEqual({});
  });

  it("sanitizeAfterFormatting redacts sensitive header values in STANDARD mode", () => {
    const sanitized = sanitizeAfterFormatting({
      headerValues: {
        "0:0": "Acme Corp",
        "0:1": "Total",
      },
      columns: ["Customer"],
    }, "STANDARD") as { headerValues: Record<string, unknown> };

    expect(sanitized.headerValues["0:0"]).toBe(REDACTED_SAMPLE_VALUE);
    expect(sanitized.headerValues["0:1"]).toBe("Total");
  });

  it("sanitizeForgeSteps redacts sample literals while preserving executable structure", () => {
    const steps: ForgeStep[] = [{
      order: 0,
      type: "filter_rows",
      confidence: 0.8,
      config: {
        column: "Customer",
        operator: "eq",
        value: "Acme Corp",
      },
      description: 'Filter Customer where value is "Acme Corp" ( Acme Corp -> ACME CORP )',
    }];

    const sanitized = sanitizeForgeSteps(steps);

    expect(sanitized[0].config.column).toBe("Customer");
    expect(sanitized[0].config.operator).toBe("eq");
    expect(sanitized[0].config.value).toBe(REDACTED_SAMPLE_VALUE);
    expect(sanitized[0].description).not.toContain("Acme Corp");
  });

  it("sanitizeBlueprintCreatePayload sanitizes sample filenames and raw sample details by default", () => {
    const sanitized = sanitizeBlueprintCreatePayload({
      name: "Monthly Cleanup",
      description: 'Built from "Acme Corp" sample',
      steps: [{
        order: 0,
        type: "filter_rows",
        confidence: 0.8,
        config: { column: "Customer", operator: "eq", value: "Acme Corp" },
        description: 'Filter "Acme Corp"',
      }] satisfies ForgeStep[],
      sourceSchema: {
        columns: ["Customer"],
        types: {},
        sampleRows: [{ Customer: "Acme Corp" }],
      },
      analysisLog: {
        formatChanges: [{
          column: "Customer",
          changeType: "case",
          beforeSample: "Acme Corp",
          afterSample: "ACME CORP",
        }],
      },
      afterFormatting: {
        headerValues: { "0:0": "Acme Corp" },
        columns: ["Customer"],
      },
      beforeSample: "C:\\Customers\\Acme Before.xlsx",
      afterSample: "C:\\Customers\\Acme After.xlsx",
    });

    expect(sanitized.beforeSample).toBe("Acme Before.xlsx");
    expect(sanitized.afterSample).toBe("Acme After.xlsx");
    expect((sanitized.afterFormatting as { headerValues: Record<string, unknown> }).headerValues).toEqual({
      "0:0": REDACTED_SAMPLE_VALUE,
    });
    expect(JSON.stringify(sanitized)).not.toContain("Acme Corp");
  });

  it("MINIMAL mode omits beforeSample and afterSample", () => {
    const sanitized = sanitizeBlueprintCreatePayload({
      name: "Minimal Blueprint",
      steps: [{
        order: 0,
        type: "remove_columns",
        confidence: 1,
        config: { columns: ["Unused"] },
        description: "Remove unused column",
      }] satisfies ForgeStep[],
      beforeSample: "C:\\Customers\\Before.xlsx",
      afterSample: "C:\\Customers\\After.xlsx",
    }, "MINIMAL");

    expect(sanitized.beforeSample).toBeNull();
    expect(sanitized.afterSample).toBeNull();
  });

  it("FULL_DEBUG preserves rich sample detail only when explicitly configured", () => {
    const payload = {
      name: "Debug Blueprint",
      steps: [{
        order: 0,
        type: "filter_rows",
        confidence: 0.8,
        config: { column: "Customer", operator: "eq", value: "Acme Corp" },
        description: 'Filter "Acme Corp"',
      }] satisfies ForgeStep[],
      analysisLog: {
        formatChanges: [{
          column: "Customer",
          changeType: "trim",
          beforeSample: " Acme Corp ",
          afterSample: "Acme Corp",
        }],
      },
      afterFormatting: {
        headerValues: { "0:0": "Acme Corp" },
      },
      beforeSample: "Acme Before.xlsx",
    };

    expect(getMjolnirRetentionMode()).toBe("STANDARD");
    expect(JSON.stringify(sanitizeBlueprintCreatePayload(payload))).not.toContain("Acme Corp");

    vi.stubEnv("MJOLNIR_RETENTION_MODE", "FULL_DEBUG");
    expect(getMjolnirRetentionMode()).toBe("FULL_DEBUG");
    expect(JSON.stringify(sanitizeBlueprintCreatePayload(payload))).toContain("Acme Corp");
  });
});
