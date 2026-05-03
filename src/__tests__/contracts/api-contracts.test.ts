import { describe, expect, it } from "vitest";
import { z } from "zod";
import { expectNoSensitiveKeys, expectSerializableJson } from "@/__tests__/helpers/api-test";
import {
  makeBackupRun,
  makeBackupStorageTarget,
  makeBifrostRoute,
  makeConnection,
  makePostgresBackupPolicy,
  makeRestoreJob,
  makeRouteLog,
} from "@/__tests__/helpers/factories";
import { serializeBackupRun, serializeRestoreJob, serializeStorageTarget } from "@/lib/backups/api-helpers";
import { serializeConnection } from "@/lib/connections/api-helpers";
import { serializeRouteLog } from "@/lib/bifrost/api-helpers";

const dateField = z.union([z.string(), z.date(), z.null()]);
const jsonObject = z.record(z.unknown());

const connectionListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  config: jsonObject,
  status: z.string(),
  lastTestedAt: dateField,
  folderId: z.string().nullable().optional(),
  createdAt: dateField,
  updatedAt: dateField,
}).strict();

const routeListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  sourceId: z.string().nullable(),
  ravenSatelliteId: z.string().nullable(),
  sourceConfig: jsonObject,
  destId: z.string(),
  destConfig: jsonObject,
  transformEnabled: z.boolean(),
  blueprintId: z.string().nullable(),
  frequency: z.string().nullable(),
  daysOfWeek: z.array(z.number()),
  dayOfMonth: z.number().nullable(),
  monthsOfYear: z.array(z.number()),
  timeHour: z.number(),
  timeMinute: z.number(),
  timezone: z.string(),
  nextRunAt: dateField,
  lastCheckpoint: dateField,
  cursorConfig: z.unknown().nullable(),
  needsFullReload: z.boolean(),
  userId: z.string(),
  tenantId: z.string(),
  source: z.object({ id: z.string(), name: z.string(), type: z.string() }).optional(),
  dest: z.object({ id: z.string(), name: z.string(), type: z.string() }).optional(),
  routeLogs: z.array(z.object({
    status: z.string(),
    startedAt: dateField,
    rowsLoaded: z.number().nullable(),
    errorCount: z.number(),
  })).optional(),
  createdAt: dateField,
  updatedAt: dateField,
}).passthrough();

const routeLogItemSchema = z.object({
  id: z.string(),
  routeId: z.string(),
  status: z.string(),
  rowsExtracted: z.number().nullable(),
  rowsLoaded: z.number().nullable(),
  errorCount: z.number(),
  bytesTransferred: z.string().nullable(),
  duration: z.number().nullable(),
  error: z.string().nullable(),
  triggeredBy: z.string(),
  startedAt: dateField,
  completedAt: dateField,
}).strict();

const storageTargetListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  accessMode: z.string(),
  config: jsonObject,
  status: z.string(),
  lastTestedAt: dateField,
  lastTestResult: z.unknown().nullable(),
  userId: z.string().optional(),
  tenantId: z.string().optional(),
  createdAt: dateField,
  updatedAt: dateField,
}).passthrough();

const backupRunItemSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  type: z.string(),
  status: z.string(),
  triggeredBy: z.string(),
  objectKeys: z.unknown().optional(),
  bytesWritten: z.string().nullable(),
  checksumSha256: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: dateField,
  completedAt: dateField,
}).passthrough();

const backupPolicyListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  status: z.string(),
  sourceConnectionId: z.string(),
  storageTargetId: z.string(),
  fullFrequency: z.string(),
  walFrequency: z.string().nullable(),
  retentionDays: z.number(),
  storageLayout: z.string(),
  databaseSelectionMode: z.string(),
  selectedDatabases: z.array(z.string()),
  runs: z.array(backupRunItemSchema),
  artifactCount: z.number(),
  totalBytesStored: z.string(),
  latestChecksum: z.string().nullable(),
}).passthrough();

const restoreJobItemSchema = z.object({
  id: z.string(),
  policyId: z.string(),
  backupRunId: z.string(),
  targetConnectionId: z.string(),
  mode: z.string(),
  status: z.string(),
  options: jsonObject,
  objectKey: z.string(),
  checksumSha256: z.string().nullable(),
  bytesDownloaded: z.string().nullable(),
  error: z.string().nullable(),
  triggeredByUserId: z.string(),
  tenantId: z.string(),
  startedAt: dateField,
  completedAt: dateField,
}).passthrough();

describe("critical API response contracts", () => {
  it("pins the connection list item shape and excludes credentials", () => {
    const raw = makeConnection({ credentials: "encrypted-at-rest" });
    const output = serializeConnection({
      id: raw.id,
      name: raw.name,
      type: raw.type,
      config: raw.config,
      status: raw.status,
      lastTestedAt: raw.lastTestedAt,
      folderId: raw.folderId,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      credentials: raw.credentials,
    });

    expect(connectionListItemSchema.safeParse(output).success).toBe(true);
    expectNoSensitiveKeys(output);
    expectSerializableJson(output);
  });

  it("pins the Bifrost route list item shape", () => {
    const output = {
      ...makeBifrostRoute(),
      source: { id: "conn_1", name: "Source", type: "POSTGRES" },
      dest: { id: "conn_2", name: "Dest", type: "BIGQUERY" },
      routeLogs: [{
        status: "completed",
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        rowsLoaded: 10,
        errorCount: 0,
      }],
    };

    expect(routeListItemSchema.safeParse(output).success).toBe(true);
    expectNoSensitiveKeys(output);
    expectSerializableJson(output);
  });

  it("serializes Bifrost route logs with BigInt byte counts as strings", () => {
    const output = serializeRouteLog(makeRouteLog({ bytesTransferred: BigInt(2048) }));

    expect(routeLogItemSchema.safeParse(output).success).toBe(true);
    expect(output.bytesTransferred).toBe("2048");
    expectSerializableJson(output);
  });

  it("pins backup storage target list shape and excludes credentials", () => {
    const output = serializeStorageTarget(makeBackupStorageTarget({
      credentials: "encrypted-storage-credentials",
    }));

    expect(storageTargetListItemSchema.safeParse(output).success).toBe(true);
    expectNoSensitiveKeys(output);
    expectSerializableJson(output);
  });

  it("pins PostgreSQL backup policy and run shapes with BigInt-safe byte fields", () => {
    const run = serializeBackupRun(makeBackupRun({ bytesWritten: BigInt(4096) }));
    const output = {
      ...makePostgresBackupPolicy(),
      runs: [run],
      artifactCount: 1,
      totalBytesStored: "4096",
      latestChecksum: "checksum",
    };

    expect(backupPolicyListItemSchema.safeParse(output).success).toBe(true);
    expect(backupRunItemSchema.safeParse(run).success).toBe(true);
    expect(run.bytesWritten).toBe("4096");
    expectNoSensitiveKeys(output);
    expectSerializableJson(output);
  });

  it("pins restore job shape with BigInt-safe byte fields", () => {
    const output = serializeRestoreJob(makeRestoreJob({ bytesDownloaded: BigInt(4096) }));

    expect(restoreJobItemSchema.safeParse(output).success).toBe(true);
    expect(output.bytesDownloaded).toBe("4096");
    expectNoSensitiveKeys(output);
    expectSerializableJson(output);
  });
});
