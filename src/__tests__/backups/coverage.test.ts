import { describe, expect, it } from "vitest";
import { computeBackupCoverage } from "@/lib/backups/coverage";
import { computeMssqlBackupCoverage } from "@/lib/backups/mssql/mssql-coverage";

describe("backup coverage guardrails", () => {
  const now = new Date("2026-05-03T12:00:00.000Z");

  it("reports NEVER_RUN before a successful full backup exists", () => {
    expect(computeBackupCoverage({
      fullFrequency: "DAILY",
      walFrequency: "HOURLY",
      walEnabled: false,
      lastSuccessfulFullAt: null,
      lastSuccessfulWalAt: null,
    }, null, now).status).toBe("NEVER_RUN");
  });

  it("reports HEALTHY when full and WAL coverage are current", () => {
    expect(computeBackupCoverage({
      fullFrequency: "DAILY",
      walFrequency: "HOURLY",
      walEnabled: true,
      lastSuccessfulFullAt: "2026-05-03T02:00:00.000Z",
      lastSuccessfulWalAt: "2026-05-03T11:30:00.000Z",
    }, null, now).status).toBe("HEALTHY");
  });

  it("reports DEGRADED when coverage is stale", () => {
    expect(computeBackupCoverage({
      fullFrequency: "DAILY",
      walFrequency: "HOURLY",
      walEnabled: true,
      lastSuccessfulFullAt: "2026-04-29T02:00:00.000Z",
      lastSuccessfulWalAt: "2026-05-03T11:30:00.000Z",
    }, null, now).status).toBe("DEGRADED");
  });

  it("reports FAILED when the latest scheduled run failed", () => {
    expect(computeBackupCoverage({
      fullFrequency: "DAILY",
      walFrequency: null,
      walEnabled: false,
      lastSuccessfulFullAt: "2026-05-03T02:00:00.000Z",
      lastSuccessfulWalAt: null,
    }, {
      status: "FAILED",
      triggeredBy: "schedule",
      startedAt: "2026-05-03T11:00:00.000Z",
    }, now).status).toBe("FAILED");
  });

  it("reports UNSUPPORTED for MSSQL log backups on unsupported recovery models", () => {
    expect(computeMssqlBackupCoverage({
      fullFrequency: "DAILY",
      differentialFrequency: "EVERY_6_HOURS",
      logFrequency: "HOURLY",
      lastSuccessfulFullAt: "2026-05-03T02:00:00.000Z",
      lastSuccessfulDiffAt: "2026-05-03T08:00:00.000Z",
      lastSuccessfulLogAt: null,
    }, null, { logUnsupported: true }, now).status).toBe("UNSUPPORTED");
  });
});
