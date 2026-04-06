# Bifrost — Alfheim-to-Alfheim Pipeline Design

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Full Bifrost routing engine + BigQuery-to-BigQuery implementation + UI

---

## Overview

Build the Bifrost routing engine — Hermod's data dispatch system for realm-to-realm transfers. The first route type is **Alfheim-to-Alfheim** (cloud-to-cloud), implemented as **BigQuery Project A → BigQuery Project B** with optional Nidavellir forge transformation and Helheim dead letter queue.

This is the full Bifrost infrastructure: routing engine, route registry, provider abstraction, Helheim DLQ, and complete UI.

---

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐     ┌─────────────┐
│  DataSource  │     │  BifrostEngine │     │  Nidavellir  │     │  DataSource  │
│  (Source BQ) │────▶│  .execute()    │────▶│  (optional)  │────▶│  (Dest BQ)   │
│  connectionId│     │                │     │  stateless   │     │  connectionId│
└─────────────┘     │  AsyncGenerator │     │  steps only  │     └─────────────┘
                    │  10K row chunks │     └──────────────┘           │
                    │                 │                                │
                    │  ┌──────────┐   │         ┌──────────┐          │
                    │  │ RouteLog │◀──│────────▶│ Helheim  │          │
                    │  │ (run     │   │  failed │ DLQ      │          │
                    │  │  history)│   │  chunks │ (gzipped │          │
                    │  └──────────┘   │         │  NDJSON) │          │
                    └─────────────────┘         └──────────┘          │
                           ▲                                          │
                           │                                          ▼
                    ┌──────────────┐                          ┌──────────────┐
                    │  pg-boss     │                          │  Load Job    │
                    │  'run-route' │                          │  (NDJSON →   │
                    │  job handler │                          │   BQ table)  │
                    └──────────────┘                          └──────────────┘
```

### Key Principles

- **BifrostEngine is pure** — takes config, returns result. Zero knowledge of pg-boss, HTTP, or UI.
- **`route-job.handler.ts`** is the thin adapter between pg-boss and the engine.
- **Provider abstraction** — `CloudProvider` interface lets us add Snowflake, Redshift, S3 later as new files.
- **Credentials never leave the provider layer** — route config references `connectionId`, engine resolves and decrypts at the last moment.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bifrost scope | Full routing engine | Build registry, dispatch, middleware from day one |
| File structure | `src/lib/bifrost/` | Consistent with existing `src/lib/` convention |
| Job system | New `run-route` pg-boss job in existing worker | One process, separate queues, no contention |
| Credentials | Encrypted JSON in DB via `DataSource.extras` | UI-manageable, no filesystem dependency |
| Data transfer | Standard BQ client + load jobs | No gRPC deps, load jobs are free, upgrade later if needed |
| Helheim granularity | Chunk-level DLQ | Matches BQ's failure granularity (batch-level) |
| Forge integration | Stateless steps only | Stateful ops belong in the source query (BigQuery) |
| Route model | Reuse DataSource for connections | Same auth concept, route-specific config is per-route JSON |
| Schedule model | Embedded in Route | No polymorphic Schedule, no migration needed |
| UI scope | Full stack | Route editor, Helheim viewer, run history, sidebar |

---

## Data Models (Prisma)

### BifrostRoute

```prisma
model BifrostRoute {
  id                String       @id @default(cuid())
  name              String
  type              String       // "cloud-to-cloud", "ftp-ingest", etc.
  enabled           Boolean      @default(true)

  // Source
  sourceId          String
  source            DataSource   @relation("routeSource", fields: [sourceId], references: [id])
  sourceConfig      Json         // { query, dataset, incrementalKey, chunkSize? }

  // Destination
  destConnectionId  String
  destConnection    DataSource   @relation("routeDest", fields: [destConnectionId], references: [id])
  destConfig        Json         // { dataset, table, writeDisposition, autoCreateTable, schema? }

  // Optional forge transform
  transformEnabled  Boolean      @default(false)
  blueprintId       String?
  blueprint         Blueprint?   @relation(fields: [blueprintId], references: [id])

  // Embedded schedule
  frequency         String?      // "daily", "weekly", "monthly", etc.
  daysOfWeek        Int[]        @default([])
  dayOfMonth        Int?
  timeHour          Int          @default(7)
  timeMinute        Int          @default(0)
  timezone          String       @default("America/Chicago")
  nextRunAt         DateTime?
  lastCheckpoint    DateTime?    // incremental: last successful run timestamp

  // Ownership
  userId            String
  user              User         @relation(fields: [userId], references: [id])

  // Relations
  routeLogs         RouteLog[]
  helheimEntries    HelheimEntry[]
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
}
```

### RouteLog

```prisma
model RouteLog {
  id               String        @id @default(cuid())
  routeId          String
  route            BifrostRoute  @relation(fields: [routeId], references: [id])
  status           String        // "running", "completed", "partial", "failed"
  rowsExtracted    Int?
  rowsLoaded       Int?
  errorCount       Int           @default(0)
  bytesTransferred BigInt?
  duration         Int?          // milliseconds
  error            String?       // job-level error message
  triggeredBy      String        // "schedule", "manual", "webhook"
  startedAt        DateTime      @default(now())
  completedAt      DateTime?
}
```

### HelheimEntry

```prisma
model HelheimEntry {
  id            String        @id @default(cuid())
  routeId       String
  route         BifrostRoute  @relation(fields: [routeId], references: [id])
  jobId         String        // RouteLog.id that produced this failure
  chunkIndex    Int
  rowCount      Int
  errorType     String        // "load_failure", "transform_failure", "auth_failure", "timeout"
  errorMessage  String
  errorDetails  Json?         // BQ error response details
  payload       String        // base64-encoded gzipped NDJSON
  retryCount    Int           @default(0)
  maxRetries    Int           @default(3)
  nextRetryAt   DateTime?
  status        String        @default("pending") // "pending", "retrying", "recovered", "dead"
  createdAt     DateTime      @default(now())
  lastRetriedAt DateTime?
}
```

### DataSource changes

```prisma
// Add to existing DataSource model:
routesAsSource    BifrostRoute[] @relation("routeSource")
routesAsDest      BifrostRoute[] @relation("routeDest")
```

---

## CloudProvider Interface

```typescript
// src/lib/bifrost/providers/cloud-provider.interface.ts

interface CloudConnection {
  client: any;
  projectId: string;
  close(): Promise<void>;
}

interface SchemaField {
  name: string;
  type: string;       // "STRING", "INTEGER", "FLOAT", "TIMESTAMP", etc.
  mode: string;       // "NULLABLE", "REQUIRED", "REPEATED"
  description?: string;
  fields?: SchemaField[];  // nested for RECORD type
}

interface SchemaDefinition {
  fields: SchemaField[];
}

interface LoadResult {
  rowsLoaded: number;
  errors: Array<{ message: string; location?: string }>;
}

interface CloudProvider {
  readonly providerType: string;

  connect(dataSource: DataSource): Promise<CloudConnection>;

  extract(
    connection: CloudConnection,
    query: string,
    params: Record<string, any>,
    chunkSize?: number
  ): AsyncGenerator<Record<string, any>[]>;

  load(
    connection: CloudConnection,
    rows: Record<string, any>[],
    destConfig: DestConfig
  ): Promise<LoadResult>;

  getSchema(
    connection: CloudConnection,
    dataset: string,
    table: string
  ): Promise<SchemaDefinition | null>;

  createTable(
    connection: CloudConnection,
    dataset: string,
    table: string,
    schema: SchemaDefinition
  ): Promise<void>;
}
```

### BigQueryProvider implementation

- **`connect()`**: Decrypts SA key from `DataSource.extras`, creates `BigQuery({ credentials: parsedJson })`. No temp files.
- **`extract()`**: `AsyncGenerator` yielding chunks. Uses `createQueryJob()` + `getQueryResults({ maxResults: chunkSize, autoPaginate: false })` with pageToken pagination.
- **`load()`**: Converts rows to NDJSON stream via `PassThrough`, calls `table.load()` with `NEWLINE_DELIMITED_JSON` format. Free (no streaming insert costs).
- **`getSchema()`**: Returns table metadata or `null` for missing table.
- **`createTable()`**: Creates table with provided schema.

### Provider registry

```typescript
const providers: Record<string, CloudProvider> = {
  BIGQUERY: new BigQueryProvider(),
};

function getCloudProvider(type: string): CloudProvider {
  const provider = providers[type];
  if (!provider) throw new Error(`Unsupported cloud provider: ${type}`);
  return provider;
}
```

---

## BifrostEngine Execution Pipeline

```typescript
class BifrostEngine {
  async execute(route: BifrostRoute, triggeredBy: string): Promise<RouteJobResult> {
    const startTime = Date.now();
    const sourceProvider = getCloudProvider(route.source.type);
    const destProvider = getCloudProvider(route.destConnection.type);

    // 1. Connect to both endpoints
    const sourceConn = await sourceProvider.connect(route.source);
    const destConn = await destProvider.connect(route.destConnection);

    // 2. Schema validation (before any data moves)
    await this.validateOrCreateDestTable(destProvider, destConn,
      sourceProvider, sourceConn, route);

    // 3. Build query params (inject @last_run for incremental)
    const params = this.buildQueryParams(route);

    // 4. Extract → Transform → Load loop
    let totalExtracted = 0, totalLoaded = 0, errorCount = 0;
    let chunkIndex = 0;
    const routeLogId = await this.createRouteLog(route, triggeredBy);

    for await (const chunk of sourceProvider.extract(
      sourceConn, route.sourceConfig.query, params, route.sourceConfig.chunkSize
    )) {
      totalExtracted += chunk.length;

      // Optional Nidavellir transform (stateless steps only)
      const transformed = route.transformEnabled && route.blueprintId
        ? await this.forgeTransform(route.blueprintId, chunk)
        : chunk;

      try {
        const result = await destProvider.load(destConn, transformed, route.destConfig);
        totalLoaded += result.rowsLoaded;
      } catch (err) {
        await this.helheim.enqueue(route.id, routeLogId, chunkIndex, chunk, err);
        errorCount += chunk.length;
      }

      chunkIndex++;
      this.log(route.id, `Transferred ${totalLoaded} / ${totalExtracted} rows...`);
    }

    // 5. Update checkpoint for incremental runs
    if (totalLoaded > 0 && route.sourceConfig.incrementalKey) {
      await this.updateCheckpoint(route.id);
    }

    // 6. Finalize
    const duration = Date.now() - startTime;
    const status = errorCount === 0 ? 'completed' : totalLoaded > 0 ? 'partial' : 'failed';

    await this.finalizeRouteLog(routeLogId, {
      status, totalExtracted, totalLoaded, errorCount, duration
    });

    await sourceConn.close();
    await destConn.close();

    return { routeLogId, status, totalExtracted, totalLoaded, errorCount, duration };
  }
}
```

### Schema validation flow

1. Get source schema from query metadata (BQ returns schema with results)
2. `destProvider.getSchema()` → returns schema or `null`
3. If `null` + `autoCreateTable: true` → create table from source schema
4. If `null` + `autoCreateTable: false` → fail with clear error
5. If schema exists → compare fields, warn on mismatches (compatible widening OK)

### Forge transform rules

- Only **stateless** blueprint steps allowed: rename, reorder, remove, filter, calculate, format, map, default, split, concat
- **Stateful** steps rejected at route creation: sort, deduplicate, aggregate, rank, pivot, unpivot
- Rejection includes actionable suggestion: "Add ORDER BY to your source query"
- `validateBlueprintForStreaming()` validates at creation time AND blueprint selection time

---

## Helheim Dead Letter Queue

### Storage

- **Chunk-level** — one entry per failed batch (up to 10K rows)
- **Payload compressed** — gzipped NDJSON, base64-encoded for DB storage
- **Exponential backoff** — 5 min → 30 min → 2 hr, max 3 retries

### Status lifecycle

```
pending → retrying → recovered (success)
                   → pending (retry failed, retries remaining)
                   → dead (retries exhausted)
```

### Retry mechanism

Worker polls `HelheimEntry.nextRetryAt` in the 60s scheduler loop. On retry:
1. Decompress payload
2. Re-load chunk to destination
3. Success → mark `recovered`
4. Failure → increment `retryCount`, advance `nextRetryAt`
5. Max retries → mark `dead`

Future: bisect strategy (split failed chunk in half, retry halves) — schema supports it without changes.

---

## Worker Integration

New `run-route` pg-boss job type alongside existing `send-report`:

```typescript
boss.work('run-route', { teamSize: 2, teamConcurrency: 1 }, handleRouteJob);
```

Scheduler loop additions:
1. Poll `BifrostRoute.nextRunAt` — enqueue `run-route` jobs for due routes
2. Poll `HelheimEntry.nextRetryAt` — retry pending entries with due retry times
3. Advance `nextRunAt` using existing `calculateNextRun()` math from schedule-utils.ts

### Job handler

```typescript
// src/lib/bifrost/jobs/route-job.handler.ts
export async function handleRouteJob(job: { data: RouteJobPayload }) {
  const { routeId, triggeredBy } = job.data;
  const route = await loadRouteWithRelations(routeId);
  const engine = new BifrostEngine();
  return engine.execute(route, triggeredBy);
}
```

Engine is unaware of pg-boss. Handler is the thin adapter. Future unified `ScheduledJob` discriminated union is a 2-hour refactor when needed.

---

## API Routes

```
src/app/api/bifrost/
├── routes/
│   ├── route.ts              # GET (list), POST (create)
│   └── [id]/
│       ├── route.ts          # GET, PUT, DELETE
│       ├── run/route.ts      # POST — manual trigger
│       └── logs/route.ts     # GET — run history
├── helheim/
│   ├── route.ts              # GET — list DLQ entries
│   └── [id]/
│       └── retry/route.ts    # POST — retry entry
└── providers/
    └── schema/route.ts       # POST — fetch table schema (UI helper)
```

All routes: `withAuth()` wrapper, `userId` filtering, Zod validation.

---

## UI

### Pages

```
src/app/(app)/bifrost/
├── page.tsx                  # Route list (dashboard)
└── [id]/
    ├── page.tsx              # Route editor (create/edit)
    └── history/page.tsx      # Run history + Helheim viewer
```

### Route list (`/bifrost`)
- Table: name, type, source → dest, enabled toggle, last run status, next run
- "Forge New Route" button (gold primary)
- Per-row: toggle, "Run Now", edit, delete
- Status dots: green (success), amber (partial), red (failed), gray (never run)
- Heading: `ᛒ BIFROST ROUTES` (Cinzel)

### Route editor (`/bifrost/[id]`)
Four-section form:
1. **Identity** — name, type selector
2. **Source** — connection dropdown (filtered by compatible type), Monaco SQL editor, incremental key
3. **Destination** — connection dropdown, dataset+table, write disposition, auto-create toggle, schema fetch
4. **Transform** — toggle, blueprint dropdown (VALIDATED/ACTIVE only), stateful step warnings
5. **Schedule** — frequency, days, time, timezone (reuse existing pattern)

### Run history (`/bifrost/[id]/history`)
- Run log table: timestamp, status, rows, errors, duration, triggered by
- Expandable rows → Helheim entries for that run
- Helheim: chunk index, row count, error type, message, status, retry count
- "Retry" button, "View Payload" (decompress + show first 10 rows)

### Sidebar
Add "Bifrost" section with rune ᛒ (Berkanan), linking to `/bifrost`.

---

## File Structure

```
src/lib/bifrost/
├── engine.ts                        # BifrostEngine class
├── types.ts                         # RouteConfig, RouteJobResult, DestConfig, etc.
├── providers/
│   ├── cloud-provider.interface.ts  # CloudProvider, CloudConnection, SchemaDefinition
│   ├── bigquery.provider.ts         # BigQueryProvider
│   └── index.ts                     # Provider registry
├── helheim/
│   ├── dead-letter.ts               # enqueue(), retryEntry(), classifyError()
│   └── types.ts                     # HelheimEntry types
├── forge/
│   └── forge-validator.ts           # validateBlueprintForStreaming()
└── jobs/
    └── route-job.handler.ts         # pg-boss → BifrostEngine adapter

src/app/api/bifrost/                 # API routes
src/lib/validations/bifrost.ts       # Zod schemas
src/components/bifrost/              # UI components
src/app/(app)/bifrost/               # UI pages
```

---

## Testing Strategy

### Test files (~40-50 tests across 5-6 files)

**`bifrost-engine.test.ts`**:
- Happy path (3 chunks → all loaded → "completed")
- Partial failure (1/3 chunks fails → Helheim → "partial")
- Full failure (all chunks → "failed")
- Empty result set (0 rows → "completed")
- Incremental checkpoint update on success, skip on failure
- Schema validation: auto-create, missing + disabled, mismatch detection
- Transform integration and transform failure → Helheim
- Connection cleanup in try/finally

**`bigquery-provider.test.ts`**:
- connect(), extract() pagination, extract() with params
- load() NDJSON conversion, load() error handling
- getSchema() returns/null, createTable()

**`helheim.test.ts`**:
- enqueue() compression + retry schedule
- retryEntry() recovered, retry failed, exhausted → dead
- Compression round-trip

**`forge-validator.test.ts`**:
- All-stateless → valid
- Individual stateful steps → invalid with correct suggestions
- Mixed stateless + stateful → lists only stateful

**`bifrost-validation.test.ts`**:
- Zod schema validation for route CRUD
- Incompatible DataSource type → error
- Self-referencing (same connection + table) → warning

### Mocking
- Mock `@google-cloud/bigquery` (factory pattern)
- Mock Prisma `db` via `vi.mock()`
- Mock `encrypt()`/`decrypt()` for predictable values
- `vi.hoisted()` for mock variables

---

## Future Providers (interface only — not implemented)

- Snowflake
- Azure SQL / Synapse
- AWS Redshift
- S3 + Parquet (read/write)
- Google Cloud Storage (as staging)

Adding any of these = one new file in `src/lib/bifrost/providers/`.
