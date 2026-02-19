# Hermod — Claude Code Build Prompt

## Context

You are building **Hermod** (named after the Norse messenger god), an open-source Next.js application that lets users:
1. Connect to SQL databases (Postgres, SQL Server, MySQL, BigQuery)
2. Write and run SQL queries with a Monaco code editor
3. Preview results in a spreadsheet grid and apply Excel-style formatting (colors, bold, number formats, column widths)
4. Save reports and schedule them for automatic email delivery with a visual calendar-based scheduler (no cron expressions)
5. Receive formatted `.xlsx` Excel attachments via email on their chosen schedule

The project scaffolding already exists. **Do not recreate** files that already exist unless you need to modify them. The foundation includes:

### Already built:
- `package.json` with all dependencies
- `docker-compose.yml` (app + Postgres)
- `Dockerfile` (multi-stage production build)
- `.env.example` with all required env vars
- `prisma/schema.prisma` — full data model (User, Account, Session, DataSource, Report, Schedule, Recipient, RunLog)
- `next.config.js`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`
- `src/lib/db.ts` — Prisma client singleton
- `src/lib/auth.ts` — NextAuth config with Google OAuth + Prisma adapter
- `src/lib/session.ts` — `requireAuth()` and `getSession()` helpers
- `src/app/api/auth/[...nextauth]/route.ts` — NextAuth route handler
- `src/types/next-auth.d.ts` — session type augmentation
- `src/components/providers.tsx` — client SessionProvider wrapper
- `src/components/sidebar.tsx` — navigation sidebar with icons
- `src/app/layout.tsx` — root layout
- `src/app/login/page.tsx` — Google sign-in page
- `src/app/(app)/layout.tsx` — authenticated layout with sidebar + requireAuth
- `src/app/(app)/page.tsx` — dashboard with stats + recent runs table
- Placeholder pages: `/reports`, `/connections`, `/schedules`, `/history`

### Tech stack (already in package.json):
- **Next.js 14** (App Router)
- **Prisma** (ORM)
- **NextAuth v4** (Google OAuth)
- **pg-boss** (Postgres-based job scheduler — NO Redis)
- **ExcelJS** (xlsx generation with formatting)
- **Nodemailer** (email delivery)
- **DB drivers**: `mssql`, `pg`, `mysql2`, `@google-cloud/bigquery`
- **Tailwind CSS**
- **Zod** (validation)

---

## What to build — work through these in order

### 1. Connections Page (`/connections`)

**Replace the placeholder** `src/app/(app)/connections/page.tsx` with a full connection manager.

**UI:**
- "Add Connection" button opens a modal/slide-over form
- Form fields:
  - **Name** (text input)
  - **Type** (dropdown: PostgreSQL, SQL Server, MySQL, BigQuery)
  - Conditional fields based on type:
    - For Postgres/MSSQL/MySQL: Host, Port (auto-fill default port per type), Database, Username, Password
    - For BigQuery: Project ID, JSON credentials (textarea or file upload)
- **"Test Connection"** button that hits an API route and shows success/failure inline
- **"Save"** button
- List of saved connections as cards showing name, type, host, with edit/delete actions
- Connection passwords should be masked in the UI

**API routes** (`src/app/api/connections/`):
- `POST /api/connections` — create connection
- `GET /api/connections` — list user's connections
- `PUT /api/connections/[id]` — update
- `DELETE /api/connections/[id]` — delete
- `POST /api/connections/test` — test a connection config (don't require saving first)

**Backend** (`src/lib/connectors.ts`):
- Create a `DataSourceConnector` interface with a `query(sql: string): Promise<{columns: string[], rows: any[]}>` method and a `testConnection(): Promise<boolean>` method
- Implement for each driver: `PostgresConnector`, `MSSQLConnector`, `MySQLConnector`, `BigQueryConnector`
- Factory function: `getConnector(dataSource: DataSource): DataSourceConnector`
- All connectors should have connection timeouts (30s) and query timeouts (120s)

### 2. Reports Page (`/reports`)

**Replace the placeholder.** This is the core of the app.

**Report List View** (`/reports`):
- Grid/list of user's reports showing name, connection, last run status, schedule status
- "New Report" button navigates to `/reports/new`

**Report Editor** (`/reports/new` and `/reports/[id]`):
This is a single page with a **3-panel layout** (can be tabbed on smaller screens):

**Panel 1 — SQL Editor (top or left):**
- Install and use `@monaco-editor/react` for the SQL editor
- Syntax highlighting for SQL
- Dropdown to select which saved connection to run against
- "Run Query" button (Ctrl+Enter shortcut)
- Show row count and execution time after running
- Show errors inline in red below the editor

**Panel 2 — Results Grid (bottom or right):**
- Display query results in a data grid
- Use `@handsontable/react` (Community Edition, `handsontable` package) for the spreadsheet grid
- Grid should be read-only for data but allow formatting changes
- **Formatting toolbar** above the grid:
  - Bold toggle
  - Text color picker (small preset palette)
  - Background color picker
  - Number format dropdown (General, Number, Currency, Percentage, Date)
  - Text alignment (left, center, right)
  - Column width adjustment (drag or input)
- Users select cells/columns then apply formatting
- Store formatting config as JSON in the report's `formatting` field
- The formatting JSON should map column indices to style objects, plus support header row styles

**Panel 3 — Report Config (sidebar or top bar):**
- Report name input
- Report description (optional textarea)
- Connection selector dropdown
- "Save Report" button
- "Save & Schedule" button (navigates to schedule builder for this report)

**API routes** (`src/app/api/reports/`):
- `POST /api/reports` — create report
- `GET /api/reports` — list user's reports
- `GET /api/reports/[id]` — get single report with formatting
- `PUT /api/reports/[id]` — update report (query, formatting, name, etc.)
- `DELETE /api/reports/[id]` — delete report
- `POST /api/reports/[id]/run` — execute the query and return results (don't save to history, just preview)
- `POST /api/reports/[id]/send` — manually trigger send (run + email)

### 3. Schedule Builder (`/reports/[id]/schedule`)

This is the **key differentiator**. No cron expressions. Everything is visual.

**UI — Schedule Form:**
- **Frequency dropdown**: Daily, Weekly, Biweekly, Monthly, Quarterly
- **Day selector** (shows/hides based on frequency):
  - Weekly/Biweekly: clickable pill buttons for Mon–Sun (multi-select)
  - Monthly: dropdown for day of month (1–31) with "Last day" option
  - Quarterly: month selector (which months) + day of month
  - Daily: no day selector needed
- **Time picker**: separate dropdowns for Hour (1-12), Minute (00, 15, 30, 45), AM/PM
- **Timezone dropdown**: populated with common US timezones at top, then full IANA list. Auto-detect user's timezone as default.
- **Recipients section**:
  - Tag-style email input — type email, press Enter to add as a pill/chip
  - Remove button (x) on each pill
  - Optional: name field per recipient
  - "Add from previous" dropdown showing emails used in other schedules
- **Email subject** text input (with template variables like `{report_name}`, `{date}`, `{day_of_week}`)
- **Email body** textarea (plain text with same template variables)
- **Enable/Disable toggle** — prominent at the top
- **Preview line** at the bottom: human-readable summary like:
  > "This report will send every **Tuesday and Thursday at 8:00 AM CT** to **joe@whitmor.com** and **2 others**"
- **"Save Schedule"** button

**API routes** (`src/app/api/schedules/`):
- `POST /api/schedules` — create schedule for a report
- `GET /api/schedules` — list all schedules with report names
- `PUT /api/schedules/[id]` — update schedule
- `DELETE /api/schedules/[id]` — delete schedule
- `POST /api/schedules/[id]/toggle` — enable/disable

When a schedule is saved or updated, compute the `nextRunAt` datetime and store it. The worker uses this field.

### 4. Schedules Overview Page (`/schedules`)

**Replace the placeholder** with a page showing all scheduled reports in a table/card view:
- Report name, frequency description (human readable), next run time, enabled/disabled toggle, last run status
- Click to edit the schedule
- Quick toggle to enable/disable without opening editor

### 5. pg-boss Worker (`src/lib/worker.ts`)

This is the background process that actually sends reports.

**Architecture:**
- Create `src/lib/pg-boss.ts` — pg-boss singleton instance (connects to same DATABASE_URL)
- Create `src/lib/worker.ts` — the worker entry point (run via `npm run worker` or `tsx src/lib/worker.ts`)
- Create `src/lib/report-runner.ts` — the actual report execution logic

**Worker flow:**
1. On startup, connect pg-boss to the database
2. Register a handler for the `send-report` job queue
3. Run a "scheduler tick" every 60 seconds that:
   - Queries all enabled schedules where `nextRunAt <= now()`
   - For each due schedule, enqueue a `send-report` job with `{ reportId, scheduleId }`
   - Update the schedule's `nextRunAt` to the next occurrence

**`nextRunAt` calculation** (`src/lib/schedule-utils.ts`):
- Write a function `calculateNextRun(schedule: Schedule): Date` that computes the next occurrence based on frequency, daysOfWeek, dayOfMonth, timeHour, timeMinute, and timezone
- Use the `Intl.DateTimeFormat` API or a lightweight library for timezone handling
- Handle edge cases: monthly schedules where day > days in month (fall back to last day)

**Report runner** (`src/lib/report-runner.ts`):
When a `send-report` job fires:
1. Create a RunLog entry with status RUNNING
2. Fetch the report + data source + schedule + recipients from DB
3. Execute the SQL query via the appropriate connector
4. Generate an `.xlsx` file using ExcelJS with the saved formatting applied:
   - Apply column widths, header styles, cell colors, number formats, bold, alignment
   - Name the worksheet after the report name
   - Auto-filter on header row
5. Compose the email:
   - Replace template variables in subject and body (`{report_name}`, `{date}`, `{day_of_week}`, `{row_count}`)
   - Attach the `.xlsx` as `{report_name}_{YYYY-MM-DD}.xlsx`
6. Send via Nodemailer to all recipients
7. Update RunLog with status SUCCESS/FAILED, rowCount, error, completedAt

**Email setup** (`src/lib/email.ts`):
- Nodemailer transporter configured from SMTP env vars
- `sendReportEmail({ to: string[], subject: string, body: string, attachment: Buffer, filename: string })`

### 6. History Page (`/history`)

**Replace the placeholder** with a filterable run history table:
- Columns: Report Name, Status (color badge), Rows, Started, Completed, Duration
- Filter by report name, status, date range
- Click a failed run to see the error message in a modal
- "Re-run" button on any row to manually trigger that report again

### 7. Dashboard Enhancements (`/` page)

The dashboard skeleton exists. Enhance it:
- Make the stat cards link to their respective pages
- Add a "Quick Actions" section: "New Report", "Add Connection"
- Show next upcoming scheduled runs (next 24 hours)
- Make the recent runs table show relative time ("5 min ago", "2 hours ago")

### 8. README.md

Write a comprehensive README:
- Project description and screenshot placeholder
- Features list
- Quick start with docker-compose
- Manual setup instructions (Node + Postgres)
- Google OAuth setup walkthrough (step by step with console.cloud.google.com)
- SMTP configuration examples for Gmail, Outlook, SendGrid
- Environment variable reference table
- Architecture overview
- Contributing guidelines
- License (MIT)

---

## Code quality guidelines

- **Validate all inputs** with Zod schemas in API routes
- **All API routes** must check authentication via `getServerSession(authOptions)` and return 401 if not authenticated
- **All DB queries** must filter by `userId` — users should never see other users' data
- **Error handling**: try/catch in all API routes, return structured error JSON
- **TypeScript**: strict mode, no `any` types unless absolutely necessary (driver interop)
- **Components**: keep them in `src/components/` organized by feature (e.g., `src/components/reports/`, `src/components/schedule/`)
- **Server actions** or API routes — your choice, but be consistent. API routes are preferred for this project since the worker also needs these endpoints.
- **Loading states**: use `loading.tsx` files in route groups for skeleton loaders
- **Dark theme**: the entire app uses a dark theme (gray-950 background). Keep all UI consistent with this.
- **No external UI library** (no shadcn, no MUI). Use Tailwind utility classes directly. Keep it lean.

## Important implementation notes

- The `worker.ts` runs as a **separate process** alongside the Next.js app. In Docker, use a process manager or a second container. For development, it's a separate terminal running `npm run worker`.
- pg-boss creates its own tables in the database automatically on first connect. No extra migration needed.
- For the Monaco editor, use `@monaco-editor/react` which lazy-loads Monaco from CDN. Add it to package.json.
- For Handsontable, use the base `handsontable` package + `@handsontable/react`. Both need to be added to package.json. Use the free MIT-licensed features only.
- DataSource passwords should eventually be encrypted at rest. For v1, storing them plain in Postgres is acceptable but add a `// TODO: encrypt at rest` comment.
- The formatting JSON structure should look like:
```json
{
  "columns": {
    "0": { "width": 150, "numFmt": "#,##0.00" },
    "1": { "width": 200 }
  },
  "headerStyle": {
    "bold": true,
    "bgColor": "#1e3a5f",
    "fontColor": "#ffffff"
  },
  "cellStyles": {
    "A2:A100": { "bold": true },
    "C2:C100": { "numFmt": "$#,##0.00", "fontColor": "#22c55e" }
  }
}
```

## Start by:
1. Run `npm install` to install all dependencies
2. Add `@monaco-editor/react` and `@handsontable/react` + `handsontable` to package.json and install
3. Run `npx prisma generate` then `npx prisma db push` to create the database schema
4. Build feature by feature in the order listed above, testing each before moving on
5. Start with the connections page since reports depend on having a connection to query against
