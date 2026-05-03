# Backup Storage Layout

S3 and Google Cloud Storage do not have real folders; they have object keys with prefixes. Hermod uses those prefixes like folders so operators can browse backups in the same database-first way they think about restores.

The user chooses only a top-level folder/prefix, such as `AcmeBackups`. Hermod then organizes objects by engine, server, database, backup type, and date.

## Why Database-Centered

Restore is database-first. A person usually starts with "restore Accounting" or "find app_prod backups", not "find every full backup from policy abc". For that reason, policy IDs are stored in Hermod database metadata and manifest JSON objects, not used as the main browsing folder.

LiteSpeed-style simple folders often look like this:

```text
MyFolder/
  Accounting_FULL_...
  Accounting_LOG_...
```

Hermod keeps that database-first feel while making room for multiple engines, servers, backup types, and dates:

```text
MyFolder/
  mssql/
    prod-sql-01/
      Accounting/
        full/
        diff/
        log/
```

## SQL Server Layout

SQL Server full, differential, and log chains are database-specific:

```text
<prefix>/
  mssql/
    <serverSlug>/
      <databaseName>/
        full/
          YYYY/MM/DD/<databaseName>_FULL_<yyyyMMdd_HHmmss>_<runId>.bak
        diff/
          YYYY/MM/DD/<databaseName>_DIFF_<yyyyMMdd_HHmmss>_<runId>.dif
        log/
          YYYY/MM/DD/<databaseName>_LOG_<yyyyMMdd_HHmmss>_<runId>.trn
        manifests/
          YYYY/MM/DD/<runId>.json
```

Example:

```text
backups/mssql/prod-sql-01/Accounting/full/2026/05/03/Accounting_FULL_20260503_020000_run_abc123.bak
backups/mssql/prod-sql-01/Accounting/diff/2026/05/03/Accounting_DIFF_20260503_080000_run_def456.dif
backups/mssql/prod-sql-01/Accounting/log/2026/05/03/Accounting_LOG_20260503_090000_run_ghi789.trn
backups/mssql/prod-sql-01/Accounting/manifests/2026/05/03/run_abc123.json
```

## PostgreSQL Layout

PostgreSQL logical dumps are database-level, but WAL is cluster/server-level.

```text
<prefix>/
  postgres/
    <serverSlug>/
      databases/
        <databaseName>/
          full-logical/
            YYYY/MM/DD/<databaseName>_FULL_<yyyyMMdd_HHmmss>_<runId>.dump
          manifests/
            YYYY/MM/DD/<runId>.json
      wal/
        YYYY/MM/DD/<wal-segment-or-file>
      wal-manifests/
        YYYY/MM/DD/<runId>.json
```

Example:

```text
backups/postgres/prod-pg-01/databases/app_prod/full-logical/2026/05/03/app_prod_FULL_20260503_020000_run_abc123.dump
backups/postgres/prod-pg-01/databases/app_prod/manifests/2026/05/03/run_abc123.json
backups/postgres/prod-pg-01/wal/2026/05/03/000000010000000A000000FE
backups/postgres/prod-pg-01/wal-manifests/2026/05/03/run_wal_123.json
```

## Manifests

Every uploaded backup artifact should have a manifest JSON object that records the details needed for visibility and restore planning:

```json
{
  "schemaVersion": 1,
  "engine": "mssql",
  "serverSlug": "prod-sql-01",
  "serverDisplayName": "Production SQL",
  "database": "Accounting",
  "backupType": "FULL",
  "policyId": "policy_123",
  "runId": "run_abc123",
  "startedAt": "2026-05-03T02:00:00.000Z",
  "completedAt": "2026-05-03T02:08:00.000Z",
  "objectKey": "backups/mssql/prod-sql-01/Accounting/full/2026/05/03/Accounting_FULL_20260503_020000_run_abc123.bak",
  "manifestObjectKey": "backups/mssql/prod-sql-01/Accounting/manifests/2026/05/03/run_abc123.json",
  "checksumSha256": "...",
  "bytes": 123456,
  "storageProvider": "AWS_S3",
  "sourceConnectionId": "conn_123",
  "restoreChain": {
    "isBaseBackup": true,
    "requiresFullBackup": null,
    "requiresDifferentialBackup": null,
    "logSequence": null
  }
}
```

SQL Server log manifests reserve nullable LSN fields (`firstLsn`, `lastLsn`, `checkpointLsn`, `databaseBackupLsn`) so Hermod can preserve richer restore-chain metadata later.

## Safety Rules

Hermod sanitizes server, database, run, and WAL file names before placing them in object keys. It removes path traversal segments such as `..`, strips leading and trailing slashes from the user prefix, collapses duplicate separators, and replaces path separators inside names with underscores.

Restore code should always trust the stored `objectKey` and manifest records from the backup run. It should not reconstruct a backup key from the current policy, because existing backups may have been written with older layouts or a previous prefix.

Retention cleanup can list database-centered prefixes, but it must not delete the latest successful full backup for a database or SQL Server chain objects still needed by the latest retained restore chain.
