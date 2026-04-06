# Unified Connection Schema — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `DataSource` + `SftpConnection` with a single `Connection` model, unify `DataSourceConnector` + `CloudProvider` into `ConnectionProvider`, and add a capabilities registry to eliminate exclusion-based logic.

**Architecture:** One Prisma `Connection` model (type enum + config JSON + encrypted credentials string), one `ConnectionProvider` interface with optional methods, one `PROVIDER_CAPABILITIES` registry. `EmailConnection` stays separate. Clean cut-over with test checkpoints before/after each step.

**Tech Stack:** Prisma (PostgreSQL), Zod validation, TypeScript, Vitest, Next.js 14 App Router

**Design doc:** `docs/plans/2026-03-03-unified-connection-schema-design.md`

---

## Task 1: Provider Types, Capabilities Registry & Validation Schemas

**Files:**
- Create: `src/lib/providers/types.ts`
- Create: `src/lib/providers/capabilities.ts`
- Create: `src/lib/validations/unified-connections.ts`
- Create: `src/__tests__/providers/types-and-capabilities.test.ts`
- Create: `src/__tests__/providers/unified-connection-validation.test.ts`

### Step 1: Write failing tests for types and capabilities

```typescript
// src/__tests__/providers/types-and-capabilities.test.ts
import { describe, it, expect } from "vitest";
import {
  ConnectionType,
  PROVIDER_CAPABILITIES,
  getCapabilities,
  canBeSource,
  canBeDestination,
  canQuery,
} from "@/lib/providers/capabilities";

describe("PROVIDER_CAPABILITIES", () => {
  it("has an entry for every ConnectionType", () => {
    const types: ConnectionType[] = [
      "POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP",
    ];
    for (const t of types) {
      expect(PROVIDER_CAPABILITIES[t]).toBeDefined();
    }
  });

  it("BIGQUERY can be both source and destination", () => {
    const caps = getCapabilities("BIGQUERY");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(true);
    expect(caps.canQuery).toBe(true);
    expect(caps.canBulkLoad).toBe(true);
  });

  it("NETSUITE is source-only and queryable", () => {
    const caps = getCapabilities("NETSUITE");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(false);
    expect(caps.canQuery).toBe(true);
  });

  it("SFTP can be source and destination but not queryable", () => {
    const caps = getCapabilities("SFTP");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(true);
    expect(caps.canQuery).toBe(false);
    expect(caps.fileFormats).toContain("CSV");
  });

  it("SQL databases are source-only and queryable", () => {
    for (const t of ["POSTGRES", "MSSQL", "MYSQL"] as ConnectionType[]) {
      const caps = getCapabilities(t);
      expect(caps.canBeSource).toBe(true);
      expect(caps.canBeDestination).toBe(false);
      expect(caps.canQuery).toBe(true);
    }
  });

  it("helper functions filter correctly", () => {
    expect(canBeSource("POSTGRES")).toBe(true);
    expect(canBeDestination("POSTGRES")).toBe(false);
    expect(canQuery("SFTP")).toBe(false);
    expect(canBeDestination("BIGQUERY")).toBe(true);
  });

  it("throws for unknown type", () => {
    expect(() => getCapabilities("UNKNOWN" as ConnectionType)).toThrow();
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx vitest run src/__tests__/providers/types-and-capabilities.test.ts
```
Expected: FAIL — modules don't exist yet.

### Step 3: Implement types and capabilities

```typescript
// src/lib/providers/types.ts
export type ConnectionType =
  | "POSTGRES"
  | "MSSQL"
  | "MYSQL"
  | "BIGQUERY"
  | "NETSUITE"
  | "SFTP";

export type ConnectionStatus = "ACTIVE" | "ERROR" | "DISABLED";

export interface ProviderCapabilities {
  canBeSource: boolean;
  canBeDestination: boolean;
  canQuery: boolean;
  canStream: boolean;
  canBulkLoad: boolean;
  canListTables: boolean;
  fileFormats?: string[];
}

/** Minimal shape for provider operations — DB row or test payload */
export interface ConnectionLike {
  type: ConnectionType;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface ProviderConnection {
  close(): Promise<void>;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

// Re-export Bifrost types that providers share
export type { SourceConfig, DestConfig, LoadResult, SchemaDefinition, SchemaField } from "@/lib/bifrost/types";
```

```typescript
// src/lib/providers/capabilities.ts
import type { ConnectionType, ProviderCapabilities } from "./types";

export type { ConnectionType } from "./types";

export const PROVIDER_CAPABILITIES: Record<ConnectionType, ProviderCapabilities> = {
  POSTGRES:  { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MSSQL:     { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  MYSQL:     { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  BIGQUERY:  { canBeSource: true,  canBeDestination: true,  canQuery: true,  canStream: true,  canBulkLoad: true,  canListTables: true  },
  NETSUITE:  { canBeSource: true,  canBeDestination: false, canQuery: true,  canStream: true,  canBulkLoad: false, canListTables: true  },
  SFTP:      { canBeSource: true,  canBeDestination: true,  canQuery: false, canStream: true,  canBulkLoad: true,  canListTables: false, fileFormats: ["CSV","TSV","XLSX"] },
};

export function getCapabilities(type: ConnectionType): ProviderCapabilities {
  const caps = PROVIDER_CAPABILITIES[type];
  if (!caps) throw new Error(`Unknown connection type: ${type}`);
  return caps;
}

export function canBeSource(type: ConnectionType): boolean {
  return getCapabilities(type).canBeSource;
}

export function canBeDestination(type: ConnectionType): boolean {
  return getCapabilities(type).canBeDestination;
}

export function canQuery(type: ConnectionType): boolean {
  return getCapabilities(type).canQuery;
}
```

### Step 4: Run tests to verify they pass

```bash
npx vitest run src/__tests__/providers/types-and-capabilities.test.ts
```
Expected: PASS

### Step 5: Write failing validation tests

```typescript
// src/__tests__/providers/unified-connection-validation.test.ts
import { describe, it, expect } from "vitest";
import {
  createConnectionSchema,
  connectionConfigSchemas,
  connectionCredentialsSchemas,
} from "@/lib/validations/unified-connections";

describe("unified connection validation", () => {
  describe("POSTGRES", () => {
    it("accepts valid postgres connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { host: "localhost", port: 5432, database: "mydb", username: "user", ssl: false },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects postgres without host", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { port: 5432, database: "mydb", username: "user" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(false);
    });

    it("defaults port to 5432", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { host: "localhost", database: "mydb", username: "user" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(5432);
      }
    });
  });

  describe("BIGQUERY", () => {
    it("accepts valid bigquery connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My BQ",
        type: "BIGQUERY",
        config: { projectId: "my-project", location: "US" },
        credentials: { serviceAccountKey: { type: "service_account", project_id: "p" } },
      });
      expect(result.success).toBe(true);
    });

    it("rejects bigquery without projectId", () => {
      const result = createConnectionSchema.safeParse({
        name: "My BQ",
        type: "BIGQUERY",
        config: { location: "US" },
        credentials: { serviceAccountKey: {} },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("NETSUITE", () => {
    it("accepts valid netsuite connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My NS",
        type: "NETSUITE",
        config: { accountId: "12345_SB1" },
        credentials: {
          consumerKey: "ck", consumerSecret: "cs",
          tokenId: "ti", tokenSecret: "ts",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects netsuite without tokenId", () => {
      const result = createConnectionSchema.safeParse({
        name: "My NS",
        type: "NETSUITE",
        config: { accountId: "12345" },
        credentials: { consumerKey: "ck", consumerSecret: "cs", tokenSecret: "ts" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SFTP", () => {
    it("accepts valid sftp connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: {
          host: "sftp.example.com", port: 22, username: "user",
          fileFormat: "CSV", sourceType: "GENERIC_FILE",
        },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown sourceType", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: { host: "h", port: 22, username: "u", fileFormat: "CSV", sourceType: "UNKNOWN" },
        credentials: { password: "s" },
      });
      expect(result.success).toBe(false);
    });

    it("defaults port to 2222", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: { host: "h", username: "u", fileFormat: "CSV", sourceType: "ADP" },
        credentials: { password: "s" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(2222);
      }
    });
  });

  describe("cross-type", () => {
    it("rejects empty name", () => {
      const result = createConnectionSchema.safeParse({
        name: "",
        type: "POSTGRES",
        config: { host: "h", port: 5432, database: "d", username: "u" },
        credentials: { password: "p" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown type", () => {
      const result = createConnectionSchema.safeParse({
        name: "X",
        type: "UNKNOWN",
        config: {},
        credentials: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe("config/credentials schema maps", () => {
    it("has a config schema for each supported type", () => {
      for (const t of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]) {
        expect(connectionConfigSchemas[t]).toBeDefined();
      }
    });

    it("has a credentials schema for each supported type", () => {
      for (const t of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]) {
        expect(connectionCredentialsSchemas[t]).toBeDefined();
      }
    });
  });
});
```

### Step 6: Run tests to verify they fail

```bash
npx vitest run src/__tests__/providers/unified-connection-validation.test.ts
```
Expected: FAIL — module doesn't exist yet.

### Step 7: Implement unified validation schemas

```typescript
// src/lib/validations/unified-connections.ts
import { z } from "zod";

// ─── Config schemas (non-sensitive, stored in config JSON) ───────

const sqlConfig = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  ssl: z.boolean().default(false),
});

const postgresConfig = sqlConfig.extend({ port: z.coerce.number().int().min(1).max(65535).default(5432) });
const mssqlConfig    = sqlConfig.extend({ port: z.coerce.number().int().min(1).max(65535).default(1433) });
const mysqlConfig    = sqlConfig.extend({ port: z.coerce.number().int().min(1).max(65535).default(3306) });

const bigqueryConfig = z.object({
  projectId: z.string().min(1),
  location: z.string().default("US"),
});

const netsuiteConfig = z.object({
  accountId: z.string().min(1),
});

const sftpConfig = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(2222),
  username: z.string().min(1),
  fileFormat: z.enum(["CSV", "TSV", "XLSX"]).default("CSV"),
  sourceType: z.enum(["ADP", "QUICKBOOKS", "SAP", "GENERIC_FILE", "CUSTOM_SFTP"]),
});

// ─── Credentials schemas (sensitive, encrypted at rest) ─────────

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

// ─── Schema maps (for programmatic access per type) ─────────────

export const connectionConfigSchemas: Record<string, z.ZodTypeAny> = {
  POSTGRES: postgresConfig,
  MSSQL: mssqlConfig,
  MYSQL: mysqlConfig,
  BIGQUERY: bigqueryConfig,
  NETSUITE: netsuiteConfig,
  SFTP: sftpConfig,
};

export const connectionCredentialsSchemas: Record<string, z.ZodTypeAny> = {
  POSTGRES: passwordCredentials,
  MSSQL: passwordCredentials,
  MYSQL: passwordCredentials,
  BIGQUERY: bigqueryCredentials,
  NETSUITE: netsuiteCredentials,
  SFTP: passwordCredentials,
};

// ─── Discriminated union for create ─────────────────────────────

const baseFields = {
  name: z.string().min(1).max(200),
};

export const createConnectionSchema = z.discriminatedUnion("type", [
  z.object({ ...baseFields, type: z.literal("POSTGRES"),  config: postgresConfig,  credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("MSSQL"),     config: mssqlConfig,     credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("MYSQL"),     config: mysqlConfig,     credentials: passwordCredentials }),
  z.object({ ...baseFields, type: z.literal("BIGQUERY"),  config: bigqueryConfig,  credentials: bigqueryCredentials }),
  z.object({ ...baseFields, type: z.literal("NETSUITE"),  config: netsuiteConfig,  credentials: netsuiteCredentials }),
  z.object({ ...baseFields, type: z.literal("SFTP"),      config: sftpConfig,      credentials: passwordCredentials }),
]);

export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.unknown()).optional(),
  credentials: z.record(z.unknown()).optional(),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
```

### Step 8: Run all tests to verify they pass

```bash
npx vitest run src/__tests__/providers/
```
Expected: ALL PASS

### Step 9: Commit

```bash
git add src/lib/providers/types.ts src/lib/providers/capabilities.ts src/lib/validations/unified-connections.ts src/__tests__/providers/
git commit -m "feat: add provider types, capabilities registry, and unified connection validation schemas"
```

---

## Task 2: Add Connection Model to Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Prerequisite:** Task 1

### Step 1: Run existing test suite (before checkpoint)

```bash
npx vitest run
```
Expected: ALL PASS (establishes baseline)

### Step 2: Add Connection model alongside existing models

Add to `prisma/schema.prisma` AFTER the existing `DataSource` model. **Do NOT remove any existing models.**

```prisma
// ─── Unified Connections ──────────────────────────────────────

enum ConnectionType {
  POSTGRES
  MSSQL
  MYSQL
  BIGQUERY
  NETSUITE
  SFTP
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
  config        Json
  credentials   String?          @db.Text
  status        ConnectionStatus @default(ACTIVE)
  lastTestedAt  DateTime?
  userId        String
  user          User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
}
```

Also add to the `User` model:
```prisma
connections_v2  Connection[]
```

**Important:** Do NOT add relations to Report or BifrostRoute yet — those FKs change in later tasks. The model is additive only.

### Step 3: Push schema to database

```bash
npx prisma db push
npx prisma generate
```
Expected: Success — additive change, no data loss.

### Step 4: Run existing test suite (after checkpoint)

```bash
npx vitest run
```
Expected: ALL PASS — nothing broken.

### Step 5: Commit

```bash
git add prisma/schema.prisma
git commit -m "feat: add Connection model to Prisma schema (additive, alongside old models)"
```

---

## Task 3: Implement Unified ConnectionProvider Interface and Port SQL Providers

**Files:**
- Create: `src/lib/providers/provider.ts` (interface + helpers)
- Create: `src/lib/providers/postgres.provider.ts`
- Create: `src/lib/providers/mssql.provider.ts`
- Create: `src/lib/providers/mysql.provider.ts`
- Create: `src/__tests__/providers/sql-providers.test.ts`

**Prerequisite:** Task 1

### Step 1: Write failing tests for provider interface and SQL providers

The SQL provider tests should validate:
- `connect()` returns a ProviderConnection with `close()` method
- `testConnection()` returns boolean
- `query()` returns `{ columns, rows }`
- `extract()` yields chunks

Reference existing connector patterns from `src/lib/connectors.ts` (lines 30–185 for Postgres/MSSQL/MySQL).

```typescript
// src/__tests__/providers/sql-providers.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database drivers BEFORE imports
const mockPgQuery = vi.fn();
const mockPgEnd = vi.fn();
vi.mock("pg", () => ({
  default: { Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: mockPgQuery,
    end: mockPgEnd,
  }))},
}));

import { PostgresProvider } from "@/lib/providers/postgres.provider";
import type { ConnectionLike } from "@/lib/providers/types";

const pgConn: ConnectionLike = {
  type: "POSTGRES",
  config: { host: "localhost", port: 5432, database: "test", username: "user", ssl: false },
  credentials: { password: "secret" },
};

describe("PostgresProvider", () => {
  let provider: PostgresProvider;

  beforeEach(() => {
    provider = new PostgresProvider();
    vi.clearAllMocks();
  });

  it("connect() returns ProviderConnection with close()", async () => {
    const conn = await provider.connect(pgConn);
    expect(conn).toBeDefined();
    expect(typeof conn.close).toBe("function");
  });

  it("query() returns columns and rows", async () => {
    mockPgQuery.mockResolvedValueOnce({
      fields: [{ name: "id" }, { name: "name" }],
      rows: [{ id: 1, name: "Alice" }],
    });
    const conn = await provider.connect(pgConn);
    const result = await provider.query!(conn, "SELECT * FROM users");
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toHaveLength(1);
  });

  it("testConnection() returns true on success", async () => {
    mockPgQuery.mockResolvedValueOnce({ rows: [{ "1": 1 }] });
    const result = await provider.testConnection(pgConn);
    expect(result).toBe(true);
  });

  it("testConnection() returns false on error", async () => {
    mockPgQuery.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await provider.testConnection(pgConn);
    expect(result).toBe(false);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npx vitest run src/__tests__/providers/sql-providers.test.ts
```
Expected: FAIL

### Step 3: Implement provider interface and helpers

```typescript
// src/lib/providers/provider.ts
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
  SourceConfig,
  DestConfig,
  LoadResult,
  SchemaDefinition,
} from "./types";

export interface ConnectionProvider {
  readonly type: string;

  connect(connection: ConnectionLike): Promise<ProviderConnection>;
  testConnection(connection: ConnectionLike): Promise<boolean>;

  // Optional — gated by capabilities
  query?(conn: ProviderConnection, sql: string): Promise<QueryResult>;
  extract?(conn: ProviderConnection, config: SourceConfig): AsyncGenerator<Record<string, unknown>[]>;
  load?(conn: ProviderConnection, rows: Record<string, unknown>[], config: DestConfig): Promise<LoadResult>;
  getSchema?(conn: ProviderConnection, dataset: string, table: string): Promise<SchemaDefinition | null>;
  createTable?(conn: ProviderConnection, dataset: string, table: string, schema: SchemaDefinition): Promise<void>;
}

export const CONNECTION_TIMEOUT = 30_000;
export const QUERY_TIMEOUT = 120_000;
```

### Step 4: Implement PostgresProvider

Port from `src/lib/connectors.ts` lines 30-80 but adapted to new interface:

```typescript
// src/lib/providers/postgres.provider.ts
import pg from "pg";
import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection, QueryResult, SourceConfig } from "./types";
import { CONNECTION_TIMEOUT, QUERY_TIMEOUT } from "./provider";

interface PgConnection extends ProviderConnection {
  client: InstanceType<typeof pg.Client>;
}

export class PostgresProvider implements ConnectionProvider {
  readonly type = "POSTGRES";

  async connect(connection: ConnectionLike): Promise<PgConnection> {
    const cfg = connection.config as { host: string; port: number; database: string; username: string; ssl?: boolean };
    const creds = connection.credentials as { password: string };
    const client = new pg.Client({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.username,
      password: creds.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECTION_TIMEOUT,
      statement_timeout: QUERY_TIMEOUT,
    });
    await client.connect();
    return { client, close: async () => { await client.end(); } };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    let conn: PgConnection | undefined;
    try {
      conn = await this.connect(connection);
      await conn.client.query("SELECT 1");
      return true;
    } catch {
      return false;
    } finally {
      await conn?.close();
    }
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const pgConn = conn as PgConnection;
    const result = await pgConn.client.query(sql);
    return {
      columns: result.fields.map((f: { name: string }) => f.name),
      rows: result.rows,
    };
  }

  async *extract(conn: ProviderConnection, config: SourceConfig): AsyncGenerator<Record<string, unknown>[]> {
    const result = await this.query(conn, config.query);
    yield result.rows.length > 0 ? result.rows : [];
  }
}
```

### Step 5: Implement MssqlProvider and MysqlProvider

Port from `src/lib/connectors.ts` lines 84-185 using same pattern as PostgresProvider. Create:
- `src/lib/providers/mssql.provider.ts`
- `src/lib/providers/mysql.provider.ts`

Follow the exact same structure: `connect()`, `testConnection()`, `query()`, `extract()`.

For MSSQL, use `mssql` package. For MySQL, use `mysql2/promise`.

### Step 6: Run tests to verify they pass

```bash
npx vitest run src/__tests__/providers/sql-providers.test.ts
```
Expected: PASS

### Step 7: Commit

```bash
git add src/lib/providers/provider.ts src/lib/providers/postgres.provider.ts src/lib/providers/mssql.provider.ts src/lib/providers/mysql.provider.ts src/__tests__/providers/sql-providers.test.ts
git commit -m "feat: implement unified ConnectionProvider interface and port SQL providers"
```

---

## Task 4: Port BigQuery Provider (Unified)

**Files:**
- Create: `src/lib/providers/bigquery.provider.ts`
- Create: `src/__tests__/providers/bigquery-provider.test.ts`

**Prerequisite:** Task 3

### Step 1: Write failing tests

Adapt tests from `src/__tests__/bifrost/bigquery-provider.test.ts` to use the new `ConnectionLike` shape instead of `DataSourceLike`. Test all 5 methods: `connect`, `query`, `extract`, `load`, `getSchema`, `createTable`.

Key difference: credentials now come from `connection.credentials.serviceAccountKey` instead of `dataSource.extras.credentials` or `dataSource.extras`.

### Step 2: Run tests to verify they fail

```bash
npx vitest run src/__tests__/providers/bigquery-provider.test.ts
```

### Step 3: Implement BigQueryProvider

Port from `src/lib/bifrost/providers/bigquery.provider.ts` and merge with `BigQueryConnector` from `src/lib/connectors.ts` lines 189-224.

Key changes:
- `connect()` reads `connection.credentials.serviceAccountKey` (no decryption — already decrypted by caller)
- `query()` method added (from BigQueryConnector)
- `extract()`, `load()`, `getSchema()`, `createTable()` ported from CloudProvider

```typescript
// src/lib/providers/bigquery.provider.ts
import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection, QueryResult, SourceConfig, DestConfig, LoadResult, SchemaDefinition, SchemaField } from "./types";

interface BigQueryConnection extends ProviderConnection {
  client: unknown; // BigQuery instance
  projectId: string;
}

export class BigQueryProvider implements ConnectionProvider {
  readonly type = "BIGQUERY";

  async connect(connection: ConnectionLike): Promise<BigQueryConnection> {
    const { BigQuery } = await import("@google-cloud/bigquery");
    const cfg = connection.config as { projectId: string; location?: string };
    const creds = connection.credentials as { serviceAccountKey: Record<string, unknown> };
    const client = new BigQuery({
      projectId: cfg.projectId,
      credentials: creds.serviceAccountKey,
    });
    return {
      client,
      projectId: cfg.projectId,
      close: async () => { /* BigQuery client is stateless */ },
    };
  }

  // ... testConnection, query, extract, load, getSchema, createTable
  // Port method bodies from existing bigquery.provider.ts and connectors.ts
}
```

### Step 4: Run tests

```bash
npx vitest run src/__tests__/providers/bigquery-provider.test.ts
```

### Step 5: Commit

```bash
git add src/lib/providers/bigquery.provider.ts src/__tests__/providers/bigquery-provider.test.ts
git commit -m "feat: port BigQuery provider to unified ConnectionProvider interface"
```

---

## Task 5: Port NetSuite Provider

**Files:**
- Create: `src/lib/providers/netsuite.provider.ts`
- Create: `src/__tests__/providers/netsuite-provider.test.ts`

**Prerequisite:** Task 3

### Step 1: Write failing tests

Adapt from `src/__tests__/bifrost/netsuite-provider.test.ts`. Key changes:
- Credentials come from `connection.credentials` (already decrypted) instead of `dataSource.extras`
- No `tryDecrypt()` inside provider — decryption happens before provider sees data

### Step 2: Run tests → FAIL

### Step 3: Implement NetSuiteProvider

Port from `src/lib/bifrost/providers/netsuite.provider.ts` (541 lines). Key changes:
- `connect()` reads `connection.config.accountId` and `connection.credentials.{consumerKey,consumerSecret,tokenId,tokenSecret}`
- Remove `tryDecrypt()` calls — credentials arrive pre-decrypted
- Keep all helper functions: `buildTbaAuthHeader`, `percentEncode`, `extractNetSuiteError`, `buildSuiteQL`
- Keep metadata methods: `listRecordTypes`, `getRecordFields`, `listSavedSearches`, `executeSuiteQL`, `testConnection` (extended version returning `{ success, message, accountName? }`)

### Step 4: Run tests → PASS

### Step 5: Commit

```bash
git add src/lib/providers/netsuite.provider.ts src/__tests__/providers/netsuite-provider.test.ts
git commit -m "feat: port NetSuite provider to unified ConnectionProvider interface"
```

---

## Task 6: Create Provider Registry and Connection Helpers

**Files:**
- Create: `src/lib/providers/index.ts`
- Create: `src/lib/providers/helpers.ts`
- Create: `src/__tests__/providers/registry.test.ts`

**Prerequisite:** Tasks 3, 4, 5

### Step 1: Write failing tests

```typescript
// src/__tests__/providers/registry.test.ts
import { describe, it, expect, vi } from "vitest";

// Mock all provider constructors
vi.mock("@/lib/providers/postgres.provider", () => ({ PostgresProvider: vi.fn() }));
vi.mock("@/lib/providers/mssql.provider", () => ({ MssqlProvider: vi.fn() }));
vi.mock("@/lib/providers/mysql.provider", () => ({ MysqlProvider: vi.fn() }));
vi.mock("@/lib/providers/bigquery.provider", () => ({ BigQueryProvider: vi.fn() }));
vi.mock("@/lib/providers/netsuite.provider", () => ({ NetSuiteProvider: vi.fn() }));

import { getProvider } from "@/lib/providers";

describe("provider registry", () => {
  it("returns a provider for each supported type", () => {
    for (const type of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE"]) {
      expect(() => getProvider(type)).not.toThrow();
    }
  });

  it("throws for unknown type", () => {
    expect(() => getProvider("UNKNOWN")).toThrow("No provider for type");
  });
});
```

Also test the connection helper:

```typescript
// Add to same file or separate
import { toConnectionLike } from "@/lib/providers/helpers";
vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((s: string) => s), // passthrough for test
  encrypt: vi.fn((s: string) => s),
}));

describe("toConnectionLike", () => {
  it("decrypts credentials and parses config", () => {
    const dbRow = {
      type: "POSTGRES",
      config: { host: "localhost", port: 5432, database: "db", username: "u" },
      credentials: '{"password":"secret"}', // encrypted string in DB
    };
    const result = toConnectionLike(dbRow as any);
    expect(result.type).toBe("POSTGRES");
    expect(result.config.host).toBe("localhost");
    expect(result.credentials.password).toBe("secret");
  });

  it("handles null credentials", () => {
    const dbRow = { type: "BIGQUERY", config: { projectId: "p" }, credentials: null };
    const result = toConnectionLike(dbRow as any);
    expect(result.credentials).toEqual({});
  });
});
```

### Step 2: Run tests → FAIL

### Step 3: Implement registry and helpers

```typescript
// src/lib/providers/index.ts
import type { ConnectionProvider } from "./provider";
import { PostgresProvider } from "./postgres.provider";
import { MssqlProvider } from "./mssql.provider";
import { MysqlProvider } from "./mysql.provider";
import { BigQueryProvider } from "./bigquery.provider";
import { NetSuiteProvider } from "./netsuite.provider";

const providers: Record<string, ConnectionProvider> = {
  POSTGRES: new PostgresProvider(),
  MSSQL: new MssqlProvider(),
  MYSQL: new MysqlProvider(),
  BIGQUERY: new BigQueryProvider(),
  NETSUITE: new NetSuiteProvider(),
};

export function getProvider(type: string): ConnectionProvider {
  const provider = providers[type];
  if (!provider) {
    throw new Error(`No provider for type: "${type}". Available: ${Object.keys(providers).join(", ")}`);
  }
  return provider;
}

// Re-exports
export type { ConnectionProvider } from "./provider";
export { toConnectionLike } from "./helpers";
export * from "./capabilities";
export * from "./types";
```

```typescript
// src/lib/providers/helpers.ts
import { decrypt } from "@/lib/crypto";
import type { ConnectionLike, ConnectionType } from "./types";

/**
 * Convert a Prisma Connection row to a ConnectionLike (decrypts credentials).
 * Use this before passing to any provider method.
 */
export function toConnectionLike(connection: {
  type: string;
  config: unknown;
  credentials: string | null;
}): ConnectionLike {
  let creds: Record<string, unknown> = {};
  if (connection.credentials) {
    try {
      const decrypted = decrypt(connection.credentials);
      creds = JSON.parse(decrypted);
    } catch {
      // May already be plaintext JSON (test connections before save)
      try { creds = JSON.parse(connection.credentials); } catch { /* empty */ }
    }
  }
  return {
    type: connection.type as ConnectionType,
    config: (connection.config ?? {}) as Record<string, unknown>,
    credentials: creds,
  };
}
```

### Step 4: Run tests → PASS

### Step 5: Commit

```bash
git add src/lib/providers/index.ts src/lib/providers/helpers.ts src/__tests__/providers/registry.test.ts
git commit -m "feat: create unified provider registry and connection helpers"
```

---

## Task 7: Update Connections API Routes

**Files:**
- Modify: `src/app/api/connections/route.ts`
- Modify: `src/app/api/connections/[id]/route.ts` (if exists)
- Modify: `src/app/api/connections/test/route.ts` (if exists)
- Create: `src/__tests__/providers/connections-api.test.ts`

**Prerequisite:** Tasks 2, 6

### Step 1: Run existing tests (before checkpoint)

```bash
npx vitest run
```

### Step 2: Update GET /api/connections

Change from `prisma.dataSource.findMany()` to `prisma.connection.findMany()`. Mask credentials in response (return config but never credentials). Filter by `userId`.

### Step 3: Update POST /api/connections

- Validate with `createConnectionSchema` from `unified-connections.ts`
- Encrypt credentials: `encrypt(JSON.stringify(validated.credentials))`
- Store config as JSON, credentials as encrypted string
- Create via `prisma.connection.create()`

### Step 4: Update PUT /api/connections/[id]

- Validate with `updateConnectionSchema`
- If credentials provided, re-encrypt
- Update via `prisma.connection.update()`

### Step 5: Update test endpoint

- Use `getProvider(type)` + `provider.testConnection(connectionLike)` instead of `getConnector()` / `getConnectorRaw()`
- For test-before-save: construct `ConnectionLike` directly from request body (no DB lookup)

### Step 6: Write API validation tests and run

Verify CRUD works with the new Connection model shape.

### Step 7: Run full test suite (after checkpoint)

```bash
npx vitest run
```

### Step 8: Commit

```bash
git commit -m "feat: update connections API routes to use unified Connection model"
```

---

## Task 8: Write Migration Script

**Files:**
- Create: `src/lib/providers/migrate-connections.ts`
- Create: `src/__tests__/providers/migration.test.ts`

**Prerequisite:** Tasks 2, 7

### Step 1: Write failing tests for data transformation

```typescript
// src/__tests__/providers/migration.test.ts
import { describe, it, expect, vi } from "vitest";
import { transformDataSource, transformSftpConnection } from "@/lib/providers/migrate-connections";

vi.mock("@/lib/crypto", () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => `enc:${s}`,
}));

describe("migration transforms", () => {
  it("transforms POSTGRES DataSource", () => {
    const ds = {
      id: "ds1", name: "My PG", type: "POSTGRES",
      host: "localhost", port: 5432, database: "mydb",
      username: "user", password: "enc_pw", extras: null,
      userId: "u1",
    };
    const result = transformDataSource(ds);
    expect(result.type).toBe("POSTGRES");
    expect(result.config).toEqual({ host: "localhost", port: 5432, database: "mydb", username: "user", ssl: false });
    expect(result.credentials).toBe('enc:{"password":"enc_pw"}');
    // password is re-encrypted: decrypt old → wrap in JSON → encrypt new
  });

  it("transforms BIGQUERY DataSource", () => {
    const ds = {
      id: "ds2", name: "My BQ", type: "BIGQUERY",
      host: null, port: null, database: null,
      username: null, password: null,
      extras: { project_id: "proj", type: "service_account", private_key: "pk" },
      userId: "u1",
    };
    const result = transformDataSource(ds);
    expect(result.type).toBe("BIGQUERY");
    expect(result.config).toEqual({ projectId: "proj", location: "US" });
    expect(result.credentials).toContain("serviceAccountKey");
  });

  it("transforms NETSUITE DataSource", () => {
    const ds = {
      id: "ds3", name: "My NS", type: "NETSUITE",
      host: null, port: null, database: null,
      username: null, password: null,
      extras: { accountId: "123", consumerKey: "ck", consumerSecret: "enc_cs", tokenId: "ti", tokenSecret: "enc_ts" },
      userId: "u1",
    };
    const result = transformDataSource(ds);
    expect(result.type).toBe("NETSUITE");
    expect(result.config).toEqual({ accountId: "123" });
    expect(result.credentials).toContain("consumerKey");
  });

  it("transforms SftpConnection", () => {
    const sftp = {
      id: "sftp1", name: "ADP Ingest", sourceType: "ADP",
      sftpHost: "sftp.adp.com", sftpPort: 2222,
      sftpUsername: "adp_user", sftpPassword: "enc_pw",
      fileFormat: "CSV", userId: "u1",
    };
    const result = transformSftpConnection(sftp);
    expect(result.type).toBe("SFTP");
    expect(result.config).toEqual({
      host: "sftp.adp.com", port: 2222, username: "adp_user",
      fileFormat: "CSV", sourceType: "ADP",
    });
    expect(result.credentials).toContain("password");
  });
});
```

### Step 2: Run tests → FAIL

### Step 3: Implement migration transforms

```typescript
// src/lib/providers/migrate-connections.ts
import { decrypt, encrypt } from "@/lib/crypto";

interface MigrationResult {
  oldId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  credentials: string; // encrypted JSON
  userId: string;
  status: string;
}

export function transformDataSource(ds: Record<string, unknown>): MigrationResult {
  const type = ds.type as string;
  let config: Record<string, unknown>;
  let rawCreds: Record<string, unknown>;

  if (type === "BIGQUERY") {
    const extras = ds.extras as Record<string, unknown> ?? {};
    config = { projectId: (extras.project_id ?? extras.projectId ?? "") as string, location: "US" };
    rawCreds = { serviceAccountKey: extras };
  } else if (type === "NETSUITE") {
    const extras = ds.extras as Record<string, unknown> ?? {};
    config = { accountId: extras.accountId as string };
    // Decrypt secrets that were encrypted individually
    rawCreds = {
      consumerKey: extras.consumerKey as string,
      consumerSecret: tryDecrypt(extras.consumerSecret as string),
      tokenId: extras.tokenId as string,
      tokenSecret: tryDecrypt(extras.tokenSecret as string),
    };
  } else {
    // SQL types: POSTGRES, MSSQL, MYSQL
    config = {
      host: ds.host as string,
      port: ds.port as number,
      database: ds.database as string,
      username: ds.username as string,
      ssl: false,
    };
    rawCreds = { password: tryDecrypt(ds.password as string) };
  }

  return {
    oldId: ds.id as string,
    name: ds.name as string,
    type,
    config,
    credentials: encrypt(JSON.stringify(rawCreds)),
    userId: ds.userId as string,
    status: "ACTIVE",
  };
}

export function transformSftpConnection(sftp: Record<string, unknown>): MigrationResult {
  return {
    oldId: sftp.id as string,
    name: sftp.name as string,
    type: "SFTP",
    config: {
      host: sftp.sftpHost as string,
      port: sftp.sftpPort as number,
      username: sftp.sftpUsername as string,
      fileFormat: sftp.fileFormat as string,
      sourceType: sftp.sourceType as string,
    },
    credentials: encrypt(JSON.stringify({ password: tryDecrypt(sftp.sftpPassword as string) })),
    userId: sftp.userId as string,
    status: (sftp.status as string) ?? "ACTIVE",
  };
}

function tryDecrypt(value: string): string {
  try { return decrypt(value); } catch { return value; }
}
```

Also create the runnable migration script that:
1. Reads all DataSource rows
2. Reads all SftpConnection rows
3. Transforms each
4. Inserts into Connection table
5. Outputs ID mapping (old → new) for FK updates

### Step 4: Run tests → PASS

### Step 5: Commit

```bash
git add src/lib/providers/migrate-connections.ts src/__tests__/providers/migration.test.ts
git commit -m "feat: add connection migration script with transform functions"
```

---

## Task 9: Run Migration and Update Report Model

**Files:**
- Modify: `prisma/schema.prisma` (Report.connectionId FK)
- Modify: `src/app/api/reports/route.ts`
- Modify: `src/app/api/reports/[id]/route.ts`
- Modify: `src/app/api/query/execute/route.ts`

**Prerequisite:** Tasks 7, 8

### Step 1: Run existing tests (before checkpoint)

```bash
npx vitest run
```

### Step 2: Execute migration script

```bash
npx tsx src/lib/providers/migrate-connections.ts
```

This populates the Connection table. Verify data:
```bash
npx prisma studio
```
Check that all DataSource and SftpConnection records have corresponding Connection records.

### Step 3: Update Prisma schema — Report FK

Change Report model:
```prisma
model Report {
  // ... existing fields
  connectionId String          // was dataSourceId
  connection   Connection      @relation(fields: [connectionId], references: [id])
  // Remove: dataSourceId, dataSource
}
```

Add to Connection model:
```prisma
  reports          Report[]
```

### Step 4: Run migration to update FK column

```bash
npx prisma db push
npx prisma generate
```

**Note:** This requires the FK column rename. If `db push` can't rename, use a manual SQL migration:
```sql
ALTER TABLE "Report" RENAME COLUMN "dataSourceId" TO "connectionId";
ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_dataSourceId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id");
```

### Step 5: Update report API routes

**`src/app/api/reports/route.ts` GET:**
- Change `include: { dataSource: { select: { name, type } } }` → `include: { connection: { select: { name: true, type: true } } }`

**`src/app/api/reports/route.ts` POST:**
- Change `dataSourceId` → `connectionId`
- Ownership check: `prisma.connection.findFirst({ where: { id: connectionId, userId } })`

**`src/app/api/reports/[id]/route.ts`:**
- Same pattern — update FK name and ownership checks

**`src/app/api/query/execute/route.ts`:**
- Change `prisma.dataSource.findFirst()` → `prisma.connection.findFirst()`
- Change `getConnector(dataSource)` → `getProvider(connection.type).connect(toConnectionLike(connection))`
- Update query call: `provider.query!(conn, sql)` then `conn.close()`

### Step 6: Run tests (after checkpoint)

```bash
npx vitest run
```
Fix any test failures from FK rename.

### Step 7: Commit

```bash
git commit -m "feat: update Report model and API routes to use unified Connection"
```

---

## Task 10: Update Report Runner and Worker

**Files:**
- Modify: `src/lib/report-runner.ts`
- Modify: `src/lib/worker.ts`
- Modify: `src/__tests__/report-pipeline.test.ts`

**Prerequisite:** Task 9

### Step 1: Update report-runner.ts

**PipelineInput interface** (~line 66):
- Change `dataSource: Parameters<typeof getConnector>[0]` → `connection: { type: string; config: unknown; credentials: string | null }`

**executeReportPipeline** (~line 102):
- Change `getConnector(input.dataSource)` → use provider:
```typescript
const provider = getProvider(input.connection.type);
const connLike = toConnectionLike(input.connection);
const conn = await provider.connect(connLike);
try {
  const result = await provider.query!(conn, input.sqlQuery);
  // ... rest of pipeline
} finally {
  await conn.close();
}
```

**runReport** (~line 205):
- Change `report.dataSource` → `report.connection`
- Cast to ConnectionLike shape

### Step 2: Update worker.ts

The worker calls `runReport(reportId, scheduleId)` which calls `executeReportPipeline`. The worker itself doesn't directly use connectors — it just loads the report with relations. Update the `include` to use `connection` instead of `dataSource`.

### Step 3: Update pipeline tests

**`src/__tests__/report-pipeline.test.ts`:**
- Change mock structure: mock `@/lib/providers` instead of `@/lib/connectors`
- Change `baseInput.dataSource` → `baseInput.connection`

### Step 4: Run tests

```bash
npx vitest run src/__tests__/report-pipeline.test.ts
npx vitest run
```

### Step 5: Commit

```bash
git commit -m "feat: update report-runner and worker to use unified provider"
```

---

## Task 11: Update BifrostRoute Model and API Routes

**Files:**
- Modify: `prisma/schema.prisma` (BifrostRoute FKs)
- Modify: `src/app/api/bifrost/routes/route.ts`
- Modify: `src/app/api/bifrost/routes/[id]/route.ts`
- Modify: `src/app/api/bifrost/routes/[id]/run/route.ts`
- Modify: `src/lib/validations/bifrost.ts`

**Prerequisite:** Task 9

### Step 1: Update Prisma schema — BifrostRoute FKs

```prisma
model BifrostRoute {
  // Source
  sourceId         String
  source           Connection     @relation("routeSource", fields: [sourceId], references: [id])
  sourceConfig     Json

  // Destination — rename destConnectionId → destId
  destId           String
  dest             Connection     @relation("routeDest", fields: [destId], references: [id])
  destConfig       Json

  // Remove: type field (derivable from source.type → dest.type)
  // Keep everything else
}
```

Add to Connection model:
```prisma
  routesAsSource   BifrostRoute[] @relation("routeSource")
  routesAsDest     BifrostRoute[] @relation("routeDest")
```

### Step 2: Push schema changes

```bash
npx prisma db push
npx prisma generate
```

### Step 3: Update validation schema

In `src/lib/validations/bifrost.ts`:
- Change `destConnectionId` → `destId`
- Remove `type` field (or make it optional/derived)

### Step 4: Update Bifrost API routes

**POST /api/bifrost/routes:**
- Ownership checks: `prisma.connection.findFirst()` instead of `prisma.dataSource.findFirst()`
- Change `destConnectionId` → `destId`

**GET /api/bifrost/routes:**
- Change `include: { source, destConnection }` → `include: { source, dest }`

**PUT /api/bifrost/routes/[id]:**
- Same FK name changes

**POST /api/bifrost/routes/[id]/run:**
- Change `destConnection` → `dest`

### Step 5: Run tests

```bash
npx vitest run src/__tests__/bifrost/
npx vitest run
```

### Step 6: Commit

```bash
git commit -m "feat: update BifrostRoute to use unified Connection model"
```

---

## Task 12: Update Bifrost Engine

**Files:**
- Modify: `src/lib/bifrost/engine.ts`
- Modify: `src/__tests__/bifrost/bifrost-engine.test.ts`

**Prerequisite:** Task 11

### Step 1: Update engine to use unified provider

**`src/lib/bifrost/engine.ts`:**

Change imports:
```typescript
import { getProvider, toConnectionLike } from "@/lib/providers";
```

**LoadedRoute interface:**
- `source` → `{ id, type, config, credentials }` (Connection shape)
- `destConnection` → `dest: { id, type, config, credentials }`

**execute method:**
```typescript
const sourceProvider = getProvider(route.source.type);
const destProvider = getProvider(route.dest.type);
const sourceConnLike = toConnectionLike(route.source);
const destConnLike = toConnectionLike(route.dest);
const sourceConn = await sourceProvider.connect(sourceConnLike);
const destConn = await destProvider.connect(destConnLike);
```

Replace all `getCloudProvider()` calls with `getProvider()`.

**loadRouteWithRelations:**
- Change `destConnection` → `dest` in Prisma include

### Step 2: Update engine tests

**`src/__tests__/bifrost/bifrost-engine.test.ts`:**
- Mock `@/lib/providers` instead of `@/lib/bifrost/providers`
- Update `makeRoute()` helper to use Connection shape
- Change `destConnection` → `dest`

### Step 3: Run tests

```bash
npx vitest run src/__tests__/bifrost/bifrost-engine.test.ts
npx vitest run
```

### Step 4: Commit

```bash
git commit -m "feat: update BifrostEngine to use unified provider registry"
```

---

## Task 13: Update UI Components

**Files:**
- Modify: `src/app/(app)/connections/page.tsx`
- Modify: `src/components/connections/connection-list.tsx`
- Modify: `src/components/connections/connection-form.tsx`
- Modify: `src/components/connections/connection-card.tsx`
- Modify: `src/components/connections/source-picker.tsx`
- Modify: `src/components/connections/sftp-wizard.tsx`
- Modify: `src/components/connections/sftp-connection-card.tsx`
- Modify: `src/components/bifrost/route-editor.tsx`
- Modify: `src/components/bifrost/route-list.tsx`
- Modify: `src/components/bifrost/sync-builder.tsx`

**Prerequisite:** Tasks 7, 11

### Step 1: Update connections page (server component)

**`src/app/(app)/connections/page.tsx`:**
- Replace three separate queries (`prisma.dataSource`, `prisma.sftpConnection`, `prisma.emailConnection`) with:
  - `prisma.connection.findMany({ where: { userId }, select: { id, name, type, config, status, lastTestedAt } })`
  - `prisma.emailConnection.findMany(...)` (stays separate)
- Pass unified `connections` array + `emailConnections` to ConnectionList

### Step 2: Update connection-list.tsx

- Remove separate `Connection`, `SftpConnection` interfaces
- Use single `Connection` interface: `{ id, name, type, config, status?, lastTestedAt? }`
- Filter by type for display sections:
  - SQL section: `connections.filter(c => ["POSTGRES","MSSQL","MYSQL"].includes(c.type))`
  - Cloud section: `connections.filter(c => ["BIGQUERY","NETSUITE"].includes(c.type))`
  - SFTP section: `connections.filter(c => c.type === "SFTP")`
- Delete calls: all go to `DELETE /api/connections/{id}` (unified)

### Step 3: Update connection-form.tsx

- Form now submits `{ name, type, config: {...}, credentials: {...} }` shape
- Still polymorphic by type, but output shape is unified
- Test endpoint: `POST /api/connections/test` with same body shape

### Step 4: Update connection-card.tsx

- Read display fields from `connection.config` (host, port, etc.) instead of top-level
- `(connection.config as any).host` or properly typed

### Step 5: Update sftp-wizard.tsx

- Now creates a Connection with `type: SFTP` instead of SftpConnection
- POST to `/api/connections` with SFTP config shape
- Destination config (bqDataset, bqTable, loadMode) becomes a separate step or BifrostRoute creation

### Step 6: Update Bifrost route-editor.tsx and sync-builder.tsx

- Source/dest picker: fetch `/api/connections` → filter by capabilities
  - Source: `canBeSource(c.type)`
  - Dest: `canBeDestination(c.type)`
- Remove hardcoded `SOURCE_TYPES = Set["BIGQUERY", "NETSUITE"]` — use capabilities
- Change `destConnectionId` → `destId` in form submission
- Remove `type` field from route creation

### Step 7: Update route-list.tsx

- Change `destConnection` → `dest` in displayed data
- Remove `type` display (or derive from source.type → dest.type)

### Step 8: Manual UI smoke test

Test each flow:
- Create Postgres connection
- Create BigQuery connection
- Create SFTP connection
- Create Bifrost route (BQ → BQ)
- Edit / delete connections
- Run route

### Step 9: Commit

```bash
git commit -m "feat: update UI components to use unified Connection model"
```

---

## Task 14: Drop Old Models and Clean Up

**Files:**
- Modify: `prisma/schema.prisma` (remove DataSource, SftpConnection, old enums)
- Delete: `src/lib/connectors.ts`
- Delete: `src/lib/bifrost/providers/bigquery.provider.ts`
- Delete: `src/lib/bifrost/providers/netsuite.provider.ts`
- Delete: `src/lib/bifrost/providers/index.ts`
- Delete: `src/lib/validations/connections.ts` (replaced by unified-connections.ts)
- Delete: `src/lib/validations/sftp-connections.ts`
- Delete: `src/app/api/sftp-connections/` (absorbed into /api/connections)
- Modify: `src/lib/bifrost/types.ts` (remove DataSourceLike if unused)

**Prerequisite:** ALL previous tasks complete, full test suite passing

### Step 1: Run full test suite (before checkpoint)

```bash
npx vitest run
```
Expected: ALL PASS

### Step 2: Remove old Prisma models

From `schema.prisma`, remove:
- `model DataSource` + `enum DataSourceType`
- `model SftpConnection` + `enum SftpSourceType` + `enum FileFormat` + `enum LoadMode` + `enum SftpStatus`
- Old `User` relations: `connections DataSource[]`, `sftpConnections SftpConnection[]`
- Rename `connections_v2 Connection[]` → `connections Connection[]`

### Step 3: Push schema changes

```bash
npx prisma db push
npx prisma generate
```

### Step 4: Delete old files

```bash
rm src/lib/connectors.ts
rm src/lib/bifrost/providers/bigquery.provider.ts
rm src/lib/bifrost/providers/netsuite.provider.ts
rm src/lib/bifrost/providers/index.ts
rm src/lib/validations/connections.ts
rm src/lib/validations/sftp-connections.ts
rm -rf src/app/api/sftp-connections/
```

### Step 5: Update any remaining imports

Search for all imports of deleted modules and update:
```bash
grep -r "from.*connectors" src/
grep -r "from.*bifrost/providers" src/
grep -r "from.*validations/connections" src/
grep -r "from.*validations/sftp" src/
grep -r "sftp-connections" src/
grep -r "DataSourceType" src/
grep -r "DataSourceConnector" src/
grep -r "getConnector" src/
grep -r "getCloudProvider" src/
grep -r "dataSourceId" src/
grep -r "destConnectionId" src/
```

Fix ALL remaining references.

### Step 6: Update old test files

- `src/__tests__/bifrost/bigquery-provider.test.ts` — delete (replaced by `providers/bigquery-provider.test.ts`)
- `src/__tests__/bifrost/netsuite-provider.test.ts` — delete (replaced)
- `src/__tests__/validations.test.ts` — update connection tests to use new schemas, remove SFTP tests
- Any other tests referencing old types

### Step 7: Run full test suite (after checkpoint)

```bash
npx vitest run
```
Expected: ALL PASS

### Step 8: Run build

```bash
npm run build
```
Expected: No TypeScript errors.

### Step 9: Run lint

```bash
npm run lint
```
Expected: No lint errors.

### Step 10: Commit

```bash
git commit -m "chore: remove old DataSource, SftpConnection models and legacy connectors"
```

---

## Summary

| Task | Description | Test checkpoint |
|------|-------------|----------------|
| 1 | Types, capabilities, validation schemas | Unit tests for caps + Zod |
| 2 | Add Connection model to Prisma (additive) | Existing suite still passes |
| 3 | Port SQL providers (Postgres, MSSQL, MySQL) | Provider unit tests |
| 4 | Port BigQuery provider (unified) | Provider unit tests |
| 5 | Port NetSuite provider | Provider unit tests |
| 6 | Provider registry + helpers | Registry + toConnectionLike tests |
| 7 | Update connections API routes | API tests + full suite |
| 8 | Migration script | Transform unit tests |
| 9 | Run migration + update Report model | Full suite after FK change |
| 10 | Update report-runner + worker | Pipeline tests + full suite |
| 11 | Update BifrostRoute model + API | Bifrost tests + full suite |
| 12 | Update BifrostEngine | Engine tests + full suite |
| 13 | Update UI components | Manual smoke test |
| 14 | Drop old models + cleanup | Full suite + build + lint |

**Total estimated tasks:** 14
**Test-first approach:** Every task starts with failing tests, implements minimally, verifies pass.
**Clean cut-over:** Old models coexist until Task 14, then removed in one sweep.
