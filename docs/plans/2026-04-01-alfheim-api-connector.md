# Alfheim Universal API Connector — Implementation Plan (Phases 1-3)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Zapier-style API connector catalog where users browse pre-built connectors (Shopify, Stripe, HubSpot, etc.), connect with credentials, and select objects to sync — stopping before the connection wizard.

**Architecture:** Database-driven connector catalog (Prisma models), generic REST provider, schema mapper for JSON→tabular flattening, DDL generator for multi-dialect table creation, API routes for catalog CRUD/search/test, and a Zapier-style browse UI with sidebar categories + card grid + search.

**Tech Stack:** Next.js 14 App Router, Prisma, PostgreSQL, Vitest, Tailwind CSS, Zod validation

**Scope cutoff:** Browse UI only. No connection wizard, no OAuth2, no AI discovery.

---

## Task 1: Prisma Schema — New Models and Enums

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add enum values and new models**

Add `REST_API` to `ConnectionType` enum:
```prisma
enum ConnectionType {
  POSTGRES
  MSSQL
  MYSQL
  BIGQUERY
  NETSUITE
  SFTP
  REST_API
}
```

Add `ApiAuthType` enum:
```prisma
enum ApiAuthType {
  API_KEY
  BEARER
  BASIC
  OAUTH2
  CUSTOM
}
```

Add `ApiCatalogConnector` model:
```prisma
model ApiCatalogConnector {
  id            String        @id @default(cuid())
  slug          String        @unique
  name          String
  description   String
  category      String
  subcategory   String?
  logoUrl       String?
  docsUrl       String?
  popularity    Int           @default(0)
  enabled       Boolean       @default(true)
  authType      ApiAuthType
  baseUrl       String
  authConfig    Json
  pagination    Json
  rateLimiting  Json?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  createdBy     String?
  objects       ApiCatalogObject[]

  @@index([category])
  @@index([enabled])
}

model ApiCatalogObject {
  id              String               @id @default(cuid())
  connectorId     String
  connector       ApiCatalogConnector   @relation(fields: [connectorId], references: [id], onDelete: Cascade)
  slug            String
  name            String
  description     String?
  endpoint        String
  method          String               @default("GET")
  responseRoot    String
  incrementalKey  String?
  defaultParams   Json?
  schema          Json

  @@unique([connectorId, slug])
}
```

**Step 2: Run migration**

```bash
npx prisma migrate dev --name add_alfheim_api_catalog
```

**Step 3: Generate client**

```bash
npx prisma generate
```

**Step 4: Verify**

```bash
npm run test
```

All existing tests must still pass. The new enum value is additive — no data migration needed.

---

## Task 2: Alfheim Types

**Files:**
- Create: `src/lib/alfheim/types.ts`

Define all TypeScript types for the Alfheim system:

```typescript
export interface ColumnMapping {
  jsonPath: string;
  columnName: string;
  dataType: "STRING" | "INTEGER" | "FLOAT" | "BOOLEAN" | "TIMESTAMP" | "JSON";
  nullable: boolean;
}

export interface ChildTableMapping {
  jsonPath: string;
  tableName: string;
  foreignKey: string;
  columns: ColumnMapping[];
}

export interface SchemaMapping {
  columns: ColumnMapping[];
  childTables?: ChildTableMapping[];
}

export type PaginationType = "cursor" | "offset" | "link_header" | "page_number" | "none";

export interface PaginationConfig {
  type: PaginationType;
  pageParam?: string;       // query param name for page/offset/cursor
  limitParam?: string;       // query param name for page size
  defaultLimit?: number;
  cursorPath?: string;       // JSON path to next cursor in response
  totalPath?: string;        // JSON path to total count
}

export interface RateLimitConfig {
  requestsPerSecond?: number;
  burstLimit?: number;
  retryAfterHeader?: string;
}

export interface AuthField {
  key: string;              // "apiKey", "storeUrl"
  label: string;            // "API Key", "Store URL"
  type: "text" | "password" | "url";
  placeholder?: string;
  required: boolean;
}

export interface AuthConfig {
  fields: AuthField[];
  headerName?: string;      // For API_KEY: which header to use
  tokenPrefix?: string;     // For BEARER: prefix (default "Bearer")
  urlPlaceholders?: string[]; // ["store", "domain"] — extracted from baseUrl
}

export type SqlDialect = "postgres" | "mssql" | "mysql" | "bigquery";
```

**Verify:** `npm run test` — types-only file, nothing to break.

---

## Task 3: Schema Mapper + Tests

**Files:**
- Create: `src/lib/alfheim/schema-mapper.ts`
- Create: `src/__tests__/alfheim/schema-mapper.test.ts`

**Step 1: Write tests first**

Test cases:
1. Flat record — no nesting, all primitives
2. Nested object — `address.city` → `address_city`
3. Deep nesting (3+ levels) → JSON column
4. Array of primitives → JSON column
5. Array of objects → child table rows
6. Null handling — null values respected
7. Mixed types → STRING fallback
8. inferSchema from sample records

**Step 2: Implement schema-mapper.ts**

Two exports:
- `flattenRecord(record, schema, parentId?)` → `{ main, children }`
- `inferSchema(sampleRecords, maxDepth?)` → `SchemaMapping`

`flattenRecord`: Walk each `ColumnMapping`, use `jsonPath` to extract value from nested record using dot-notation splitting. Coerce to declared `dataType`. For `ChildTableMapping`, extract array at `jsonPath`, flatten each element, inject `foreignKey`.

`inferSchema`: Analyze sample records. For each key: detect type from values (number/boolean/string/date heuristics), track null rate, detect arrays vs objects. Flatten nested objects with underscore joining. Cap at `maxDepth` (default 3).

**Step 3: Run tests**

```bash
npx vitest run src/__tests__/alfheim/schema-mapper.test.ts
```

---

## Task 4: DDL Generator + Tests

**Files:**
- Create: `src/lib/alfheim/ddl-generator.ts`
- Create: `src/__tests__/alfheim/ddl-generator.test.ts`

**Step 1: Write tests first**

Test cases per dialect (postgres, mssql, mysql, bigquery):
1. Simple table with all data types
2. Table with child tables (generates multiple CREATE statements)
3. Column name sanitization (special chars → underscores)
4. Reserved word handling

**Step 2: Implement ddl-generator.ts**

Export: `generateDDL(tableName, schema, dialect)` → `{ statements, warnings }`

Type mapping table:
| Type | PostgreSQL | SQL Server | MySQL | BigQuery |
|------|-----------|-----------|-------|---------|
| STRING | TEXT | NVARCHAR(MAX) | TEXT | STRING |
| INTEGER | BIGINT | BIGINT | BIGINT | INT64 |
| FLOAT | DOUBLE PRECISION | FLOAT | DOUBLE | FLOAT64 |
| BOOLEAN | BOOLEAN | BIT | TINYINT(1) | BOOL |
| TIMESTAMP | TIMESTAMPTZ | DATETIME2 | DATETIME | TIMESTAMP |
| JSON | JSONB | NVARCHAR(MAX) | JSON | JSON |

**Step 3: Run tests**

```bash
npx vitest run src/__tests__/alfheim/ddl-generator.test.ts
```

---

## Task 5: Zod Validation Schemas

**Files:**
- Create: `src/lib/validations/alfheim.ts`

Schemas needed:
- `catalogSearchSchema` — query params: search?, category?, page?, limit?
- `createCatalogConnectorSchema` — full connector creation
- `updateCatalogConnectorSchema` — partial update
- `testCatalogConnectionSchema` — { credentials: Record<string, string> }
- `restApiConfigSchema` — for Connection.config when type is REST_API
- `restApiCredentialsSchema` — for Connection.credentials

Add `REST_API` variant to the discriminated union in `src/lib/validations/unified-connections.ts`.

**Verify:** `npm run test`

---

## Task 6: Seed Data — 10 Connectors

**Files:**
- Create: `prisma/seeds/api-catalog.ts`
- Modify: `prisma/seed.ts` (or create if doesn't exist) — import and run the catalog seed

Seed 10 connectors with real API schemas. For each connector: 2-4 objects with 15-30 column mappings per object based on actual API response structures.

Connectors: ShipStation, Shopify, Stripe, HubSpot, Airtable, Monday.com, Jira, WooCommerce, ShipBob, Cin7.

Each connector needs: slug, name, description, category, authType, baseUrl, authConfig (fields array), pagination config, and objects with endpoint + responseRoot + schema mappings.

**Run seed:**
```bash
npx prisma db seed
```

**Verify:** Query the database to confirm 10 connectors and ~30 objects were created.

---

## Task 7: Catalog API Routes

**Files:**
- Create: `src/app/api/alfheim/catalog/route.ts` — GET (list+search), POST (create)
- Create: `src/app/api/alfheim/catalog/categories/route.ts` — GET categories with counts
- Create: `src/app/api/alfheim/catalog/[slug]/route.ts` — GET (detail), PUT (update), DELETE (disable)
- Create: `src/app/api/alfheim/catalog/[slug]/test/route.ts` — POST test connection
- Create: `src/app/api/alfheim/catalog/[slug]/objects/route.ts` — GET list objects
- Create: `src/app/api/alfheim/catalog/[slug]/objects/[objectSlug]/route.ts` — GET object detail

All routes use `withAuth()`. Catalog is shared (not user-scoped) but CRUD requires auth. Test connection uses user-provided credentials against the catalog connector's config.

**GET /api/alfheim/catalog** — Prisma query with:
- `where: { enabled: true }` (always)
- `search` → `OR: [{ name: contains }, { description: contains }, { category: contains }]` (case-insensitive)
- `category` → `where: { category }` filter
- Pagination via `skip`/`take`
- Also return `categories: distinct categories with counts`

**POST /api/alfheim/catalog/[slug]/test** — Load connector config from DB, merge with user credentials, make a lightweight API call to verify auth works (first page of first object).

**Verify:** Test with curl or write API integration tests.

---

## Task 8: Register REST_API Provider

**Files:**
- Create: `src/lib/providers/rest-api.provider.ts`
- Modify: `src/lib/providers/index.ts` — register REST_API
- Modify: `src/lib/providers/capabilities.ts` — add REST_API capabilities

The REST API provider is a stub for now — implements `testConnection()` and `connect()`. Full `extract()` and `load()` come in the connection wizard phase.

`testConnection()`: Load catalog connector config, inject auth headers based on authType, make a single GET request to the first object's endpoint, verify 200 response.

Capabilities: `{ canBeSource: true, canBeDestination: false, canQuery: false, canStream: true, canBulkLoad: false, canListTables: false }`

**Verify:** `npm run test` — all tests pass including existing provider tests.

---

## Task 9: Browse UI — Components

**Files:**
- Create: `src/components/alfheim/catalog-search.tsx`
- Create: `src/components/alfheim/catalog-sidebar.tsx`
- Create: `src/components/alfheim/connector-card.tsx`
- Create: `src/components/alfheim/catalog-browse.tsx`

**catalog-search.tsx** — Full-width search input with debounced onChange (300ms). Clear button. Result count display. Uses input-norse styling.

**catalog-sidebar.tsx** — Vertical list of categories with counts. "All" default. Active category gets gold left border. Clicking filters the grid.

**connector-card.tsx** — Card showing: first-letter avatar (or logo), connector name (heading-norse), category tag (badge-neutral), description. Hover: border-color transitions to gold, translateY(-2px). Click navigates to `/connections/api/[slug]`.

**catalog-browse.tsx** — Client component ("use client"). Fetches from `/api/alfheim/catalog` with search + category params. Manages state: search term, active category, connectors list, loading. Renders search bar, sidebar + grid layout.

All components use the parchment design system: bg-void/bg-deep backgrounds, gold accents, EB Garamond headings, Space Grotesk labels, Source Serif body text.

---

## Task 10: Browse Page + Navigation Link

**Files:**
- Create: `src/app/(app)/connections/api/page.tsx`
- Modify: `src/components/connections/source-picker.tsx` — add API Connectors option

**page.tsx** — Server component that renders heading + CatalogBrowse client component.

**source-picker.tsx** — Add a new entry to the SOURCES array:
```typescript
{ type: "REST_API", name: "API Connectors", rune: "✦", description: "Browse catalog of pre-built API connectors", category: "cloud" }
```

Clicking this card navigates to `/connections/api` instead of opening the connection form.

**Verify full flow:**
1. `npm run dev`
2. Go to `/connections/new` — see "API Connectors" card with ✦ icon
3. Click it → navigates to `/connections/api`
4. See 10 connectors in a searchable grid
5. Search "shop" → Shopify + WooCommerce filter
6. Click "Payments" in sidebar → Stripe filters
7. All existing tests pass: `npm run test`

---

## Build Order Summary

| Task | Phase | What | Depends On |
|------|-------|------|-----------|
| 1 | 1 | Prisma schema + migration | — |
| 2 | 2 | TypeScript types | — |
| 3 | 2 | Schema mapper + tests | Task 2 |
| 4 | 2 | DDL generator + tests | Task 2 |
| 5 | 2 | Zod validation schemas | Task 1 |
| 6 | 1 | Seed 10 connectors | Task 1 |
| 7 | 2 | Catalog API routes | Tasks 1, 5 |
| 8 | 2 | REST_API provider stub | Task 1 |
| 9 | 3 | Browse UI components | Task 7 |
| 10 | 3 | Browse page + nav link | Task 9 |
