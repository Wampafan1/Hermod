"use client";

import { buildBackupObjectKey, buildManifestObjectKey } from "@/lib/backups/storage/object-keys";

interface StoragePathPreviewProps {
  prefix?: string | null;
  engine?: "mssql" | "postgres" | "all";
  serverName?: string | null;
  databaseName?: string | null;
}

const SAMPLE_DATE = new Date("2026-05-03T02:00:00.000Z");

function sampleServer(engine: "mssql" | "postgres", value?: string | null): string {
  if (value?.trim()) return value;
  return engine === "mssql" ? "prod-sql-01" : "prod-pg-01";
}

function sampleDatabase(engine: "mssql" | "postgres", value?: string | null): string {
  if (value?.trim()) return value;
  return engine === "mssql" ? "Accounting" : "app_prod";
}

export function StoragePathPreview({
  prefix,
  engine = "all",
  serverName,
  databaseName,
}: StoragePathPreviewProps) {
  const mssqlServer = sampleServer("mssql", engine === "mssql" ? serverName : null);
  const postgresServer = sampleServer("postgres", engine === "postgres" ? serverName : null);
  const mssqlDatabase = sampleDatabase("mssql", engine === "mssql" ? databaseName : null);
  const postgresDatabase = sampleDatabase("postgres", engine === "postgres" ? databaseName : null);

  const mssqlRows = [
    {
      label: "MSSQL Full",
      path: buildBackupObjectKey({
        storagePrefix: prefix,
        engine: "mssql",
        serverSlug: mssqlServer,
        databaseName: mssqlDatabase,
        backupType: "full",
        timestamp: SAMPLE_DATE,
        runId: "run_abc123",
      }),
    },
    {
      label: "MSSQL Diff",
      path: buildBackupObjectKey({
        storagePrefix: prefix,
        engine: "mssql",
        serverSlug: mssqlServer,
        databaseName: mssqlDatabase,
        backupType: "diff",
        timestamp: new Date("2026-05-03T08:00:00.000Z"),
        runId: "run_def456",
      }),
    },
    {
      label: "MSSQL Log",
      path: buildBackupObjectKey({
        storagePrefix: prefix,
        engine: "mssql",
        serverSlug: mssqlServer,
        databaseName: mssqlDatabase,
        backupType: "log",
        timestamp: new Date("2026-05-03T09:00:00.000Z"),
        runId: "run_ghi789",
      }),
    },
    {
      label: "MSSQL Manifest",
      path: buildManifestObjectKey({
        storagePrefix: prefix,
        engine: "mssql",
        serverSlug: mssqlServer,
        databaseName: mssqlDatabase,
        backupType: "manifest",
        timestamp: SAMPLE_DATE,
        runId: "run_abc123",
      }),
    },
  ];

  const postgresRows = [
    {
      label: "Postgres Full",
      path: buildBackupObjectKey({
        storagePrefix: prefix,
        engine: "postgres",
        serverSlug: postgresServer,
        databaseName: postgresDatabase,
        backupType: "full-logical",
        timestamp: SAMPLE_DATE,
        runId: "run_abc123",
      }),
    },
    {
      label: "Postgres WAL",
      path: buildBackupObjectKey({
        storagePrefix: prefix,
        engine: "postgres",
        serverSlug: postgresServer,
        backupType: "wal",
        timestamp: SAMPLE_DATE,
        runId: "run_wal123",
        walFileName: "000000010000000A000000FE",
      }),
    },
    {
      label: "Postgres Manifest",
      path: buildManifestObjectKey({
        storagePrefix: prefix,
        engine: "postgres",
        serverSlug: postgresServer,
        databaseName: postgresDatabase,
        backupType: "manifest",
        timestamp: SAMPLE_DATE,
        runId: "run_abc123",
      }),
    },
    {
      label: "Postgres WAL Manifest",
      path: buildManifestObjectKey({
        storagePrefix: prefix,
        engine: "postgres",
        serverSlug: postgresServer,
        backupType: "wal-manifest",
        timestamp: SAMPLE_DATE,
        runId: "run_wal123",
      }),
    },
  ];

  const rows = engine === "mssql" ? mssqlRows : engine === "postgres" ? postgresRows : [...mssqlRows, ...postgresRows];

  return (
    <div className="border border-border bg-deep p-5">
      <h2 className="heading-norse text-xs mb-3 pb-2 border-b border-border">Path Preview</h2>
      <p className="text-text-dim text-xs tracking-wide leading-6 mb-3">
        Hermod uses this folder as the top level, then organizes backups by engine, server, database, backup type, and date.
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="border border-border/50 bg-void/40 p-3">
            <div className="label-norse mb-1">{row.label}</div>
            <div className="font-mono text-[0.68rem] text-text-dim break-all leading-5">{row.path}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
