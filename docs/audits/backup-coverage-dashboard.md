# Backup Coverage Dashboard Audit

## Partial Scheduled Backup Coverage Results

Scheduled PostgreSQL `PARTIAL` runs are not healthy coverage for multi-database policies. A partial full run means at least one selected database produced an artifact, but one or more selected databases did not produce a usable backup in that run. Hermod still preserves the current engine semantics for `lastSuccessfulFullAt`; dashboard coverage now overlays the latest scheduled run status so a current timestamp from a partial run does not hide incomplete selected-database coverage.

The dashboard now treats the latest scheduled `PARTIAL` run as `DEGRADED` coverage with the reason `Latest scheduled backup run was partial`. Summary metrics keep the existing recent failed policy count and add recent partial and recent problem policy counts. Policy cards expose the latest scheduled problem run and, for partial full runs, show that a successful artifact exists while selected database coverage is incomplete.

Database-level partial failures are parsed from the existing redacted engine error format:

```text
One or more databases failed to back up: anton: pg_dump...; hermod: pg_dump...
```

The parser only reads the database label before the first colon in each semicolon-separated segment, requires a conservative database label shape, deduplicates labels, and limits displayed database names to six. It returns a count plus display-safe names and does not parse raw environment variables, credentials, or connection strings.

Tests added in `src/__tests__/backups/backup-coverage-dashboard.test.ts` cover:

- Latest scheduled `PARTIAL` full run produces `DEGRADED` coverage.
- Recent partial and recent problem counters increment.
- Partial policies are not counted as healthy.
- The six example failed databases are parsed and displayed.
- Parser output and widget rendering do not expose raw credential/env text.
- Existing scheduled `FAILED` and healthy full/WAL behavior still work.

Validation results:

- `npx prisma validate` passed.
- `npx prisma generate` initially hit the known Windows locked-DLL `EPERM`; after moving the locked generated client aside per `AGENTS.md`, generation passed.
- `npx vitest run src/__tests__/backups/backup-coverage-dashboard.test.ts` passed.
- `npm run build` passed with existing lint warnings.
- `npm run lint` passed with existing warnings.
- `npm run test` was retried twice and both full parallel runs were blocked by unrelated `src/__tests__/gates/gate-key-hardening-e2e.test.ts` timeouts. The reported Gate timeout tests passed when run in isolation, and the three files that reported Vitest worker startup timeouts in the first full run also passed in isolation. Backup coverage tests passed.

Remaining follow-up:

- Store structured per-database backup results instead of parsing the error string, for example:

```json
{
  "databases": [
    { "name": "covered_db", "status": "SUCCESS", "objectKey": "s3/key.dump", "bytes": 12345, "checksum": "sha256..." },
    { "name": "failed_db", "status": "FAILED", "error": "pg_dump permission denied" }
  ]
}
```

That would let coverage use first-class result metadata while keeping the current redacted error text purely diagnostic.
