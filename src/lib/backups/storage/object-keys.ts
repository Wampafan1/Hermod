import {
  datePath,
  joinObjectKeySegments,
  normalizeStoragePrefix,
  sanitizeObjectKeySegment,
  timestampForFilename,
} from "./path-utils";

export type BackupEngine = "mssql" | "postgres";

export type BackupObjectKeyInput = {
  storagePrefix?: string | null;
  engine: BackupEngine;
  serverSlug: string;
  databaseName?: string | null;
  backupType:
    | "full"
    | "diff"
    | "log"
    | "full-logical"
    | "wal"
    | "manifest"
    | "wal-manifest";
  timestamp: Date;
  runId: string;
  extension?: string;
  walFileName?: string;
};

function prefix(input: { storagePrefix?: string | null; engine: BackupEngine; serverSlug: string }): string {
  return joinObjectKeySegments(
    normalizeStoragePrefix(input.storagePrefix),
    input.engine,
    sanitizeObjectKeySegment(input.serverSlug, "server")
  );
}

function databaseName(value: string | null | undefined): string {
  return sanitizeObjectKeySegment(value, "database");
}

function runId(value: string): string {
  return sanitizeObjectKeySegment(value, "run");
}

function mssqlType(input: string): { folder: "full" | "diff" | "log"; label: "FULL" | "DIFF" | "LOG"; extension: string } {
  if (input === "diff" || input === "DIFFERENTIAL") return { folder: "diff", label: "DIFF", extension: "dif" };
  if (input === "log" || input === "LOG") return { folder: "log", label: "LOG", extension: "trn" };
  return { folder: "full", label: "FULL", extension: "bak" };
}

function postgresType(input: string): { folder: "full-logical"; label: "FULL"; extension: string } {
  void input;
  return { folder: "full-logical", label: "FULL", extension: "dump" };
}

export function buildBackupObjectKey(input: BackupObjectKeyInput): string {
  const base = prefix(input);
  const stamp = timestampForFilename(input.timestamp);
  const safeRunId = runId(input.runId);

  if (input.engine === "mssql") {
    if (input.backupType === "manifest" || input.backupType === "wal" || input.backupType === "wal-manifest") {
      return buildManifestObjectKey(input);
    }
    const db = databaseName(input.databaseName);
    const type = mssqlType(input.backupType);
    const extension = input.extension ?? type.extension;
    const fileName = `${db}_${type.label}_${stamp}_${safeRunId}.${extension.replace(/^\./, "")}`;
    return joinObjectKeySegments(base, db, type.folder, datePath(input.timestamp), fileName);
  }

  if (input.backupType === "wal") {
    const walFileName = sanitizeObjectKeySegment(input.walFileName, "wal-file");
    return joinObjectKeySegments(base, "wal", datePath(input.timestamp), walFileName);
  }

  if (input.backupType === "manifest" || input.backupType === "wal-manifest") {
    return buildManifestObjectKey(input);
  }

  const db = databaseName(input.databaseName);
  const type = postgresType(input.backupType);
  const extension = input.extension ?? type.extension;
  const fileName = `${db}_${type.label}_${stamp}_${safeRunId}.${extension.replace(/^\./, "")}`;
  return joinObjectKeySegments(base, "databases", db, type.folder, datePath(input.timestamp), fileName);
}

export function buildManifestObjectKey(input: BackupObjectKeyInput): string {
  const base = prefix(input);
  const safeRunId = runId(input.runId);
  const fileName = `${safeRunId}.json`;

  if (input.engine === "mssql") {
    return joinObjectKeySegments(
      base,
      databaseName(input.databaseName),
      "manifests",
      datePath(input.timestamp),
      fileName
    );
  }

  if (input.backupType === "wal-manifest") {
    return joinObjectKeySegments(base, "wal-manifests", datePath(input.timestamp), fileName);
  }

  return joinObjectKeySegments(
    base,
    "databases",
    databaseName(input.databaseName),
    "manifests",
    datePath(input.timestamp),
    fileName
  );
}

export function buildDatabaseBackupPrefix(input: {
  storagePrefix?: string | null;
  engine: BackupEngine;
  serverSlug: string;
  databaseName: string;
}): string {
  const base = prefix(input);
  if (input.engine === "postgres") {
    return joinObjectKeySegments(base, "databases", databaseName(input.databaseName));
  }
  return joinObjectKeySegments(base, databaseName(input.databaseName));
}

export function buildDatabaseBackupTypePrefix(input: {
  storagePrefix?: string | null;
  engine: BackupEngine;
  serverSlug: string;
  databaseName: string;
  backupType: string;
  date?: Date;
}): string {
  const databasePrefix = buildDatabaseBackupPrefix(input);
  const type = input.engine === "mssql"
    ? mssqlType(input.backupType).folder
    : input.backupType === "manifest"
      ? "manifests"
      : "full-logical";
  return joinObjectKeySegments(databasePrefix, type, input.date ? datePath(input.date) : null);
}

export function buildPostgresWalPrefix(input: {
  storagePrefix?: string | null;
  serverSlug: string;
  date?: Date;
}): string {
  return joinObjectKeySegments(
    prefix({ storagePrefix: input.storagePrefix, engine: "postgres", serverSlug: input.serverSlug }),
    "wal",
    input.date ? datePath(input.date) : null
  );
}

export {
  datePath,
  normalizeStoragePrefix,
  sanitizeObjectKeySegment,
  serverSlugFromConfig,
  timestampForFilename,
} from "./path-utils";
