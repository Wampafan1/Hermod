import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { calculateNextBackupRun } from "@/lib/backups/schedule";
import { computeBackupCoverage } from "@/lib/backups/coverage";
import {
  buildFullBackupObjectKey,
  buildWalObjectKey,
  calculateFileSha256,
} from "@/lib/backups/postgres/artifacts";

describe("backup schedule and coverage", () => {
  it("calculates the next daily full backup at the configured local time", () => {
    const next = calculateNextBackupRun(
      {
        frequency: "DAILY",
        timeHour: 2,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      new Date("2026-05-02T06:00:00.000Z")
    );

    expect(next.toISOString()).toBe("2026-05-02T07:00:00.000Z");
  });

  it("marks coverage healthy when full and WAL timestamps are current", () => {
    const result = computeBackupCoverage(
      {
        fullFrequency: "DAILY",
        walFrequency: "HOURLY",
        walEnabled: true,
        lastSuccessfulFullAt: new Date("2026-05-02T05:00:00.000Z"),
        lastSuccessfulWalAt: new Date("2026-05-02T06:30:00.000Z"),
      },
      null,
      new Date("2026-05-02T07:00:00.000Z")
    );

    expect(result.status).toBe("HEALTHY");
  });

  it("marks coverage degraded when WAL is missing but the full backup is current", () => {
    const result = computeBackupCoverage(
      {
        fullFrequency: "DAILY",
        walFrequency: "HOURLY",
        walEnabled: true,
        lastSuccessfulFullAt: new Date("2026-05-02T05:00:00.000Z"),
        lastSuccessfulWalAt: null,
      },
      null,
      new Date("2026-05-02T07:00:00.000Z")
    );

    expect(result.status).toBe("DEGRADED");
  });
});

describe("backup artifact helpers", () => {
  it("builds deterministic full and WAL object keys", () => {
    const at = new Date("2026-05-02T07:00:00.000Z");

    expect(buildFullBackupObjectKey({
      prefix: "tenant/prod",
      policyId: "pol_123",
      database: "erp prod",
      at,
    })).toBe("tenant/prod/pol_123/full-logical/erp_prod/2026/05/02/erp_prod-20260502T070000Z.dump");

    expect(buildWalObjectKey({
      prefix: "tenant/prod",
      policyId: "pol_123",
      fileName: "00000001000000000000000A",
      at,
    })).toBe("tenant/prod/pol_123/wal/2026/05/02/00000001000000000000000A");
  });

  it("ignores empty prefix path segments instead of turning them into postgres", () => {
    expect(buildFullBackupObjectKey({
      prefix: "niflheim/",
      policyId: "pol_123",
      database: "anton",
      at: new Date("2026-05-03T01:25:32.000Z"),
    })).toBe("niflheim/pol_123/full-logical/anton/2026/05/03/anton-20260503T012532Z.dump");
  });

  it("computes SHA-256 checksums for backup files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "hermod-checksum-test-"));
    const filePath = path.join(tempDir, "backup.dump");
    await writeFile(filePath, "niflheim");

    try {
      await expect(calculateFileSha256(filePath)).resolves.toBe(
        "98fd0d259133fd5332ff35a3c6cfcfdf8b3c5f0dbf973809f4df6b6cf4b741a2"
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
