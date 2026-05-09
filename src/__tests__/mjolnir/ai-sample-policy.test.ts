import { afterEach, describe, expect, it, vi } from "vitest";
import { REDACTED_SAMPLE_VALUE } from "@/lib/mjolnir/retention";
import {
  describeAiSamplePolicyForUi,
  getMjolnirAiSampleMode,
  sanitizeAiAnalysisContext,
  sanitizeFormulaContext,
} from "@/lib/mjolnir/ai-sample-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Mjolnir AI sample policy", () => {
  it("defaults to REDACTED mode", () => {
    expect(getMjolnirAiSampleMode()).toBe("REDACTED");
    expect(describeAiSamplePolicyForUi()).toMatchObject({
      mode: "REDACTED",
      message: "AI analysis uses redacted samples by default.",
    });
  });

  it("STRUCTURAL_ONLY removes row and sample values while keeping structure", () => {
    const sanitized = sanitizeAiAnalysisContext({
      diffSummary: {
        matchedColumns: [{ before: "Email", after: "Email", confidence: 1 }],
        beforeRowCount: 20,
        afterRowCount: 18,
        formatChanges: [{
          column: "Email",
          changeType: "trim",
          beforeSample: " jane.doe@example.com ",
          afterSample: "jane.doe@example.com",
        }],
      },
      beforeData: {
        columns: ["Email", "Customer"],
        sampleRows: [{ Email: "jane.doe@example.com", Customer: "Acme Corp" }],
        fingerprints: [{
          name: "Email",
          dataType: "string",
          nullRate: 0,
          cardinality: 1,
          sampleHash: "hash-of-email",
          topValues: [{ value: "jane.doe@example.com", count: 1 }],
        }],
      },
      removedRows: [{ Email: "jane.doe@example.com", Customer: "Acme Corp" }],
    }, "STRUCTURAL_ONLY");

    const json = JSON.stringify(sanitized);
    expect(json).toContain("Email");
    expect(json).toContain("beforeRowCount");
    expect(json).not.toContain("sampleRows");
    expect(json).not.toContain("removedRows");
    expect(json).not.toContain("jane.doe@example.com");
    expect(json).not.toContain("Acme Corp");
    expect(json).not.toContain("hash-of-email");
  });

  it("REDACTED redacts sensitive values in samples, paths, filenames, and formulas", () => {
    const sanitized = sanitizeAiAnalysisContext({
      sampleData: [{
        beforeRow: {
          Email: "jane.doe@example.com",
          Phone: "555-123-4567",
          Url: "https://customer.example.com/report",
          Token: "abc123def456ghi789jkl012mno345",
          LongId: "123456789012",
          File: "customer-prod-report.xlsx",
          Path: "C:\\Tenants\\Acme\\customer-prod-report.xlsx",
        },
        afterValue: "Acme Corp",
      }],
      detectedFormula: {
        rawFormula: '=IF(A2="jane.doe@example.com","C:\\Tenants\\Acme\\customer-prod-report.xlsx","ok")',
        expression: '{Email} & " customer-prod-report.xlsx"',
        referencedColumns: ["Email"],
      },
    }, "REDACTED");

    const json = JSON.stringify(sanitized);
    expect(json).toContain(REDACTED_SAMPLE_VALUE);
    expect(json).not.toContain("jane.doe@example.com");
    expect(json).not.toContain("555-123-4567");
    expect(json).not.toContain("https://customer.example.com/report");
    expect(json).not.toContain("abc123def456ghi789jkl012mno345");
    expect(json).not.toContain("123456789012");
    expect(json).not.toContain("customer-prod-report.xlsx");
    expect(json).not.toContain("C:\\Tenants\\Acme");
  });

  it("FULL_DEBUG preserves richer context only when explicitly configured", () => {
    const context = {
      sampleRows: [{ Customer: "Acme Corp", Email: "jane.doe@example.com" }],
    };

    expect(getMjolnirAiSampleMode()).toBe("REDACTED");
    expect(JSON.stringify(sanitizeAiAnalysisContext(context))).not.toContain("jane.doe@example.com");

    vi.stubEnv("MJOLNIR_AI_SAMPLE_MODE", "FULL_DEBUG");
    expect(getMjolnirAiSampleMode()).toBe("FULL_DEBUG");
    expect(JSON.stringify(sanitizeAiAnalysisContext(context))).toContain("jane.doe@example.com");
  });

  it("does not mutate input context", () => {
    const context = {
      sampleRows: [{ Customer: "Acme Corp" }],
      nested: { formula: '=IF(A2="Acme Corp",1,0)' },
    };

    const before = JSON.stringify(context);
    const sanitized = sanitizeAiAnalysisContext(context, "REDACTED");

    expect(JSON.stringify(context)).toBe(before);
    expect(JSON.stringify(sanitized)).not.toContain("Acme Corp");
  });

  it("redacts sensitive formula literals", () => {
    const sanitized = sanitizeFormulaContext(
      '=IF({Customer}="Acme Corp","555-123-4567","ok")',
      "REDACTED"
    );

    expect(sanitized).toContain(REDACTED_SAMPLE_VALUE);
    expect(sanitized).not.toContain("Acme Corp");
    expect(sanitized).not.toContain("555-123-4567");
  });
});
