import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BackupCoverageWidget } from "@/components/dashboard/backup-coverage-widget";
import {
  buildBackupCoverageDashboard,
  parsePartialBackupFailures,
  type BackupCoveragePolicyInput,
} from "@/lib/backups/dashboard-coverage";

const now = new Date("2026-05-11T12:00:00.000Z");
Object.assign(globalThis, { React });
const partialDatabaseError = `One or more databases failed to back up: ${[
  "anton: pg_dump: error: query failed: ERROR: permission denied for table tenants",
  "hermod: pg_dump: error: query failed: ERROR: permission denied for schema pgboss",
  "keystone_screener: pg_dump: error: query failed: ERROR: permission denied for table candidates",
  "litellm: pg_dump: error: query failed: ERROR: permission denied for table _prisma_migrations",
  "ptc: pg_dump: error: query failed: ERROR: permission denied for table tenants",
  "sample: pg_dump: error: query failed: ERROR: permission denied for table otw_bn",
].join("; ")}`;

function policy(overrides: Partial<BackupCoveragePolicyInput>): BackupCoveragePolicyInput {
  return {
    id: "policy_1",
    name: "Production Postgres",
    enabled: true,
    fullFrequency: "DAILY",
    walFrequency: "HOURLY",
    walEnabled: true,
    lastSuccessfulFullAt: "2026-05-11T02:00:00.000Z",
    lastSuccessfulWalAt: "2026-05-11T11:30:00.000Z",
    nextFullRunAt: "2026-05-12T02:00:00.000Z",
    nextWalRunAt: "2026-05-11T13:00:00.000Z",
    databaseSelectionMode: "SINGLE",
    selectedDatabases: ["prod"],
    sourceConnection: { name: "prod-pg-01", type: "POSTGRES" },
    storageTarget: { name: "Niflheim Vault", provider: "AWS_S3", status: "ACTIVE" },
    latestRun: {
      type: "WAL_ARCHIVE",
      status: "SUCCESS",
      triggeredBy: "schedule",
      startedAt: "2026-05-11T11:30:00.000Z",
    },
    latestFailedRun: null,
    ...overrides,
  };
}

describe("Backup coverage dashboard", () => {
  it("classifies a current full and WAL policy as healthy", () => {
    const dashboard = buildBackupCoverageDashboard([policy({})], now);

    expect(dashboard.totalPolicies).toBe(1);
    expect(dashboard.healthyPolicies).toBe(1);
    expect(dashboard.recentPartialPolicies).toBe(0);
    expect(dashboard.recentProblemPolicies).toBe(0);
    expect(dashboard.walEnabledPolicies).toBe(1);
    expect(dashboard.policies[0]).toMatchObject({
      databaseServer: "prod on prod-pg-01",
      storageProvider: "AWS_S3",
      storageTarget: "Niflheim Vault",
      fullBackupStatus: "HEALTHY",
      walPitrStatus: "HEALTHY",
      coverageStatus: "HEALTHY",
    });
  });

  it("classifies a recent failed latest run as warning coverage", () => {
    const dashboard = buildBackupCoverageDashboard([
      policy({
        latestRun: {
          type: "FULL_LOGICAL",
          status: "FAILED",
          triggeredBy: "schedule",
          startedAt: "2026-05-11T10:00:00.000Z",
          error: "pg_dump failed",
        },
        latestFailedRun: {
          type: "FULL_LOGICAL",
          status: "FAILED",
          triggeredBy: "schedule",
          startedAt: "2026-05-11T10:00:00.000Z",
          error: "pg_dump failed",
        },
      }),
    ], now);

    expect(dashboard.recentFailedPolicies).toBe(1);
    expect(dashboard.recentProblemPolicies).toBe(1);
    expect(dashboard.policies[0].coverageStatus).toBe("FAILED");
    expect(dashboard.policies[0].lastFailure).toMatchObject({
      type: "FULL_LOGICAL",
      error: "pg_dump failed",
    });
    expect(dashboard.policies[0].latestProblemRun).toMatchObject({
      status: "FAILED",
      type: "FULL_LOGICAL",
      error: "pg_dump failed",
    });
  });

  it("classifies a latest scheduled partial full run as degraded problem coverage", () => {
    const partialRun = {
      type: "FULL_LOGICAL",
      status: "PARTIAL",
      triggeredBy: "schedule",
      startedAt: "2026-05-11T02:00:00.000Z",
      error: partialDatabaseError,
    };
    const dashboard = buildBackupCoverageDashboard([
      policy({
        latestRun: partialRun,
        latestPartialRun: partialRun,
        latestProblemRun: partialRun,
      }),
    ], now);

    expect(dashboard.healthyPolicies).toBe(0);
    expect(dashboard.recentPartialPolicies).toBe(1);
    expect(dashboard.recentProblemPolicies).toBe(1);
    expect(dashboard.recentFailedPolicies).toBe(0);
    expect(dashboard.policies[0].coverageStatus).toBe("DEGRADED");
    expect(dashboard.policies[0].coverageReason).toBe("Latest scheduled backup run was partial");
    expect(dashboard.policies[0].fullBackupStatus).toBe("WARNING");
    expect(dashboard.policies[0].latestProblemRun).toMatchObject({
      status: "PARTIAL",
      type: "FULL_LOGICAL",
      partialFailures: {
        count: 6,
        databases: ["anton", "hermod", "keystone_screener", "litellm", "ptc", "sample"],
      },
    });
  });

  it("classifies a policy with no successful full backup as critical", () => {
    const dashboard = buildBackupCoverageDashboard([
      policy({
        lastSuccessfulFullAt: null,
        lastSuccessfulWalAt: null,
      }),
    ], now);

    expect(dashboard.policiesWithNoSuccessfulFullBackup).toBe(1);
    expect(dashboard.policies[0].fullBackupStatus).toBe("CRITICAL");
    expect(dashboard.policies[0].coverageStatus).toBe("NEVER_RUN");
  });

  it("classifies enabled stale WAL/PITR as warning", () => {
    const dashboard = buildBackupCoverageDashboard([
      policy({
        lastSuccessfulWalAt: "2026-05-10T08:00:00.000Z",
      }),
    ], now);

    expect(dashboard.policiesMissingRecentWalRun).toBe(1);
    expect(dashboard.policies[0].walPitrStatus).toBe("WARNING");
    expect(dashboard.policies[0].coverageStatus).toBe("DEGRADED");
  });

  it("returns latest backup times and next scheduled backup", () => {
    const dashboard = buildBackupCoverageDashboard([
      policy({ id: "policy_a", name: "A", nextWalRunAt: "2026-05-11T14:00:00.000Z" }),
      policy({
        id: "policy_b",
        name: "B",
        lastSuccessfulFullAt: "2026-05-11T03:00:00.000Z",
        lastSuccessfulWalAt: "2026-05-11T11:45:00.000Z",
        nextFullRunAt: "2026-05-11T12:30:00.000Z",
        nextWalRunAt: "2026-05-11T13:00:00.000Z",
      }),
    ], now);

    expect(dashboard.latestFullBackupAt).toBe("2026-05-11T03:00:00.000Z");
    expect(dashboard.latestWalArchiveAt).toBe("2026-05-11T11:45:00.000Z");
    expect(dashboard.nextScheduledBackupAt).toBe("2026-05-11T12:30:00.000Z");
    expect(dashboard.nextScheduledBackupPolicy).toBe("B");
  });

  it("does not return credentials, bucket secrets, or raw connection strings", () => {
    const dashboard = buildBackupCoverageDashboard([
      policy({
        sourceConnection: {
          name: "prod-pg-01",
          type: "POSTGRES",
          config: { connectionString: "postgres://secret-user:secret-pass@host/db" },
        } as never,
        storageTarget: {
          name: "Niflheim Vault",
          provider: "AWS_S3",
          status: "ACTIVE",
          credentials: { accessKey: "AKIA_SECRET" },
          config: { bucket: "private-bucket", secret: "bucket-secret" },
        } as never,
        rawConnectionString: "postgres://secret-user:secret-pass@host/db",
      } as never),
    ], now);
    const output = JSON.stringify(dashboard);

    expect(output).toContain("prod-pg-01");
    expect(output).toContain("Niflheim Vault");
    expect(output).not.toContain("secret-pass");
    expect(output).not.toContain("AKIA_SECRET");
    expect(output).not.toContain("bucket-secret");
    expect(output).not.toContain("private-bucket");
  });

  it("parses database labels from partial backup errors without exposing credentials", () => {
    const parsed = parsePartialBackupFailures(
      `${partialDatabaseError}; PGPASSWORD=super-secret: DATABASE_URL=postgres://user:secret-pass@host/db`
    );
    const output = JSON.stringify(parsed);

    expect(parsed).toEqual({
      count: 6,
      databases: ["anton", "hermod", "keystone_screener", "litellm", "ptc", "sample"],
    });
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("secret-pass");
    expect(output).not.toContain("PGPASSWORD");
    expect(output).not.toContain("DATABASE_URL");
  });

  it("renders partial backup problem details without rendering raw secrets", () => {
    const partialRun = {
      type: "FULL_LOGICAL",
      status: "PARTIAL",
      triggeredBy: "schedule",
      startedAt: "2026-05-11T02:00:00.000Z",
      error: `${partialDatabaseError}; PGPASSWORD=super-secret: raw env`,
    };
    const dashboard = buildBackupCoverageDashboard([
      policy({
        latestRun: partialRun,
        latestPartialRun: partialRun,
        latestProblemRun: partialRun,
      }),
    ], now);
    const html = renderToStaticMarkup(createElement(BackupCoverageWidget, { coverage: dashboard }));

    expect(html).toContain("Latest scheduled full backup was partial.");
    expect(html).toContain("6 databases failed");
    expect(html).toContain("anton, hermod, keystone_screener, litellm, ptc, sample");
    expect(html).toContain("Successful artifact exists, but selected database coverage is incomplete.");
    expect(html).not.toContain("super-secret");
    expect(html).not.toContain("PGPASSWORD");
  });
});
