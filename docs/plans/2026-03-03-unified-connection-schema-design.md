# Unified Connection Schema Design

**Date:** 2026-03-03
**Status:** Approved for implementation
**Motivation:** Extensibility — prepare the schema for adding new connection types (S3, GCS, Snowflake, Google Sheets) without accumulating exclusion-based logic or adding more Prisma models.

---

## Problem

Hermod has 3 disconnected connection models:

| Model | Purpose | Bifrost-routable? |
|-------|---------|-------------------|
| `DataSource` | SQL databases + BigQuery + NetSuite | Yes (both source & dest FK) |
| `SftpConnection` | File ingest → BigQuery | No (standalone watcher) |
| `EmailConnection` | SMTP delivery | No (delivery only) |

Adding a new connection type forces: "New Prisma model? Extend DataSource with nullable fields? Which of two connector interfaces does it implement?" Each new type requires special-casing in multiple places — a network of exclusions.

### Specific issues

1. **BifrostRoute can only reference DataSource** — SFTP, S3, etc. can never be routed
2. **Two connector interfaces** (`DataSourceConnector` for reports, `CloudProvider` for Bifrost) with no overlap
3. **SFTP hard-codes BigQuery** as destination — not configurable
4. **NetSuite exists only in CloudProvider** — can't be used as a report data source
5. **DataSource has SQL-shaped fields** (host, port, database) that don't apply to S3/GCS

---

## Design

### 1. Unified Connection Model

Replace `DataSource` and `SftpConnection` with a single `Connection` model. `EmailConnection` stays separate (delivery infrastructure, not a data endpoint).

```prisma
enum ConnectionType {
  // Asgard -- Databases
  POSTGRES
  MSSQL
  MYSQL
  // Alfheim -- Cloud / APIs
  BIGQUERY
  NETSUITE
  SNOWFLAKE         // future
  // Midgard -- Files / Storage
  SFTP
  S3                // future
  GCS               // future
  GOOGLE_SHEETS     // future
}

enum ConnectionStatus {
  ACTIVE
  ERROR
  DISABLED
}

model Connection {
  id            String           @id @default(cuid())
  name          String
  type          ConnectionType
  config        Json             // Non-sensitive type-specific config (host, port, dataset, bucket, etc.)
  credentials   String?          @db.Text  // Encrypted JSON blob: passwords, tokens, service account keys
  status        ConnectionStatus @default(ACTIVE)
  lastTestedAt  DateTime?
  userId        String
  user          User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  reports          Report[]
  routesAsSource   BifrostRoute[] @relation("routeSource")
  routesAsDest     BifrostRoute[] @relation("routeDest")
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt
}
```

**Design decisions:**

- **`config` (Json, plaintext):** Host, port, database, dataset, bucket, fileFormat, sourceType. Readable, queryable via Postgres JSON operators if needed.
- **`credentials` (encrypted String):** Passwords, OAuth tokens, service account JSON keys. Single AES-256-GCM encrypted blob per connection, decrypted only at execution time.
- **`status`:** Unified health tracking (was only on SftpConnection before).
- **No SFTP operational fields** (lastFileAt, filesProcessed): These are route execution state, not connection config. They belong on BifrostRoute/RouteLog.

### 2. Per-Type Config & Credentials Schemas (Zod)

Type safety enforced at the application layer via Zod discriminated unions:

```typescript
// --- Config schemas (non-sensitive) ---

const postgresConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().default(5432),
  database: z.string().min(1),
  username: z.string().min(1),
  ssl: z.boolean().default(false),
});

const bigqueryConfig = z.object({
  projectId: z.string().min(1),
  location: z.string().default("US"),
});

const netsuiteConfig = z.object({
  accountId: z.string().min(1),
});

const sftpConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().default(2222),
  username: z.string().min(1),
  fileFormat: z.enum(["CSV", "TSV", "XLSX"]).default("CSV"),
  sourceType: z.enum(["ADP", "QUICKBOOKS", "SAP", "GENERIC_FILE", "CUSTOM_SFTP"]),
});

const s3Config = z.object({
  bucket: z.string().min(1),
  region: z.string().min(1),
  prefix: z.string().optional(),
  fileFormat: z.enum(["CSV", "TSV", "XLSX", "PARQUET", "NDJSON"]),
});

// MSSQL and MYSQL follow the same shape as Postgres (host/port/database/username)

// --- Credentials schemas (sensitive, encrypted at rest) ---

const passwordCredentials = z.object({
  password: z.string().min(1),
});

const bigqueryCredentials = z.object({
  serviceAccountKey: z.record(z.unknown()),
});

const netsuiteCredentials = z.object({
  consumerKey: z.string().min(1),
  consumerSecret: z.string().min(1),
  tokenId: z.string().min(1),
  tokenSecret: z.string().min(1),
});

const s3Credentials = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

// createConnectionSchema = discriminatedUnion("type", [...])
// Each variant pairs a config schema + credentials schema
```

**Adding a new type** = add enum value + config schema + credentials schema. No Prisma migration.

### 3. Provider Capabilities Registry

Eliminates all exclusion-based logic ("if type is NOT X"). The system only checks positive capabilities.

```typescript
interface ProviderCapabilities {
  canBeSource: boolean;
  canBeDestination: boolean;
  canQuery: boolean;         // Supports SQL/SuiteQL
  canStream: boolean;        // Supports chunked extraction
  canBulkLoad: boolean;      // Supports bulk data loading
  canListTables: boolean;    // Supports schema discovery
  fileFormats?: string[];    // For file-based types
}

const PROVIDER_REGISTRY: Record<ConnectionType, ProviderCapabilities> = {
  POSTGRES:   { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MSSQL:      { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MYSQL:      { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  BIGQUERY:   { canBeSource: true,  canBeDestination: true,  canQuery: true,  canStream: true,  canBulkLoad: true,  canListTables: true  },
  NETSUITE:   { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  SFTP:       { canBeSource: true,  canBeDestination: true,  canQuery: false, canStream: true,  canBulkLoad: true,  canListTables: false, fileFormats: ["CSV","TSV","XLSX"] },
  S3:         { canBeSource: true,  canBeDestination: true,  canQuery: false, canStream: true,  canBulkLoad: true,  canListTables: false, fileFormats: ["CSV","XLSX","PARQUET","NDJSON"] },
};
```

**UI usage:**
- Source dropdown: `connections.filter(c => caps[c.type].canBeSource)`
- Destination dropdown: `connections.filter(c => caps[c.type].canBeDestination)`
- Show SQL editor: `caps[source.type].canQuery`
- Show file format picker: `caps[source.type].fileFormats`

### 4. Unified ConnectionProvider Interface

Merges `DataSourceConnector` (report queries) and `CloudProvider` (Bifrost streaming) into one interface:

```typescript
interface ConnectionProvider {
  readonly type: ConnectionType;

  // Core -- all providers implement
  connect(connection: Connection): Promise<ProviderConnection>;
  testConnection(connection: Connection): Promise<boolean>;
  disconnect(conn: ProviderConnection): Promise<void>;

  // Optional -- gated by capabilities registry
  query?(conn: ProviderConnection, sql: string): Promise<QueryResult>;
  extract?(conn: ProviderConnection, config: SourceConfig): AsyncGenerator<Record<string, unknown>[]>;
  load?(conn: ProviderConnection, rows: Record<string, unknown>[], config: DestConfig): Promise<LoadResult>;
  getSchema?(conn: ProviderConnection, dataset: string, table: string): Promise<SchemaDefinition | null>;
  createTable?(conn: ProviderConnection, dataset: string, table: string, schema: SchemaDefinition): Promise<void>;
}

// Single registry
const providers: Record<ConnectionType, ConnectionProvider> = {
  POSTGRES:  new PostgresProvider(),
  MSSQL:     new MssqlProvider(),
  MYSQL:     new MysqlProvider(),
  BIGQUERY:  new BigQueryProvider(),
  NETSUITE:  new NetSuiteProvider(),
  SFTP:      new SftpProvider(),
};

export function getProvider(type: ConnectionType): ConnectionProvider {
  const provider = providers[type];
  if (!provider) throw new Error(`No provider for type: ${type}`);
  return provider;
}
```

Report editor calls `provider.query!(conn, sql)`. Bifrost engine calls `provider.extract!(conn, config)` and `provider.load!(conn, rows, dest)`. Same registry, same providers.

### 5. BifrostRoute Adjustments

```prisma
model BifrostRoute {
  // Source & Destination -- both reference unified Connection
  sourceId         String
  source           Connection     @relation("routeSource", fields: [sourceId], references: [id])
  sourceConfig     Json

  destId           String
  dest             Connection     @relation("routeDest", fields: [destId], references: [id])
  destConfig       Json

  // ... transform, schedule, ownership unchanged
}
```

**Dropped:** `type` field ("cloud-to-cloud", "ftp-ingest"). Derivable from `source.type -> dest.type`. Compute the label in the UI.

**Route config validated per connection type:**

```typescript
const sourceConfigs: Record<ConnectionType, z.ZodSchema> = {
  POSTGRES:  z.object({ query: z.string(), incrementalKey: z.string().optional(), chunkSize: z.number().optional() }),
  BIGQUERY:  z.object({ query: z.string(), dataset: z.string().optional(), incrementalKey: z.string().optional() }),
  NETSUITE:  z.object({ query: z.string(), recordType: z.string().optional(), fields: z.array(z.string()).optional() }),
  SFTP:      z.object({ directory: z.string(), filePattern: z.string().default("*"), parseOptions: z.object({...}).optional() }),
  S3:        z.object({ prefix: z.string(), filePattern: z.string(), parseOptions: z.object({...}).optional() }),
};

const destConfigs: Partial<Record<ConnectionType, z.ZodSchema>> = {
  BIGQUERY:  z.object({ dataset: z.string(), table: z.string(), writeDisposition: z.enum([...]), autoCreateTable: z.boolean() }),
  SFTP:      z.object({ directory: z.string(), filenamePattern: z.string() }),
  S3:        z.object({ prefix: z.string(), fileFormat: z.enum([...]) }),
  // Types that can't be destinations aren't in this map
};
```

---

## Migration Plan (Clean Cut-Over)

Pre-production, so we do a clean cut-over rather than phased dual-write. **Tests run before and after each step** to catch regressions immediately.

### Step 1: Add Connection model (additive)

- Add `Connection`, `ConnectionType`, `ConnectionStatus` to schema.prisma
- Keep old models (DataSource, SftpConnection) temporarily
- Run `db:push` to add the table
- **Test checkpoint:** existing tests still pass (nothing removed yet)

### Step 2: Write data migration script

- Script reads all DataSource records, creates Connection records with config/credentials split
- Script reads all SftpConnection records, creates Connection records
- Maps old IDs to new IDs (store mapping for FK updates)
- **Test checkpoint:** verify migration script produces correct config/credentials shapes; round-trip encrypt/decrypt test

### Step 3: Create unified provider registry

- Create `src/lib/providers/` with unified `ConnectionProvider` interface
- Port `PostgresProvider`, `MssqlProvider`, `MysqlProvider` from `connectors.ts`
- Port `BigQueryProvider`, `NetSuiteProvider` from `bifrost/providers/`
- Create `SftpProvider` from SftpConnection watcher logic
- Add capabilities registry
- **Test checkpoint:** each provider passes connect/testConnection/query or extract tests against the new Connection model shape

### Step 4: Update Report to use Connection

- `Report.dataSourceId` -> `Report.connectionId`
- Update report API routes, report runner, worker
- Update report editor component (source picker filters by `canQuery`)
- **Test checkpoint:** report CRUD, query execution, Excel export, schedule delivery all pass

### Step 5: Update BifrostRoute to use Connection

- `BifrostRoute.sourceId` -> Connection FK
- `BifrostRoute.destConnectionId` -> `BifrostRoute.destId` referencing Connection
- Drop `type` field (derive from connection types)
- Update Bifrost API routes, engine, job handler
- **Test checkpoint:** Bifrost route CRUD, manual run, scheduled run, Helheim dead-letter all pass

### Step 6: Update validation schemas

- Rewrite `connections.ts` as discriminated union over ConnectionType
- Add per-type source/dest config schemas to `bifrost.ts`
- Drop `sftp-connections.ts` (absorbed into connections.ts)
- **Test checkpoint:** validation tests pass for all connection types, route creation validates source/dest configs

### Step 7: Update UI components

- Connections page: unified CRUD, type picker drives form fields
- Bifrost route builder: source/dest dropdowns filtered by capabilities
- Report editor: source picker filtered by `canQuery`
- **Test checkpoint:** manual UI smoke test of all flows

### Step 8: Drop old models

- Remove `DataSource`, `SftpConnection` from schema.prisma
- Remove `connectors.ts`, `bifrost/providers/` (replaced by `providers/`)
- Remove old validation files
- Run `db:push` to drop old tables
- **Test checkpoint:** full test suite passes, no references to old models remain

---

## What stays unchanged

- **EmailConnection** — delivery infrastructure, not a data endpoint
- **Blueprint / Mjolnir** — transformation layer is independent of connection type
- **Schedule model** — Report schedules stay separate; BifrostRoute keeps embedded schedule
- **HelheimEntry / RouteLog** — execution tracking unchanged
- **Encryption** — same AES-256-GCM, just applied to the `credentials` JSON blob instead of individual fields

## Adding a new connection type (checklist)

1. Add value to `ConnectionType` enum in schema.prisma
2. Add config + credentials Zod schemas in `validations/connections.ts`
3. Implement `ConnectionProvider` in `src/lib/providers/<type>.provider.ts`
4. Add entry to `PROVIDER_REGISTRY` (capabilities)
5. Add source/dest config schemas in `validations/bifrost.ts` (if Bifrost-routable)
6. Run `db:push` (enum change only, no structural migration)

No other files change. No UI exclusion logic. No nullable column proliferation.
