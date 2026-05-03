# SQL Server Backups

Hermod Niflheim supports first-class Microsoft SQL Server backup policies for one database, selected databases, all online user databases, or databases matched by a pattern.

## Connection Scope

SQL Server connections can be database-scoped or server-scoped.

- Database-scoped connections keep the existing Hermod behavior and connect to one configured database.
- Server-scoped connections connect through a maintenance database, usually `master`, discover online user databases from `sys.databases`, and let one policy protect multiple databases.

Hermod excludes system databases by default with `database_id > 4` and `state_desc = 'ONLINE'`.

## Backup Types

SQL Server policies can schedule:

- Full database backups: `.bak`
- Differential backups: `.dif`
- Transaction log backups: `.trn`

Transaction log backups require the database recovery model to be `FULL` or `BULK_LOGGED`. Databases in `SIMPLE` recovery model cannot run log backups.

## Where Backup Files Are Written

SQL Server `BACKUP` commands write files from the SQL Server engine's point of view, not from the Hermod worker's point of view.

For example:

```sql
BACKUP DATABASE [MyDb] TO DISK = N'C:\Backups\MyDb.bak'
```

That path is on the SQL Server host. Hermod can upload the file only when the configured path is also readable by the Hermod worker or by a future Raven/Data Agent.

## Destination Modes

### BACKUP_TO_URL

This is the preferred mode for Azure Blob where SQL Server supports `BACKUP TO URL`. SQL Server writes directly to the URL using a SQL Server Credential configured on the SQL Server instance.

Hermod records the URL target and command status. It does not re-upload the object.

### BACKUP_TO_DISK_SHARED_PATH

SQL Server writes the backup to a disk or network share path, and Hermod reads that produced file from either the same path or a configured Hermod-readable path.

When a Hermod storage target is selected, Hermod computes SHA-256 and uploads the file to S3, GCS, or another configured storage target.

### BACKUP_TO_DISK_SERVER_ONLY

SQL Server writes to a server-local path. Hermod records metadata and status, but cannot upload, checksum, or verify file readability from the worker.

Use this only when operators separately manage the server-local files, or when a future Raven/Data Agent will read them from inside the customer network.

### RAVEN_AGENT_BACKUP

This is reserved for a future on-prem agent workflow. The model and UI acknowledge the mode, but the current worker does not execute Raven agent SQL Server backup jobs.

## Object Keys

Uploaded shared-path backups use:

```text
<prefix>/mssql/<server>/<database>/<type>/YYYY/MM/DD/<database>_<TYPE>_<timestamp>_<runId>.<extension>
```

Full backups use `.bak`, differential backups use `.dif`, and log backups use `.trn`.
Manifests are written beside each database under:

```text
<prefix>/mssql/<server>/<database>/manifests/YYYY/MM/DD/<runId>.json
```

The folder layout is database-centered so restore browsing starts with server and database, then shows full, differential, and log chains. Policy IDs stay in Hermod metadata and manifests rather than being the primary browsing folder.

## Permissions

The SQL Server login used by Hermod needs permission to connect and run backups for the selected databases. Common setups use:

- `BACKUP DATABASE` permission for full and differential backups
- `BACKUP LOG` permission for transaction log backups
- `db_backupoperator` role in each protected database
- Server-level privileges where the environment standardizes on them

For `BACKUP TO URL`, the SQL Server Credential must exist and grant SQL Server access to the target Azure Blob container/path.

## Coverage

Hermod records last successful full, differential, and log backup times per policy and stores per-database run history. Coverage states are:

- `HEALTHY`: current full backup, plus current differential/log coverage when enabled.
- `DEGRADED`: a full backup exists but differential/log coverage is stale or missing.
- `FAILED`: the latest scheduled run failed.
- `NEVER_RUN`: no successful full backup exists.
- `UNSUPPORTED`: log backup coverage was requested for a database that cannot support it.

## Restore

SQL Server restore support is intentionally separate from this backup workflow.

Restore order matters:

```sql
RESTORE DATABASE [MyDb] FROM DISK = N'full.bak' WITH NORECOVERY;
RESTORE DATABASE [MyDb] FROM DISK = N'diff.dif' WITH NORECOVERY;
RESTORE LOG [MyDb] FROM DISK = N'log.trn' WITH RECOVERY;
```

Point-in-time restore uses the transaction log chain and `STOPAT` where applicable. Hermod will implement restore separately so full, differential, and log chain order is preserved.
