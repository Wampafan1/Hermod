# Hermod v1 — Design Document

**Date:** 2026-02-18
**Status:** Approved

Hermod is an open-source Next.js application for connecting to SQL databases, writing queries with a Monaco editor, previewing results in a spreadsheet grid with Excel-style formatting, and scheduling formatted `.xlsx` reports for automatic email delivery.

---

## Design Decisions Summary

| # | Decision | Choice |
|---|----------|--------|
| 1 | Data grid library | AG Grid Community (MIT) — replaces Handsontable |
| 2 | BigQuery auth UX | File upload only + server-side JSON validation |
| 3 | Password storage | AES-256 encryption at rest via `ENCRYPTION_KEY` env var |
| 4 | Connection pooling | Connect-per-query, no pooling for v1 |
| 5 | Report editor layout | Resizable split panes (`react-resizable-panels`) — SQL top, results bottom, config sidebar |
| 6 | Formatting persistence | Client-side state, saved with report on explicit "Save" |
| 7 | Query execution API | General `POST /api/query/execute` accepting `{connectionId, sql}` |
| 8 | Monaco autocomplete | Basic SQL highlighting only, schema autocomplete deferred to v2 |
| 9 | Timezone library | `date-fns` + `date-fns-tz` for `calculateNextRun` |
| 10 | Worker scheduling | Custom 60s polling loop, `nextRunAt` in DB is source of truth |
| 11 | Docker worker | Separate `worker` service in docker-compose.yml |
| 12 | Email template vars | `{report_name}`, `{date}`, `{day_of_week}`, `{row_count}`, `{run_time}`, `{connection_name}` |
| 13 | API route pattern | `withAuth()` wrapper utility for auth + try/catch + error handling |
| 14 | Zod schemas | Feature-grouped: `src/lib/validations/connections.ts`, `reports.ts`, `schedules.ts` |
| 15 | Error UX | Shared toast/notification component via React context |
| 16 | Testing strategy | Unit tests for critical logic (Vitest): `calculateNextRun`, connectors, crypto, Excel, Zod |

---

## Additional Dependencies (beyond existing package.json)

```
ag-grid-community
ag-grid-react
@monaco-editor/react
react-resizable-panels
date-fns
date-fns-tz
vitest (devDependency)
```

Remove from spec: `handsontable`, `@handsontable/react`

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Next.js App (App Router)                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ Pages     │  │ API Routes│  │ Components   │ │
│  │ (app/)    │  │ (api/)    │  │ (components/)│ │
│  └──────────┘  └─────┬─────┘  └──────────────┘ │
│                      │                           │
│  ┌───────────────────┼──────────────────┐       │
│  │        Shared Library (lib/)          │       │
│  │  auth, db, session, connectors,      │       │
│  │  crypto, api, validations/, email    │       │
│  └───────────────────┬──────────────────┘       │
└──────────────────────┼──────────────────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
     ┌────┴────┐  ┌───┴───┐  ┌───┴──────────┐
     │ Postgres │  │ SMTP  │  │ User DBs     │
     │ (Prisma) │  │       │  │ (pg/mssql/   │
     │ + pg-boss│  │       │  │  mysql/bq)   │
     └─────────┘  └───────┘  └──────────────┘
          │
     ┌────┴────────────────────┐
     │  Worker Process         │
     │  (src/lib/worker.ts)    │
     │  - 60s polling loop     │
     │  - pg-boss job handler  │
     │  - report-runner        │
     │  - Excel generation     │
     │  - Email delivery       │
     └─────────────────────────┘
```

---

## File Structure (new files to create)

```
src/
├── lib/
│   ├── api.ts                    # withAuth() wrapper
│   ├── crypto.ts                 # AES-256 encrypt/decrypt for passwords
│   ├── connectors.ts             # DataSourceConnector interface + implementations
│   ├── email.ts                  # Nodemailer transporter + sendReportEmail()
│   ├── pg-boss.ts                # pg-boss singleton
│   ├── worker.ts                 # Worker entry point (separate process)
│   ├── report-runner.ts          # Execute query → generate Excel → send email
│   ├── schedule-utils.ts         # calculateNextRun() with date-fns-tz
│   └── validations/
│       ├── connections.ts        # Zod schemas for connection CRUD + test
│       ├── reports.ts            # Zod schemas for report CRUD
│       └── schedules.ts          # Zod schemas for schedule CRUD
├── components/
│   ├── toast.tsx                 # Toast context + component
│   ├── connections/
│   │   ├── connection-form.tsx   # Modal form with conditional fields
│   │   └── connection-card.tsx   # Card display for saved connections
│   ├── reports/
│   │   ├── sql-editor.tsx        # Monaco editor wrapper
│   │   ├── results-grid.tsx      # AG Grid with formatting toolbar
│   │   ├── formatting-toolbar.tsx
│   │   └── report-config.tsx     # Name, description, connection selector
│   └── schedule/
│       ├── schedule-form.tsx     # Visual schedule builder
│       ├── day-selector.tsx      # Pill buttons for day selection
│       ├── recipient-input.tsx   # Tag-style email input
│       └── schedule-preview.tsx  # Human-readable summary line
├── app/
│   ├── api/
│   │   ├── connections/
│   │   │   ├── route.ts          # GET (list), POST (create)
│   │   │   ├── [id]/route.ts     # PUT (update), DELETE
│   │   │   └── test/route.ts     # POST (test connection)
│   │   ├── reports/
│   │   │   ├── route.ts          # GET (list), POST (create)
│   │   │   └── [id]/
│   │   │       ├── route.ts      # GET, PUT, DELETE
│   │   │       ├── run/route.ts  # POST (manual run + email)
│   │   │       └── send/route.ts # POST (manual send)
│   │   ├── query/
│   │   │   └── execute/route.ts  # POST (ad-hoc query execution)
│   │   └── schedules/
│   │       ├── route.ts          # GET (list), POST (create)
│   │       └── [id]/
│   │           ├── route.ts      # PUT, DELETE
│   │           └── toggle/route.ts # POST (enable/disable)
│   └── (app)/
│       ├── connections/page.tsx  # Connection manager (replace placeholder)
│       ├── reports/
│       │   ├── page.tsx          # Report list (replace placeholder)
│       │   ├── new/page.tsx      # New report editor
│       │   └── [id]/
│       │       ├── page.tsx      # Edit report editor
│       │       └── schedule/page.tsx # Schedule builder
│       ├── schedules/page.tsx    # Schedule overview (replace placeholder)
│       └── history/page.tsx      # Run history (replace placeholder)
```

---

## Feature Specifications

### 1. Connections (`/connections`)

**Connector Interface:**
```typescript
interface DataSourceConnector {
  query(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  testConnection(): Promise<boolean>;
  disconnect(): Promise<void>;
}
```

- Factory function `getConnector(config)` returns the appropriate implementation
- All connectors: 30s connection timeout, 120s query timeout
- Passwords encrypted with AES-256-GCM before DB storage, decrypted in connector factory
- `src/lib/crypto.ts`: `encrypt(text: string): string` and `decrypt(ciphertext: string): string` using `ENCRYPTION_KEY` env var

**Connection Form:**
- Type selector controls which fields appear
- Default ports: Postgres=5432, MSSQL=1433, MySQL=3306
- BigQuery: file upload for service account JSON, server validates `type: "service_account"` + required fields
- "Test Connection" button calls `POST /api/connections/test` with form data (no save required)
- Passwords masked with `type="password"`, never returned in GET responses

### 2. Reports (`/reports`)

**Report List:** Grid of cards showing name, connection name, last run status badge, schedule status (scheduled/unscheduled).

**Report Editor (3-panel):**
- **Top panel:** Monaco SQL editor with connection dropdown + "Run Query" button (Ctrl+Enter)
- **Bottom panel:** AG Grid Community displaying query results with formatting toolbar above
- **Right sidebar (collapsible):** Report name, description, connection, Save/Save & Schedule buttons
- Panels separated by resizable divider (`react-resizable-panels`)

**Formatting Toolbar:**
- Bold toggle, text color picker (preset palette), background color picker
- Number format dropdown (General, Number `#,##0.00`, Currency `$#,##0.00`, Percentage `0.00%`, Date)
- Text alignment (left, center, right)
- Column width via drag on AG Grid column headers
- Formatting state stored in React state, persisted to `formatting` JSON field on Save
- Unsaved changes warning on navigation

**Query Execution:**
- `POST /api/query/execute` accepts `{ connectionId: string, sql: string }`
- Returns `{ columns: string[], rows: Record<string, unknown>[], rowCount: number, executionTime: number }`
- Shared between editor preview, report run, and worker

### 3. Schedule Builder (`/reports/[id]/schedule`)

**Visual schedule form:**
- Frequency: Daily, Weekly, Biweekly, Monthly, Quarterly
- Day selector: pill buttons (Weekly/Biweekly), day-of-month dropdown (Monthly), month+day (Quarterly)
- Time: Hour (1-12) + Minute (00/15/30/45) + AM/PM dropdowns
- Timezone: common US timezones pinned at top, full IANA list below, auto-detect default
- Recipients: tag-style email input with pills, "Add from previous" dropdown
- Email subject + body with template variables
- Enable/disable toggle at top
- Human-readable preview line at bottom

**`calculateNextRun(schedule)`:**
- Uses `date-fns-tz` for timezone-aware calculation
- Handles DST transitions
- Monthly: falls back to last day if `dayOfMonth > daysInMonth`
- Quarterly: uses `monthsOfYear` array to determine next qualifying month

### 4. Worker (`src/lib/worker.ts`)

**Startup:** Connect pg-boss → register `send-report` handler → start 60s polling loop

**Polling loop:**
1. Query enabled schedules where `nextRunAt <= now()`
2. For each due schedule: enqueue `send-report` job, advance `nextRunAt`
3. Sleep 60 seconds, repeat

**Report runner (`send-report` handler):**
1. Create RunLog (status: RUNNING)
2. Fetch report + dataSource + schedule + recipients
3. Decrypt password → create connector → execute SQL
4. Generate `.xlsx` with ExcelJS applying formatting JSON
5. Replace template variables in subject/body: `{report_name}`, `{date}`, `{day_of_week}`, `{row_count}`, `{run_time}`, `{connection_name}`
6. Send email via Nodemailer with `.xlsx` attachment
7. Update RunLog (SUCCESS/FAILED + rowCount + completedAt + error)

**Docker:** Separate `worker` service in docker-compose.yml, same image, `command: npm run worker`

### 5. History (`/history`)

- Filterable table: Report Name, Status (badge), Rows, Started, Completed, Duration
- Filters: report name dropdown, status dropdown, date range
- Click failed run → modal with error details
- "Re-run" button triggers `POST /api/reports/[id]/send`

### 6. Dashboard Enhancements

- Stat cards link to respective pages
- "Quick Actions" section: New Report, Add Connection
- Upcoming scheduled runs (next 24 hours)
- Relative time display ("5 min ago")

---

## Shared Utilities

### `src/lib/api.ts` — withAuth wrapper
```typescript
type AuthHandler = (req: Request, session: Session) => Promise<Response>;
export function withAuth(handler: AuthHandler): (req: Request) => Promise<Response>;
```
Handles: session check → 401 if missing → try/catch → 500 with structured JSON error

### `src/lib/crypto.ts` — Password encryption
- AES-256-GCM using `ENCRYPTION_KEY` env var
- `encrypt(plaintext: string): string` — returns `iv:authTag:ciphertext` (base64)
- `decrypt(encrypted: string): string` — splits and decrypts

### `src/components/toast.tsx` — Toast notifications
- `ToastProvider` context wrapping the app
- `useToast()` hook returning `{ success(msg), error(msg), info(msg) }`
- Auto-dismiss after 4 seconds
- Fixed position bottom-right, stacking

---

## Testing Plan (Vitest)

**High-priority unit tests:**
1. `calculateNextRun()` — all frequencies, DST transitions, edge cases (31st of month, Feb 29)
2. `encrypt()` / `decrypt()` round-trip, invalid key handling
3. `getConnector()` factory — returns correct implementation per type
4. Zod schemas — valid/invalid input coverage
5. Template variable replacement
6. `nextRunAt` advancement after job execution

**Test files:**
```
src/__tests__/
├── schedule-utils.test.ts
├── crypto.test.ts
├── connectors.test.ts
├── validations.test.ts
└── template-vars.test.ts
```

---

## Build Order

1. **Shared utilities** — `api.ts`, `crypto.ts`, `validations/`, `toast.tsx`
2. **Connections** — connectors, API routes, UI
3. **Reports** — editor (Monaco + AG Grid + formatting), API routes, UI
4. **Schedule Builder** — `schedule-utils.ts`, schedule form, API routes
5. **Worker** — `pg-boss.ts`, `worker.ts`, `report-runner.ts`, `email.ts`
6. **Schedules Overview** — page replacing placeholder
7. **History** — page replacing placeholder
8. **Dashboard Enhancements** — upgrade existing page
9. **README** — documentation
10. **Tests** — unit tests for critical logic
