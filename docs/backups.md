# Niflheim Backups

Niflheim is Hermod's first-class PostgreSQL backup subsystem. It stores full logical backup archives and optional WAL archive artifacts in a configured object storage target.

## Backup Modes

Full logical backups use `pg_dump` custom format:

```bash
pg_dump --format=custom --compress=9 --no-owner --no-privileges
```

These dumps can be restored into a PostgreSQL database with `pg_restore`.

PostgreSQL connections can be database-scoped or server-scoped:

- Database-scoped connections point at one configured database and create one logical dump per full backup run.
- Server-scoped connections connect through a maintenance database, usually `postgres`, discover non-template databases from `pg_database`, and can back up one, many, all non-template databases, or databases matching a pattern.

For server-scoped policies, each selected database produces its own artifact:

```text
<prefix>/<policyId>/full-logical/<database>/YYYY/MM/DD/<database>-<timestamp>.dump
```

If one selected database fails but others dump and upload successfully, Hermod marks the run `PARTIAL` and records the per-database error while preserving the successful artifacts.

Optional WAL/PITR coverage uses `pg_receivewal`. WAL archival is not an incremental `pg_dump`; it requires PostgreSQL server-side replication configuration and a physical replication slot. WAL/PITR restore normally requires a base backup and restores into a fresh PostgreSQL data directory. Logical dumps alone are not enough for physical point-in-time recovery.

WAL transaction logs are cluster-level, not database-level. Hermod requires a server-scoped PostgreSQL connection for WAL/PITR coverage; database-scoped connections can run logical full backups only.

## Required PostgreSQL Tools

The app and worker runtime need these binaries available on `PATH`:

- `pg_dump`
- `pg_receivewal` when WAL/PITR coverage is enabled
- `pg_restore` for restore workflows outside Hermod

The Docker runner image installs `postgresql-client` so worker jobs can execute these tools.

## Required PostgreSQL Permissions

Full logical backups need a PostgreSQL role that can connect to the database and read the schemas/tables included in the dump.

Server-scoped discovery also needs permission to connect to the maintenance database and read `pg_database`. Hermod excludes template databases unless a future workflow explicitly opts into them.

WAL/PITR coverage additionally requires replication permissions, WAL archiving configuration, and a replication slot configured on the policy.

## Storage Targets

Supported storage targets:

- AWS S3: bucket, region, optional endpoint/path-style mode, access key credentials
- Google Cloud Storage: bucket, optional project ID, service account JSON

Hermod encrypts storage credentials at rest with the existing AES-256-GCM encryption helper. API responses never return decrypted credentials.

## Retention

Each policy has `retentionDays`. Retention cleanup deletes old storage objects under that policy prefix after successful backup runs. The latest successful full backup is retained even if it is older than the retention window.

## Restore Caveat

Logical dump restore and physical PITR restore are different operations:

- Logical dump: restore a `.dump` artifact with `pg_restore`.
- WAL/PITR: requires a compatible base backup plus WAL files, and is normally restored into a fresh PostgreSQL data directory.

## Logical Restore In Hermod

Hermod can queue an ADMIN/OWNER-initiated logical restore from a successful or partial `FULL_LOGICAL` backup run that has a completed artifact. For multi-database backup runs, choose the specific artifact/database to restore. The target database must already exist for the MVP.

Restore targets can be database-scoped or server-scoped. Database-scoped targets restore into their configured database. Server-scoped targets require choosing the target database discovered from the server.

The worker downloads the selected object, verifies the recorded SHA-256 checksum when one exists, then runs `pg_restore` with credentials supplied through `PGPASSWORD` instead of command-line arguments. Restore jobs record target connection, artifact key, bytes downloaded, checksum verification, duration, status, and any safe error message.

Default restore options are:

- `--clean`
- `--if-exists`
- `--no-owner`
- `--no-privileges`

Hermod requires a typed confirmation phrase before queuing a destructive restore. Restoring into the same source connection requires the stronger phrase `RESTORE SOURCE DATABASE <database>`.

## PITR/WAL Restore Preparation

Hermod does not apply WAL files to logical dumps. For `PHYSICAL_PITR_PREPARE`, Hermod creates a manifest that lists the physical base backup objects, WAL prefix/object keys, optional recovery time, storage target, policy metadata, and recovery instructions. Applying that manifest still requires a fresh PostgreSQL data directory or a managed-service PITR import flow.
