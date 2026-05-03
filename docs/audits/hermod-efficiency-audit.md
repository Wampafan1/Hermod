# Hermod Efficiency Audit

## Executive Summary

### Highest impact improvements

- Put real row limits and streaming boundaries at the provider/query layer. Today several preview, report, Bifrost, Raven, and Helheim paths load full datasets into Node memory before slicing or batching.
- Bound worker scheduler work per tick. The main scheduler has good overlap protection, but it can still fetch and enqueue unlimited due schedules, Bifrost routes, and backup policies in one 60 second tick.
- Fix SFTP watcher overlap and file buffering. The watcher can start another tick while the prior tick is still reading/parsing/uploading files, and it reads full files into memory.
- Add missing composite indexes for hot `where + orderBy` and status queries. The schema has some useful indexes, but several high-traffic list, scheduler, retry, and history queries still rely on single-column or relation traversal.
- Reduce expensive API query shapes. Several routes return all rows, full JSON payloads, or per-parent N+1 aggregates where a smaller `select`, `take`, rollup, or paginated endpoint would be enough.

### Quick wins

- Add `take` and deterministic `orderBy` to scheduler due queries in `src/lib/worker.ts`.
- Replace unbounded `Promise.all` fanout in scheduler backup/Bifrost enqueues with a small concurrency limiter.
- Add an in-flight guard to `src/lib/sftp-watcher.ts`.
- Stop `/api/reports/[id]/run` from returning unlimited result rows.
- Make `/api/raven/jobs` return a capped, selected projection instead of full job records.
- Add recipient/schedule detail endpoints so report scheduling pages do not fetch every schedule.
- Stop eager preloading of the large Univer editor chunk on every report editor mount.

### Risky changes to avoid for now

- Do not replace pg-boss or the scheduler architecture in this pass. The immediate wins are bounded queries, bounded enqueue fanout, and atomic claim semantics.
- Do not rewrite every provider around streaming at once. Start with the hot provider/query paths and add tests around batch boundaries.
- Do not denormalize tenant/user fields into every log table without a migration plan. Add safe composite indexes first, then consider denormalization only where joins remain expensive.
- Do not swap table/grid libraries or rebuild the report editor UI. Bundle and memory wins are available with lazy loading and smaller preview payloads.

### Estimated impact

- Latency: medium to high improvement for list pages, report preview, Raven polling, Helheim preview, and backup policy pages.
- Memory: high improvement for large report runs, Bifrost SQL extracts, Raven resume, Helheim retry, SFTP ingestion, and Excel generation.
- DB load: high improvement from bounded scheduler queries, better composite indexes, fewer N+1 backup aggregates, and smaller API projections.
- Worker throughput: high improvement from bounded enqueue concurrency, provider streaming, fewer long request-path operations, and SFTP overlap prevention.
- Cost: medium to high improvement from fewer BigQuery streaming inserts/table modifications, less redundant polling, lower database CPU, and fewer large in-memory retries.

## P0 Efficiency Problems

### P0-1 - Query/report paths materialize full result sets before enforcing limits

- File/function/component: `src/app/api/query/execute/route.ts:47`, `src/app/api/reports/[id]/run/route.ts:37`, `src/lib/report-runner.ts:125`, `src/lib/report-runner.ts:611`, provider `query()` methods.
- Current behavior: Preview query execution slices to `PREVIEW_ROW_LIMIT` only after the provider has returned all rows. Manual report run returns `result.rows` without an API-level cap. Scheduled report generation slices to `REPORT_ROW_LIMIT` after full materialization, then writes Excel with `workbook.xlsx.writeBuffer()`.
- Why it is inefficient: A large query can consume memory proportional to the full database result even when the UI only needs a preview. Excel generation adds another large in-memory workbook/buffer.
- Estimated impact: High memory reduction and outage prevention. Also reduces database/network time for preview queries once limits are pushed into SQL/provider execution.
- Minimal fix: Add provider-aware preview execution with an enforced row cap at the SQL/cursor layer. Add an explicit cap to `/api/reports/[id]/run` or route it through the same preview path. For scheduled exports, stream provider rows into ExcelJS streaming writer or reject/queue reports above a safe threshold before allocation.
- Risk level: Medium. SQL limit injection needs dialect-aware handling and must not alter semantic queries unexpectedly.
- Test/validation plan: Add integration tests for preview caps on Postgres/MySQL/MSSQL/BigQuery. Add a regression test where a provider returns more than the cap and assert the API response and memory profile stay bounded. Run a large synthetic export and verify heap does not grow with total source row count.

### P0-2 - Scheduler fetches and enqueues unbounded due work per tick

- File/function/component: `src/lib/worker.ts:153`, `src/lib/worker.ts:202`, `src/lib/worker.ts:236`, `src/lib/worker.ts:280`, `src/lib/worker.ts:325`, `src/lib/worker.ts:369`, `src/lib/worker.ts:414`.
- Current behavior: Every 60 seconds the worker queries all due schedules, Bifrost routes, Postgres backup policies, and MSSQL backup policies without `take`. Several classes are enqueued through unbounded `Promise.all` fanout at `src/lib/worker.ts:220`, `src/lib/worker.ts:251`, `src/lib/worker.ts:296`, `src/lib/worker.ts:340`, `src/lib/worker.ts:385`, and `src/lib/worker.ts:430`.
- Why it is inefficient: If a worker is down or many tenants become due at once, one tick can scan and enqueue an unbounded amount of work. This can saturate Postgres, pg-boss, the Node event loop, and downstream providers. `singletonKey` helps dedupe jobs, but it does not bound query load or enqueue fanout.
- Estimated impact: High worker throughput and DB stability improvement during backlog events.
- Minimal fix: Add `take` and deterministic `orderBy: { nextRunAt: "asc" }` to every due query. Process due work in bounded batches with a concurrency limit. Advance or claim due rows atomically before enqueueing so multiple workers cannot enqueue the same logical work when scaled out.
- Risk level: Medium. Batching can delay low-priority due work if limits are too small.
- Test/validation plan: Seed hundreds or thousands of due schedules/policies and assert each scheduler tick enqueues at most the configured batch size. Run two worker instances against the same database and verify singleton jobs and claimed schedules do not duplicate.

### P0-3 - Raven resume rebuilds all ingested chunks in memory

- File/function/component: `src/lib/bifrost/jobs/raven-resume.handler.ts:51`, `src/lib/bifrost/jobs/raven-resume.handler.ts:73`, `src/lib/bifrost/jobs/raven-resume.handler.ts:77`, `src/lib/bifrost/jobs/raven-resume.handler.ts:134`.
- Current behavior: The resume handler loads every `ravenIngestChunk` for a job, pushes every chunk's `data` into `allRows`, applies transforms to the full array, and then slices that array into load batches.
- Why it is inefficient: This defeats chunked ingestion. A large satellite job can require memory for the chunk rows, merged `allRows`, transformed rows, and load batch slices at the same time.
- Estimated impact: High memory reduction and lower worker crash risk for large Raven jobs.
- Minimal fix: Iterate chunks in `chunkIndex` order with a bounded `take`, transform each chunk, load batches incrementally, and delete processed chunks after durable progress. Keep job counters in the database instead of deriving everything from a fully assembled array.
- Risk level: Medium. Needs careful resume semantics so a failed chunk is not lost or double-loaded.
- Test/validation plan: Add a resume test with many chunks and a forced failure mid-run. Verify retry resumes from a durable checkpoint, row counts are correct, chunks are cleaned, and peak memory stays bounded.

### P0-4 - SFTP watcher can overlap ticks and buffers whole files

- File/function/component: `src/lib/sftp-watcher.ts:25`, `src/lib/sftp-watcher.ts:41`, `src/lib/sftp-watcher.ts:79`, `src/lib/sftp-watcher.ts:201`, `src/lib/sftp-watcher.ts:253`, `src/lib/sftp-watcher.ts:287`.
- Current behavior: The watcher runs on `setInterval` every 30 seconds, reads all active SFTP connections, scans directories synchronously, reads CSV files with `fs.readFileSync`, loads XLSX workbooks with ExcelJS, creates a new BigQuery client per file, and inserts in batches.
- Why it is inefficient: A slow tick can overlap with the next tick. Large files are fully buffered in memory. Synchronous filesystem work blocks the event loop. Per-file BigQuery setup and table checks add avoidable latency and cost.
- Estimated impact: High stability improvement for file-heavy deployments and large imports.
- Minimal fix: Add an in-flight guard around `tick()`. Add `take`/projection to the active connection query. Stream CSV parsing and apply a file size guard for XLSX. Cache BigQuery clients/table existence per connection/table for the tick. Consider using BigQuery load jobs for large files instead of streaming inserts.
- Risk level: Medium. Streaming parsing changes error boundaries and partial-file handling.
- Test/validation plan: Simulate a tick longer than 30 seconds and assert the next tick is skipped. Ingest large CSV files and verify memory remains bounded. Verify duplicate files are not loaded when ticks overlap.

## P1 High Impact Improvements

### P1-1 - Missing composite indexes on hot filters and sort paths

- File/function/component: `prisma/schema.prisma`.
- Current behavior: Some scheduler fields are indexed, such as `Schedule @@index([enabled, nextRunAt])` and `BifrostRoute @@index([enabled, nextRunAt])`, but many list/status/order paths filter by tenant, user, status, relation id, and timestamp without matching composite indexes.
- Why it is inefficient: Postgres may need bitmap scans, sorts, or relation-driven lookups for common pages and worker queries. This becomes expensive as logs, backup runs, Raven jobs, Helheim entries, recipients, and file entries grow.
- Estimated impact: High DB CPU and latency reduction on list pages, retry scans, backup pages, schedule pages, and worker guards.
- Minimal fix: Add targeted composite indexes listed in the Index Recommendations section. Do this through a Prisma migration, not `db push`.
- Risk level: Low to Medium. Indexes add write overhead and storage, so validate with `EXPLAIN ANALYZE` before adding every suggested index.
- Test/validation plan: Capture `EXPLAIN ANALYZE` for each hot query before and after. Track query latency and index size in a staging database with production-like row counts.

### P1-2 - SQL provider extract paths do not stream

- File/function/component: `src/lib/providers/postgres.provider.ts:186`, `src/lib/providers/postgres.provider.ts:193`, `src/lib/providers/mssql.provider.ts:188`, `src/lib/providers/mssql.provider.ts:204`, `src/lib/providers/mysql.provider.ts:113`, `src/lib/providers/mysql.provider.ts:124`.
- Current behavior: `query()` loads full result arrays. `extract()` for SQL providers delegates to the same full-result query and yields one large chunk.
- Why it is inefficient: Bifrost and report pipelines have batch abstractions, but SQL extraction does not honor them. Large source tables are loaded into memory before transform/load batching can help.
- Estimated impact: High memory reduction for Bifrost and scheduled report throughput.
- Minimal fix: Implement provider-level cursors or paged extraction behind `extract()`, starting with Postgres and MySQL. Respect `batchSize`/`chunkSize` and keep the public engine contract unchanged.
- Risk level: Medium. Cursor lifecycle and transaction boundaries need careful cleanup.
- Test/validation plan: Add provider tests that seed more than two chunks, consume only part of an async iterator, and assert connections/cursors close on success, failure, and cancellation.

### P1-3 - Provider pool management can grow without a total cap and repeats setup work

- File/function/component: `src/lib/providers/pool-manager.ts:23`, `src/lib/providers/pool-manager.ts:38`, `src/lib/providers/postgres.provider.ts:55`, `src/lib/providers/postgres.provider.ts:85`.
- Current behavior: Each pool is capped at five connections and idle pools are reaped, but the number of pools is unbounded. Postgres host resolution happens before pool lookup, so DNS is repeated even when a warm pool exists.
- Why it is inefficient: Many distinct tenant connections can create many idle pools. Repeated DNS resolution adds latency and avoidable resolver traffic on hot paths.
- Estimated impact: Medium to high stability improvement in multi-tenant use; medium latency reduction for repeated Postgres queries.
- Minimal fix: Add a max pool count with LRU eviction, expose pool metrics, and cache DNS resolution with TTL keyed by host. Ensure pool keys do not include secrets in logs or metrics.
- Risk level: Medium. Eviction can close pools still needed if reference handling is wrong.
- Test/validation plan: Unit test LRU eviction, idle cleanup, and concurrent `getOrCreate` calls. Add integration tests for repeated Postgres connects with one DNS resolution per TTL.

### P1-4 - Long Bifrost and Helheim operations run inside API request paths

- File/function/component: `src/app/api/bifrost/routes/[id]/run/route.ts:59`, `src/app/api/bifrost/helheim/[id]/retry/route.ts:51`.
- Current behavior: Manual Bifrost route runs execute the engine directly with a 10 minute request timeout. Manual Helheim retry decompresses the payload and loads rows inside the API route.
- Why it is inefficient: Long-running work holds a request worker, can time out in serverless or proxy environments, and duplicates worker concerns like progress, cancellation, retries, and concurrency limits.
- Estimated impact: High request stability improvement and cleaner worker throughput control.
- Minimal fix: Enqueue manual route runs and Helheim retries through pg-boss, return a log/job id immediately, and let the UI poll status. Reuse the existing route log lock semantics.
- Risk level: Medium. UI expectations change from synchronous completion to async status.
- Test/validation plan: Add API tests that manual run/retry returns quickly with a job id. Add worker tests that the enqueued job updates the existing log and preserves concurrency prevention.

### P1-5 - Backup policy list pages do N+1 run scans and artifact aggregation

- File/function/component: `src/app/api/backups/policies/route.ts:15`, `src/app/api/backups/policies/route.ts:43`, `src/app/api/backups/policies/route.ts:46`, `src/app/api/backups/policies/route.ts:53`.
- Current behavior: The policy list loads policies, then for every policy queries successful/partial runs and aggregates bytes to compute artifact counts and storage totals.
- Why it is inefficient: This is a classic N+1 pattern and can scan large backup history per policy. Object key JSON arrays make artifact counts especially expensive.
- Estimated impact: High latency and DB load reduction for backup pages with many policies/runs.
- Minimal fix: Store rollup columns such as `artifactCount` and `bytesWritten` on backup runs, then aggregate by policy in one grouped query. As an interim fix, cap run history included in the list and move full totals to a detail endpoint.
- Risk level: Medium. Rollup migration must backfill correctly.
- Test/validation plan: Seed many policies and runs, compare old/new totals, and assert route query count does not grow with policy count.

### P1-6 - BigQuery/SFTP file loading uses per-file setup and streaming inserts

- File/function/component: `src/lib/sftp-watcher.ts:253`, `src/lib/sftp-watcher.ts:287`.
- Current behavior: Each processed file creates a BigQuery client, checks/creates dataset/table, and writes batches through `table.insert()`.
- Why it is inefficient: Streaming inserts are expensive and have quota/error behavior that is less attractive for large bulk loads. Rechecking table state per file is repeated provider work.
- Estimated impact: Medium to high cost and throughput improvement for SFTP ingestion.
- Minimal fix: Cache BigQuery client/table metadata per connection/table for a watcher tick. Use streaming inserts only for small files and BigQuery load jobs for larger files.
- Risk level: Medium. Load jobs introduce asynchronous completion semantics and staging cleanup.
- Test/validation plan: Test small-file streaming and large-file load-job branches. Verify schema creation occurs once per table per tick and duplicate loads are idempotent.

### P1-7 - Raven job polling returns uncapped work

- File/function/component: `src/app/api/raven/jobs/route.ts:32`.
- Current behavior: The Raven polling endpoint returns all pending jobs for a satellite. The TODO notes rate limiting, but the query is not capped and does not project only required fields.
- Why it is inefficient: A slow satellite can accumulate a backlog and fetch too many jobs every poll. Returning full records increases API payload size and JSON serialization cost.
- Estimated impact: Medium to high DB/API reduction for Raven-heavy deployments.
- Minimal fix: Add `take`, deterministic ordering by priority/created time, and a narrow `select`. Consider a claim endpoint that atomically marks a small batch as assigned to a satellite.
- Risk level: Low to Medium. A too-small cap can reduce throughput if satellites are fast.
- Test/validation plan: Seed a backlog and assert the endpoint returns only the configured batch. Verify priority ordering and that completed/claimed jobs are excluded.

### P1-8 - GCS backup uploads are non-resumable and large objects are read multiple times

- File/function/component: `src/lib/backups/storage/gcs-storage.ts`, `src/lib/backups/postgres/postgres-backup-engine.ts`, `src/lib/backups/mssql/mssql-backup-engine.ts`.
- Current behavior: Backup engines write local dump files, compute checksums, and upload files. GCS upload uses non-resumable upload behavior.
- Why it is inefficient: Large backup files can fail late and require complete re-upload. Checksum and upload paths may reread large local files.
- Estimated impact: Medium cost/time improvement and high reliability improvement for large backups.
- Minimal fix: Use resumable GCS uploads above a size threshold. Keep checksum streaming and upload streaming separate only where required, or compute checksum during dump/write when possible.
- Risk level: Low to Medium. Provider-specific upload behavior should be tested against real storage.
- Test/validation plan: Upload files above and below the threshold, inject network failure where possible, and verify retry/resume behavior and checksum integrity.

## P2 Medium Impact Improvements

### P2-1 - Report editor eagerly preloads the large Univer chunk and duplicates preview state

- File/function/component: `src/components/reports/report-editor.tsx:21`, `src/components/reports/report-editor.tsx:60`, `src/components/reports/report-editor.tsx:68`, `src/components/reports/report-editor.tsx:90`, `src/components/reports/report-editor.tsx:160`, `src/components/reports/report-editor.tsx:454`.
- Current behavior: The report editor dynamically imports Univer, which is good, but it also preloads `./univer-sheet` on mount. It stores both raw rows and mapped rows, then displays only the first 20 preview rows.
- Why it is inefficient: Users who only edit SQL/config still download or warm a very heavy spreadsheet chunk. The client maps and stores many more rows than are rendered.
- Estimated impact: Medium bundle, memory, and editor responsiveness improvement.
- Minimal fix: Preload Univer only after query execution, first hover/focus of formatting controls, or browser idle on fast networks. Map only the visible preview slice unless full mapped data is immediately needed.
- Risk level: Low.
- Test/validation plan: Compare client bundle/network waterfall before and after. Run preview with 10,000 rows and verify React memory/state size drops while formatting behavior remains correct.

### P2-2 - Univer template extraction runs every 30 seconds

- File/function/component: `src/components/reports/univer-sheet.tsx:329`, `src/components/reports/univer-sheet.tsx:430`.
- Current behavior: `workbook.save()` is used to extract templates and a timer extracts every 30 seconds while the sheet is mounted.
- Why it is inefficient: Saving a workbook snapshot can be expensive for large sheets/styles. Fixed interval extraction does work even when nothing changed.
- Estimated impact: Medium client CPU reduction for long editing sessions.
- Minimal fix: Track dirty state from Univer edit events and debounce extraction after actual changes. Keep unload/final save extraction.
- Risk level: Low to Medium. Must ensure last edits are captured.
- Test/validation plan: Add a browser test that edits formatting, waits less than and greater than the debounce interval, saves, and verifies template persistence.

### P2-3 - Schedule UI fetches all schedules for single-report pages

- File/function/component: `src/app/(app)/reports/[id]/schedule/page.tsx:20`, `src/app/(app)/reports/[id]/schedule/page.tsx:24`, `src/components/schedule/schedule-form.tsx:77`, `src/components/schedule/schedule-form.tsx:90`, `src/app/api/schedules/route.ts:9`.
- Current behavior: A single report schedule page fetches the report and all schedules, then filters client-side. The schedule form fetches all schedules to derive previous recipient emails.
- Why it is inefficient: Schedule data and recipient arrays grow with the tenant, not with the current page.
- Estimated impact: Medium latency/payload reduction for tenants with many reports/schedules.
- Minimal fix: Add a report-specific schedule endpoint or query param. Add a lightweight recipient suggestions endpoint that returns distinct recent recipients with a cap.
- Risk level: Low.
- Test/validation plan: Add route tests for filtered schedule retrieval and recipient suggestions. Verify the page no longer calls `/api/schedules` without a filter.

### P2-4 - File upload/detect/profile routes buffer full files in memory

- File/function/component: `src/app/api/connections/csv/detect/route.ts:41`, `src/app/api/connections/excel/detect/route.ts:41`, `src/app/api/duckdb/profile/route.ts:40`, `src/app/api/file-entries/upload/route.ts:58`.
- Current behavior: Routes use `req.formData()`, `file.arrayBuffer()`, and `Buffer.from(...)` for uploaded files.
- Why it is inefficient: The entire uploaded file is buffered in the request process before parsing or storage. This competes with report/Bifrost memory and limits upload size.
- Estimated impact: Medium memory stability improvement.
- Minimal fix: Enforce explicit size limits on every upload/profile route. Stream larger files to temp storage and let DuckDB/parsers read by path. Clean temp files in a shared finally block.
- Risk level: Medium. Next.js request body handling can constrain true streaming depending on runtime.
- Test/validation plan: Add size-limit tests and large-file profile/upload tests. Verify temp files are removed on success and failure.

### P2-5 - Bifrost repeats schema/catalog work and can leave staging tables after merge failures

- File/function/component: `src/lib/bifrost/engine.ts:288`, `src/lib/bifrost/engine.ts:403`, `src/lib/bifrost/engine.ts:571`, `src/lib/bifrost/engine.ts:593`, `src/lib/bifrost/engine.ts:794`, `src/lib/bifrost/engine.ts:802`.
- Current behavior: The engine validates/creates destination tables per run, resolves REST catalog details per run, infers schema from the first batch, and preserves staging tables when merge fails.
- Why it is inefficient: Repeated schema/catalog checks add latency. Schema inference scans a full batch. Preserved staging tables are useful for debugging but can create storage/cost drift if not cleaned later.
- Estimated impact: Medium latency and storage-cost improvement.
- Minimal fix: Cache resolved REST catalog metadata in route config or a short-lived cache. Store a known destination schema fingerprint when possible. Add TTL labels/names and a cleanup job for failed staging tables.
- Risk level: Low to Medium.
- Test/validation plan: Verify route runs skip repeated catalog work when metadata is unchanged. Simulate merge failure and assert cleanup can identify stale staging tables without deleting active ones.

### P2-6 - Helheim preview and retry inflate whole compressed payloads

- File/function/component: `src/lib/bifrost/helheim/dead-letter.ts:46`, `src/lib/bifrost/helheim/dead-letter.ts:52`, `src/app/api/bifrost/helheim/[id]/route.ts:27`, `src/app/api/bifrost/helheim/[id]/retry/route.ts:51`.
- Current behavior: Dead-letter rows are converted to a full NDJSON string, gzipped, base64 encoded, then fully decompressed into arrays for preview and retry.
- Why it is inefficient: Preview only needs a few rows, but reads all rows. Retry may duplicate memory for compressed bytes, decompressed string, parsed rows, and load batches.
- Estimated impact: Medium to high memory reduction for large failed chunks.
- Minimal fix: Store a small uncompressed preview separately at dead-letter creation. For retry, stream gunzip/NDJSON parsing into provider load batches or enqueue retry as a worker job with bounded memory.
- Risk level: Medium.
- Test/validation plan: Create a large Helheim entry, fetch preview, and verify only preview data is read. Retry a large payload and assert bounded heap and correct retry counters.

### P2-7 - Recent run dashboards use offset/count patterns that may degrade

- File/function/component: `src/app/api/dashboard/recent-runs/route.ts`, `src/app/api/bifrost/routes/route.ts:11`.
- Current behavior: Recent run views combine counts, ordering, route/report joins, and offset-style pagination.
- Why it is inefficient: Offset pagination and counts get slower as log tables grow, especially when filtering through related route/report ownership.
- Estimated impact: Medium DB latency improvement for high-history tenants.
- Minimal fix: Use cursor pagination by `startedAt` and `id`. Add composite indexes for route/report log history. Consider denormalizing `tenantId`/`userId` onto log tables in a later migration if relation filters remain hot.
- Risk level: Low to Medium.
- Test/validation plan: Seed large log tables and compare `EXPLAIN ANALYZE` for offset versus cursor queries.

### P2-8 - Backup engines perform mostly serial database/file work

- File/function/component: `src/lib/backups/postgres/postgres-backup-engine.ts`, `src/lib/backups/mssql/mssql-backup-engine.ts`.
- Current behavior: Full backups process databases/files largely serially and WAL uploads are file-by-file.
- Why it is inefficient: Serial IO underuses available disk/network bandwidth, especially when backing up many small databases or WAL files.
- Estimated impact: Medium worker throughput improvement.
- Minimal fix: Add small bounded concurrency for independent uploads only. Keep dump/restore correctness serial where ordering matters.
- Risk level: Medium. Too much concurrency can overload source databases or storage APIs.
- Test/validation plan: Benchmark one, two, and four concurrent uploads against representative storage targets. Verify backup manifests and checksums remain correct.

## P3 Cleanup

### P3-1 - Shared report template type lives in a client component module

- File/function/component: `src/components/reports/report-editor.tsx:7`, `src/components/reports/univer-sheet.tsx`.
- Current behavior: `SheetTemplate` is imported as a type from the Univer component.
- Why it is inefficient: Type-only imports should erase, but this keeps server/shared concerns coupled to a heavy client component module and makes accidental runtime imports easier later.
- Estimated impact: Low bundle-risk reduction.
- Minimal fix: Move shared report template types to `src/lib/report-template-types.ts`.
- Risk level: Low.
- Test/validation plan: Run TypeScript build and inspect client bundle imports.

### P3-2 - UI polling lacks visibility/backoff guards in a few places

- File/function/component: `src/app/(app)/settings/ravens/page.tsx`, `src/components/backups/restore-status-card.tsx`.
- Current behavior: Raven status polling runs every 30 seconds. Restore status can poll every 3 seconds while active.
- Why it is inefficient: Hidden tabs and slow networks still issue repeated requests. Overlapping fetches can happen if a request outlives the interval.
- Estimated impact: Low to medium API load reduction.
- Minimal fix: Pause polling when `document.hidden`, use `AbortController`, and skip a tick if a request is in flight.
- Risk level: Low.
- Test/validation plan: Browser test hidden/visible transitions and slow mocked responses.

### P3-3 - Heavy dependency audit should be run before more client features are added

- File/function/component: `package.json`, client import graph.
- Current behavior: The project legitimately depends on heavy libraries such as Univer, Monaco, ExcelJS, DuckDB, cloud SDKs, and database drivers. Current client imports look mostly deliberate, but this needs periodic verification.
- Why it is inefficient: Server-only packages accidentally imported into client components can cause large bundles or build failures.
- Estimated impact: Low now, but prevents future regressions.
- Minimal fix: Add a bundle analyzer script and a checklist for server-only imports in client components.
- Risk level: Low.
- Test/validation plan: Run bundle analyzer in CI or before release and record top client chunks.

### P3-4 - Minor timers can be made cheaper

- File/function/component: top navigation/time display components.
- Current behavior: The UI updates time on a fixed interval.
- Why it is inefficient: Minor background work continues in hidden tabs.
- Estimated impact: Low.
- Minimal fix: Pause cosmetic timers when hidden or compute on render.
- Risk level: Low.
- Test/validation plan: Manual browser verification only.

## Index Recommendations

Validate these with `EXPLAIN ANALYZE` and add only the indexes that match real production query volume. Use Prisma migrations, not `prisma db push`, because index creation still deserves review and controlled rollout.

```prisma
model SftpConnection {
  @@index([status])
  @@index([userId, createdAt(sort: Desc)])
}
```

- Justification: The watcher scans active connections in `src/lib/sftp-watcher.ts:25`, while list pages usually filter by user and order by created time.

```prisma
model EmailConnection {
  @@index([userId, createdAt(sort: Asc)])
}
```

- Justification: SFTP processing looks up the first email connection per user, and email connection lists are user scoped.

```prisma
model Report {
  @@index([tenantId, userId, updatedAt(sort: Desc)])
  @@index([connectionId])
}
```

- Justification: Report lists filter by user/tenant and order by `updatedAt`. Connection detail/deletion checks often need report lookup by connection.

```prisma
model Schedule {
  @@index([reportId])
  @@index([emailConnectionId])
}

model Recipient {
  @@index([scheduleId])
}
```

- Justification: Schedule detail, includes, deletes, and recipient loading should not rely on relation scans as rows grow. Existing `@@index([enabled, nextRunAt])` is good for due schedule polling.

```prisma
model RunLog {
  @@index([reportId, startedAt(sort: Desc)])
  @@index([reportId, status, startedAt(sort: Desc)])
}
```

- Justification: Report lists and duplicate-run guards query recent logs by report, status, and started time. Existing separate `startedAt` and `[reportId, status]` indexes do not fully cover those shapes.

```prisma
model Connection {
  @@index([tenantId, userId, createdAt(sort: Desc)])
  @@index([tenantId, folderId])
}
```

- Justification: Connection lists and folder views are tenant/user scoped and ordered by creation time.

```prisma
model PostgresBackupPolicy {
  @@index([tenantId, userId, createdAt(sort: Desc)])
  @@index([enabled, walEnabled, nextWalRunAt])
}

model PostgresBackupRun {
  @@index([policyId, status, startedAt(sort: Desc)])
  @@index([tenantId, userId, status, startedAt(sort: Desc)])
}
```

- Justification: Policy pages and backup history aggregate/filter by policy, status, tenant, user, and recent time. WAL polling benefits from including `walEnabled`.

```prisma
model MssqlBackupPolicy {
  @@index([tenantId, userId, createdAt(sort: Desc)])
}

model MssqlBackupRun {
  @@index([policyId, status, startedAt(sort: Desc)])
  @@index([tenantId, userId, status, startedAt(sort: Desc)])
}
```

- Justification: Same history/list shape as Postgres backups.

```prisma
model BifrostRoute {
  @@index([tenantId, userId, createdAt(sort: Desc)])
  @@index([tenantId, userId, enabled, nextRunAt])
}
```

- Justification: Route list pages are tenant/user scoped. Existing `[enabled, nextRunAt]` is good for global scheduler polling; the tenant/user variant helps scoped dashboards and future tenant-aware workers.

```prisma
model RouteLog {
  @@index([routeId, status, startedAt(sort: Desc)])
  @@index([status, startedAt(sort: Desc)])
}
```

- Justification: Route log history and stale/running cleanup need status/time access. If relation-based tenant filters stay slow, consider adding `tenantId` and `userId` to `RouteLog` in a later migration.

```prisma
model HelheimEntry {
  @@index([routeId, status, createdAt(sort: Desc)])
  @@index([tenantId, status, createdAt(sort: Desc)])
  @@index([jobId])
}
```

- Justification: Helheim list/detail/retry views filter by tenant, route, status, and sometimes job id. Existing retry indexes are useful but do not cover list pages.

```prisma
model RavenJob {
  @@index([ravenId, status, priority, createdAt])
  @@index([routeId, status])
}
```

- Justification: Raven satellite polling needs a capped priority/time ordered scan by satellite and status.

```prisma
model RavenIngestChunk {
  @@index([jobId, chunkIndex])
}
```

- Justification: Resume reads chunks by job and chunk order. If this index already exists in the local schema, keep it and rely on it for streaming chunk iteration.

```prisma
model FileEntry {
  @@index([tenantId, connectionId, uploadedAt(sort: Desc)])
}
```

- Justification: File lists are usually tenant/connection scoped and ordered by upload time.

```prisma
model RealmGate {
  @@index([tenantId, status, lastPushAt(sort: Desc), createdAt(sort: Desc)])
}

model GatePush {
  @@index([gateId, createdAt(sort: Desc)])
}
```

- Justification: Gate dashboards and push history query by tenant/status/gate and recent time.

## Query Shape Recommendations

- `src/app/api/reports/[id]/run/route.ts`: Add a result cap or use the preview endpoint; do not return unlimited `rows`.
- `src/app/api/query/execute/route.ts`: Push `PREVIEW_ROW_LIMIT` into the provider query rather than slicing after full materialization.
- `src/lib/report-runner.ts`: Replace `writeBuffer()` export paths with streaming writer for large reports.
- `src/app/api/raven/jobs/route.ts`: Use `take`, `orderBy`, and `select` for only job fields satellites need.
- `src/app/api/bifrost/helheim/[id]/route.ts`: Do not fetch/decompress full payloads for a 10-row preview.
- `src/app/api/bifrost/helheim/[id]/retry/route.ts`: Enqueue retry and stream payload batches instead of loading all rows in the API route.
- `src/app/api/backups/policies/route.ts`: Replace per-policy run scans with grouped aggregates or stored rollups.
- `src/app/api/schedules/route.ts`: Add filtered/paginated variants for report-specific schedule pages and recipient suggestions.
- `src/app/api/bifrost/routes/route.ts`: Add pagination before route counts/logs grow, and keep the current `routeLogs take: 1` pattern.
- `src/app/api/connections/route.ts`: Return summary config where possible and fetch full config only on edit/detail pages.
- `src/app/api/dashboard/recent-runs/route.ts`: Prefer cursor pagination over offset/count for high-volume history.

## Worker Recommendations

- Add `take` and `orderBy` to every due query in `src/lib/worker.ts`.
- Use bounded concurrency for enqueues instead of unbounded `Promise.all`.
- Claim or advance due rows atomically before enqueueing jobs when multiple workers may run.
- Keep `schedulerTickRunning` and `withTimeout`; they are useful local overlap guards.
- Add per-job stale-running cleanup beyond startup/read-repair paths, especially for route logs and report run logs.
- Add worker metrics: due rows fetched, rows enqueued, enqueue latency, skipped ticks, job duration, and timeout count.
- Put SFTP watcher work behind a non-overlap guard or pg-boss job queue so file ingestion obeys the same concurrency controls as other background work.
- Prefer async manual job endpoints for Bifrost route runs and Helheim retries.

## UI Recommendations

- Keep Monaco and Univer dynamically imported, but remove unconditional Univer preload on report editor mount.
- Store and map only the preview rows needed for display unless the user explicitly enters formatting/export preparation.
- Replace fixed-interval Univer template extraction with dirty-event driven debounced extraction.
- Add report-specific schedule fetches and a recipient suggestion endpoint.
- Add visibility-aware polling, in-flight guards, and aborts for Raven and restore status views.
- Avoid independent component fetches for data already loaded by the page; pass route-level data down where practical.
- Add a bundle analyzer script and track the largest client chunks after any report editor changes.

## Provider Recommendations

- Add streaming/cursor-backed `extract()` for Postgres, MySQL, and MSSQL. Start with Postgres because it is likely the primary deployment path.
- Add provider-level preview execution that enforces `maxRows` without relying on caller-side `slice()`.
- Add a total pool cap and LRU eviction to `PoolManager`.
- Cache DNS resolution for Postgres hostnames with TTL and move it behind pool lookup where possible.
- Fix MySQL load batching to use parameterized values correctly and verify it does not issue malformed inserts.
- Replace MSSQL string-built multi-row inserts with safer parameterized bulk operations where possible.
- For BigQuery, avoid buffering all NDJSON into a `PassThrough` before the write stream can consume it. Stream rows into the writer with backpressure.
- Use BigQuery load jobs for large SFTP/file batches and streaming inserts only for small low-latency loads.
- Add provider metrics for rows read, rows written, batch size, query duration, connection acquisition duration, retry count, and timeout count.

## Efficiency Patch Results

### Patch 1 - Bounded worker scheduler polling and enqueue fanout

- Audit item fixed: P0-2 - Scheduler fetches and enqueues unbounded due work per tick.
- Files changed: `src/lib/worker.ts`, `src/lib/async-utils.ts`, `src/__tests__/async-utils.test.ts`.
- Why this was safe: The patch preserves existing job names, singleton keys, next-run advancement, and scheduler tick guard. It only adds deterministic due ordering, a per-query batch cap, and bounded concurrent enqueue/update work.
- Expected impact: Lower DB pressure and pg-boss enqueue pressure during backlog events; prevents one tick from attempting unlimited route/backup enqueues.
- Commands run: `npx vitest run src/__tests__/async-utils.test.ts`, `npm run test`, `npm run build`.
- Result: Focused helper tests passed; full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: A backlog larger than 100 due items now drains across multiple ticks instead of one large burst. That is intentional for stability, but very large backlogs may take longer to fully drain.

### Patch 2 - SFTP watcher overlap guard and narrower queries

- Audit item fixed: P0-4 - SFTP watcher can overlap ticks and fetches more data than needed.
- Files changed: `src/lib/sftp-watcher.ts`.
- Why this was safe: Processing semantics are unchanged. The watcher skips only when a previous tick is still running, and Prisma reads now select the fields already used by the watcher/email notification path.
- Expected impact: Prevents duplicate overlapping scans/loads during slow file processing and reduces row payload size for active SFTP/email lookups.
- Commands run: `npm run test`, `npm run build`.
- Result: Full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: File parsing/loading is still full-buffered; streaming CSV/XLSX ingestion remains a future pass.

### Patch 3 - Raven pending job polling cap and projection

- Audit item fixed: P1-7 - Raven job polling returns uncapped work.
- Files changed: `src/app/api/raven/jobs/route.ts`, `src/__tests__/raven-jobs-api.test.ts`.
- Why this was safe: The endpoint still returns a JSON array for compatibility. It now defaults to 25 jobs, caps at 100, returns `X-Next-Cursor`, and uses a narrow pending-job projection; the existing claim endpoint still returns full job details.
- Expected impact: Lower DB load, smaller JSON responses, and bounded satellite polling even when a Raven backlog grows.
- Commands run: `npx vitest run src/__tests__/raven-jobs-api.test.ts`, `npm run test`, `npm run build`.
- Result: Focused Raven API tests passed; full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: Ravens that previously depended on receiving every pending job in one poll will now need repeated polls or cursor handling for large backlogs.

### Patch 4 - Schedule-specific fetches and recipient suggestions

- Audit item fixed: P2-3 - Schedule UI fetches all schedules for single-report pages.
- Files changed: `src/app/api/schedules/route.ts`, `src/app/api/schedules/recipient-suggestions/route.ts`, `src/app/(app)/reports/[id]/schedule/page.tsx`, `src/components/schedule/schedule-form.tsx`, `src/__tests__/schedules-api.test.ts`.
- Why this was safe: Existing `/api/schedules` array behavior is preserved. The report schedule page opts into `reportId` filtering, and the form uses a capped recipient-only endpoint instead of loading schedules and recipients for every report.
- Expected impact: Smaller schedule-builder payloads and less repeated client-side schedule scanning for tenants with many schedules.
- Commands run: `npx vitest run src/__tests__/schedules-api.test.ts`, `npm run test`, `npm run build`.
- Result: Focused schedule API tests passed; full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: The main `/schedules` page still performs an unpaginated server query; that should be handled in a later UI pagination pass.

### Patch 5 - Targeted Prisma indexes for hot query shapes

- Audit item fixed: P1-1 - Missing composite indexes on hot filters and sort paths.
- Files changed: `prisma/schema.prisma`, `prisma/migrations/20260503000300_add_efficiency_indexes/migration.sql`.
- Why this was safe: Indexes were limited to patched or audited hot paths: SFTP active scans, email lookup, report list ordering, recipient schedule joins, recent run/log guards, Helheim list/detail lookups, and Raven polling. Two prefix indexes were replaced with wider composites that preserve the old prefix lookup shape.
- Expected impact: Lower DB CPU and sort cost for worker/list/retry/polling queries as row counts grow.
- Commands run: `npx prisma validate`, `npx prisma generate`, `npm run test`, `npm run build`.
- Result: Prisma validation passed; Prisma Client generated; full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: Indexes add write overhead and storage. Apply via Prisma migrations and validate with `EXPLAIN ANALYZE` on production-like data before expanding the index set further.

### Patch 6 - Removed eager Univer preload

- Audit item fixed: P2-1 - Report editor eagerly preloads the large Univer chunk.
- Files changed: `src/components/reports/report-editor.tsx`.
- Why this was safe: The existing `next/dynamic` import remains. The sheet chunk still loads when a query result renders the preview; it is just no longer fetched on every editor mount.
- Expected impact: Lower initial report-editor network and memory pressure for users editing SQL/config without running a preview.
- Commands run: `npm run test`, `npm run build`.
- Result: Full test suite passed; build passed on retry after a transient Next trace-file ENOENT.
- Remaining risk: First preview render may wait for the Univer chunk instead of benefiting from background preload. A later pass can add hover/idle preload if needed.

### Final validation summary

- `npx prisma validate`: passed.
- `npx prisma generate`: passed.
- `npm run test`: passed, 63 test files and 1005 tests.
- `npm run build`: first two attempts failed during Next build trace collection with `ENOENT` for `.next/server/app/_not-found/page.js.nft.json`; a retry without source changes passed.
- `npm run lint`: did not run lint checks because `next lint` prompted to configure ESLint and exited. No ESLint configuration was added in this optimization pass.

