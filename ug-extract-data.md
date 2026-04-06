# Hermod User Guide — Passes 5-7 Extraction
Generated: 2026-02-25

---

## Pass 5: Search & Display

### 5.1 Dashboard

**Location:** Dashboard (sidebar link)

**Purpose:** Overview of your Hermod activity with quick access to common actions.

**Summary cards (top row):**
Each card is clickable and navigates to the corresponding section.

| Card | Shows | Links To |
|------|-------|----------|
| Reports | Total count of your reports | Reports list |
| Connections | Total count of your connections | Connections list |
| Runs (30d) | Number of recent runs (last 10 shown) | History list |

**Quick actions:**
- "New Report" button (primary) -- navigates to report creation
- "Add Connection" button (secondary) -- navigates to connections page

**Upcoming Runs (next 24 hours):**
- Displayed only when at least one enabled schedule has a run within 24 hours
- Shows as a simple list
- Fields per item: report name, relative time until run (e.g., "in 3 hrs")
- Sorted by soonest run first
- Maximum 5 items shown

**Recent Runs table:**
- Displays the 10 most recent report executions
- Empty state message: "No report runs yet. Create your first report to get started."
- Columns: Report (name), Status (badge), Rows (count or dash), Time (relative, e.g., "5 min ago")
- Status badges: SUCCESS (green), FAILED (red), RUNNING (animated)
- Rows are not clickable
- No search, no filters, no sorting, no pagination on this view

---

### 5.2 Reports List

**Location:** Reports (sidebar link)

**Purpose:** View all your saved reports and access them for editing.

**Search/Filter:** None. All reports are displayed in a single list. No search bar, no filter dropdowns, no pagination.

**Sorting:** Reports are pre-sorted by most recently updated first (server-side).

**Display format:** Vertical card list (not a table). Each card is a clickable link that navigates to the report editor page.

**Fields per report card:**
- Report name (clickable -- opens the report editor)
- Connection name (e.g., "Production DB")
- Last run status badge: SUCCESS, FAILED, RUNNING, or absent if never run
- Schedule badge: "Scheduled" (green) if active schedule, "Paused" (neutral) if paused schedule, absent if no schedule
- Delete button (inline, with confirmation dialog: "Delete this report and its schedule?")

**Empty state:** "No reports yet." with a link to "Create your first report."

**Header actions:** "New Report" button in the page header.

---

### 5.3 Report Editor (Detail/Edit Page)

**Location:** Accessed by clicking a report in the list or via "New Report."

**Layout:** Full-screen split layout with a main editor area and a configuration sidebar.

**Main editor area (resizable vertical panels):**

1. **SQL Editor panel (top, ~35% height):**
   - Monaco code editor with SQL syntax highlighting
   - Keyboard shortcut: Ctrl+Enter to run query
   - Toolbar above the editor:
     - Connection dropdown (select which database to query against)
     - "Run Query" button
     - Shortcut hint "CTRL+ENTER"
     - After running: shows row count and execution time (e.g., "42 rows in 312ms")

2. **Results panel (bottom, ~65% height):**
   - **Column Config panel** (appears after first query run):
     - Collapsible panel showing each column from query results
     - Table grid with columns: drag handle, Source (dropdown to remap), Display Name (editable), Width (number), Formula (text input), Visibility toggle (on/off), Delete button
     - Drag-and-drop reordering of columns
     - "Add Formula" button to add computed columns
     - Warnings shown when column structure changes between query runs
   - **Header Row control**: number input to set how many preamble rows appear above data headers (1-20)
   - **Spreadsheet preview**: Interactive spreadsheet (Univer) showing mapped query results
     - Preview capped at 20 rows with a note: "Showing 20 of N rows -- full data used in export"
     - WYSIWYG formatting: users can style cells, set fonts, colors, borders, etc.
     - Auto-saves formatting every 5 seconds
   - Empty state: "Run a query to see results"

**Configuration sidebar (right, 288px wide):**
- **Report Config section:**
  - Name (text input, required)
  - Description (textarea, optional)
  - Connection (dropdown, required)
  - Forge Blueprint (dropdown, only visible if blueprints exist; options: "None (raw query output)" plus any ACTIVE or VALIDATED blueprints)
  - "Save Report" button (primary)
  - "Save & Schedule" button (secondary, only for existing reports)
  - "Unsaved changes" warning indicator
- **Test Send section** (only for saved reports):
  - Email connection dropdown (lists your configured SMTP connections)
  - Recipient email input (comma/semicolon separated)
  - "Send Test Email" button (disabled if unsaved changes; tooltip: "Save changes before sending")

---

### 5.4 Connections Page

**Location:** Connections (sidebar link)

**Purpose:** Manage database connections, SFTP file integrations, and email delivery connections.

**Search/Filter:** None. All connections displayed in categorized groups. No search, no filtering, no pagination.

**Display format:** Cards in a 2-column grid layout, grouped into three sections separated by decorative dividers:

**Section 1: Database Connections**
- Card fields: Name, type badge (PostgreSQL / SQL Server / MySQL / BigQuery), host:port / database path
- Actions per card: Edit button, Delete button (with confirmation: "Delete this connection?")

**Section 2: File Integrations (SFTP)**
- Card fields: Name, source type badge (ADP / QuickBooks / SAP / File Drop / Custom SFTP), status badge with indicator dot (Watching / Error / Disabled), last file name and date, files processed count
- Actions per card: "Credentials" button (opens modal overlay), Delete button (with confirmation)
- Credentials modal shows: Host, Port, Username, Password (all copyable fields)

**Section 3: Email Delivery**
- Card fields: Name, auth type badge (No Auth / Password / OAuth2), host:port, from address
- Actions per card: Edit button, Delete button (with confirmation)

**Empty state (no connections at all):** "No connections yet." with a link to "Add your first connection."

**Header actions:** "Add Connection" button navigates to the new connection page.

---

### 5.5 New Connection Page

**Location:** Accessed from "Add Connection" on the Connections page.

**Purpose:** Choose which type of connection to create.

**Display format:** Source picker with visual cards in a grid, organized into three sections:

**Database Connections (4 options in a 4-column grid):**
- PostgreSQL, SQL Server, MySQL, BigQuery
- Each card shows: decorative rune icon, name, short description

**File Integrations (5 options in a 5-column grid):**
- ADP ("Payroll and HR data via SFTP")
- QuickBooks ("Accounting data via SFTP")
- SAP ("ERP data via SFTP")
- File Drop ("Receive any file via SFTP")
- Custom SFTP ("Manual SFTP configuration")

**Email Delivery (1 option):**
- SMTP Email ("Configure SMTP for sending reports")

**Behavior on selection:**
- Database types: redirects to connections page with inline form open
- Email type: redirects to connections page with email form open
- SFTP types: opens an SFTP wizard inline on the same page

---

### 5.6 Schedules List

**Location:** Schedules (sidebar link)

**Purpose:** View and manage all report delivery schedules.

**Search/Filter:** None. All schedules displayed in a single table. No search, no filtering, no pagination.

**Sorting:** Pre-sorted by next run time ascending (soonest first, server-side).

**Display format:** Table.

**Table columns:**
| Column | Content |
|--------|---------|
| Report | Report name (text only, not clickable) |
| Frequency | Human-readable schedule description (e.g., "Every Mon, Wed, Fri at 8:00 AM", "Monthly on the 15th at 6:00 AM", "Daily at 9:30 AM") |
| Next Run | Date and time of next scheduled run, or dash if not set |
| Recipients | Recipient count (e.g., "3 recipients") |
| Enabled | Toggle switch (click to enable/disable the schedule instantly) |
| (actions) | "Edit" button -- navigates to the schedule editor for that report |

**Empty state:** "No scheduled reports yet. Create a report and add a schedule to get started."

---

### 5.7 Schedule Editor (Detail/Edit Page)

**Location:** Accessed via "Edit" on the Schedules list or "Save & Schedule" from the report editor.

**Purpose:** Create or edit the email delivery schedule for a specific report.

**Layout:** Single-column form, max 672px wide.

**Header:** Title ("Schedule Report" or "Edit Schedule"), report name shown below, enabled/disabled toggle switch.

**Form fields:**

| Field | Type | Options/Details |
|-------|------|-----------------|
| Frequency | Dropdown | Daily, Weekly, Biweekly, Monthly, Quarterly |
| Days | Day selector (buttons) | Appears for Weekly/Biweekly only. Sun through Sat toggle buttons |
| Day of Month | Dropdown | Appears for Monthly/Quarterly. Numbers 1-31 plus "Last day" |
| Months | Month toggle buttons | Appears for Quarterly only. Jan-Dec toggle buttons |
| Time | Three dropdowns | Hour (1-12), Minute (00, 15, 30, 45), AM/PM |
| Timezone | Dropdown with groups | "Common" group (7 US timezones) and "All Timezones" group |
| Email Connection | Dropdown | Your configured SMTP connections. Link to add one if none exist |
| Recipients | Recipient input | Add email addresses; auto-suggests previously used addresses |
| Email Subject | Text input | Supports variables: {report_name}, {date}, {day_of_week}, {row_count}, {run_time}, {connection_name} |
| Email Body | Textarea | Optional custom message body |

**Schedule Preview:** Shown below the form fields, summarizes the schedule in plain language.

**Save:** "Save Schedule" button (full width).

---

### 5.8 Run History

**Location:** History (sidebar link)

**Purpose:** Track all report execution history.

**Search/Filter:** Status filter dropdown with options:
- All statuses (default)
- Success
- Failed
- Running

No text search. No date range filter. No pagination (capped at 100 most recent runs, server-side).

**Sorting:** Pre-sorted by most recent first (server-side).

**Display format:** Table.

**Table columns:**
| Column | Content |
|--------|---------|
| Report | Report name (text only, not clickable) |
| Status | Badge: SUCCESS (green), FAILED (red, clickable), RUNNING (animated) |
| Rows | Row count or dash |
| Started | Relative time (e.g., "5 min ago", "2 hours ago", or date for older runs) |
| Duration | Execution time (e.g., "312ms", "2.5s") or dash if still running |
| (actions) | "Re-run" button -- triggers immediate report re-send |

**Error inspection:** Clicking a FAILED status badge opens a modal with the full error message in a scrollable code block.

**Empty state:** "No run history yet."

---

### 5.9 Mjolnir (Forge)

**Location:** Mjolnir (sidebar link)

**Purpose:** Create transformation blueprints by uploading BEFORE and AFTER example files. The system uses AI to reverse-engineer the transformation steps.

**Search/Filter:** None on the blueprint list.

**Page layout:** Two sections separated by a decorative divider:

**Section 1: Forge Wizard (6-step process)**
See Pass 6 for detailed workflow.

**Section 2: Saved Blueprints list**

**Display format:** Vertical card list.

**Fields per blueprint card:**
- Blueprint name
- Status badge: DRAFT (gold), VALIDATED (green), ACTIVE (blue), ARCHIVED (muted)
- Version number (e.g., "v1")
- Description (if provided, truncated)
- Before filename and after filename (with arrow between them)
- Last updated date
- Delete button (with confirmation: "Delete this blueprint?")

**Empty state:** "No blueprints forged yet. Upload BEFORE and AFTER files above to create your first blueprint."

---

### 5.10 Validation Report (Mjolnir)

**Purpose:** Displayed as step 5 of the Mjolnir Forge wizard after running a validation test.

**Display sections:**

1. **Overall Score:** Large percentage number with Passed/Failed badge
   - Score at or above 95% = Passed; below = Failed

2. **Summary line:** Shows one of:
   - Pattern mode: "Pattern validation -- X of Y checks passed across Z columns."
   - Strict mode: "N of M cells matched across Z columns." with key column info if applicable.

3. **Pattern Checks** (pattern mode only):
   - List of individual checks, each showing: pass/warn/fail icon, category label (Column Structure / Formula / Format / Renames / Row Count), description, optional details

4. **Column Coverage/Match Rates:**
   - Bar chart per column showing match percentage
   - Columns sorted by match rate ascending (worst first)
   - Bars colored gold (>=95%) or red (<95%)

5. **Unmatched Row Info** (strict mode with key matching):
   - Shows counts of unmatched rows in AFTER or executed output

6. **Unsupported Steps Warning:**
   - Lists any transformation steps that were skipped during validation

7. **Mismatches Table** (strict mode only):
   - Table with columns: Row, Column, Expected, Actual
   - Capped at 50 displayed mismatches with a note showing total count

---

## Pass 6: Status Workflows

### 6.1 Report Run Status (RunLog)

**Statuses:** RUNNING, SUCCESS, FAILED

**Progression:**
```
RUNNING --> SUCCESS (completed normally)
RUNNING --> FAILED (error occurred)
```

**Transitions:**
- RUNNING: Automatic when the worker begins executing a report's SQL query and generating the Excel file
- SUCCESS: Automatic when the query executes, Excel generates, and email sends without error
- FAILED: Automatic when any step in the execution pipeline throws an error

**Where shown:**
- Dashboard "Recent Runs" table (status badge)
- History page table (status badge; FAILED is clickable to view error details)
- Reports list cards (last run status badge)

**User actions available by status:**
- FAILED: Click badge to view error details; click "Re-run" to re-execute the report
- SUCCESS: Click "Re-run" to re-execute the report
- RUNNING: No actions available (wait for completion)

**Status-dependent UI:** The FAILED badge gains a clickable cursor and opens an error detail modal when clicked. All statuses show a "Re-run" button in the History list.

---

### 6.2 SFTP Connection Status

**Statuses:** ACTIVE, ERROR, DISABLED

**Display labels:**
| Status | Label | Visual |
|--------|-------|--------|
| ACTIVE | "Watching" | Green badge with pulsing dot |
| ERROR | "Error" | Red badge with static dot |
| DISABLED | "Disabled" | Neutral/gray badge with gray dot |

**Progression:**
```
ACTIVE <--> ERROR (system-driven based on file processing results)
ACTIVE --> DISABLED (user or system action)
DISABLED --> ACTIVE (user or system action)
```

[VERIFY: How transitions between ACTIVE, ERROR, and DISABLED are triggered. These appear to be set server-side by the SFTP watcher process. No UI controls for changing SFTP status were found in the components read.]

**Where shown:** SFTP connection cards on the Connections page.

---

### 6.3 Schedule Enabled/Disabled

**Statuses:** Enabled (true), Disabled (false)

**Toggle behavior:** Users can flip the toggle switch directly from two locations:
- Schedules list page: inline toggle in the table row
- Schedule editor: toggle in the page header

**Effect:** When disabled, the worker skips the schedule during its 60-second polling cycle. The next run time remains stored but no jobs are enqueued. The Reports list shows a "Paused" badge instead of "Scheduled."

---

### 6.4 Blueprint Status (Mjolnir)

**Statuses:** DRAFT, VALIDATED, ACTIVE, ARCHIVED

**Progression:**
```
DRAFT --> VALIDATED (after validation step passes)
VALIDATED --> ACTIVE [VERIFY: trigger for ACTIVE transition]
ACTIVE --> ARCHIVED [VERIFY: trigger for ARCHIVED transition]
DRAFT --> ARCHIVED [VERIFY: can a draft be archived directly?]
```

**Where each status appears:**
- Blueprint cards in the Mjolnir page: colored badge per status
- Report editor blueprint dropdown: only ACTIVE and VALIDATED blueprints appear

**Badge colors:**
| Status | Style |
|--------|-------|
| DRAFT | Gold border, gold text |
| VALIDATED | Green border, green text |
| ACTIVE | Blue border, blue text |
| ARCHIVED | Gray border, muted text |

[VERIFY: The UI only shows transitions through the Mjolnir wizard, which saves new blueprints. No UI was found for manually changing a blueprint's status (e.g., promoting VALIDATED to ACTIVE, or archiving). These transitions may be handled via direct database changes or API calls not exposed in the current UI.]

---

### 6.5 Mjolnir Forge Wizard (6-Step Workflow)

**Step progression with actions:**

| Step | Label | User Action | Advances To |
|------|-------|-------------|-------------|
| 1 | Upload Before | Upload the original source Excel/CSV file | Step 2 |
| 2 | Upload After | Upload the desired output Excel/CSV file | Step 3 |
| 3 | Describe | Optionally describe the transformation; click "Analyze" or "Skip Description" | Step 4 (after AI analysis completes) |
| 4 | Review Steps | Review AI-detected transformation steps; edit if needed; click "Test Run" or "Skip Validation" | Step 5 (after validation) or Step 6 |
| 5 | Validate | Review validation results (pass/fail); click "Save Blueprint", "Edit Steps", or "Re-validate" | Step 6, or back to Step 4 |
| 6 | Save | Enter blueprint name; click "Forge Blueprint" | Resets wizard; blueprint appears in list |

**Navigation rules:**
- Step 1 is always accessible
- Step 2 requires a BEFORE file uploaded
- Step 3 requires an AFTER file uploaded
- Step 4 requires analysis results (steps detected)
- Steps 5-6 require validation results
- Users can navigate backwards to any completed step via the progress bar
- "Start Over" button available at any step after step 1 (resets entire wizard)

**Step 4 details (Review Steps):**
- Shows a summary of structural diff: columns removed, columns added, columns matched, reorder/sort detected, ambiguous cases
- AI inference warnings displayed in a highlighted box if the AI encountered issues
- Editable step list -- users can modify the detected transformation steps
- Step count shown (e.g., "5 steps detected")

---

## Pass 7: Roles & Permissions

### 7.1 Authentication

**Sign-in method:** Google OAuth (via NextAuth.js)
- Single "Sign in with Google" button on the login page
- Microsoft sign-in shown as "Coming soon" (disabled button)
- Session stored in the database (database strategy, not JWT)
- Session token stored in cookies (`next-auth.session-token` or `__Secure-next-auth.session-token`)

**Session enforcement:**
- Middleware intercepts all protected routes (`/dashboard/*`, `/reports/*`, `/connections/*`, `/schedules/*`, `/history/*`) and redirects to `/login` if no session token is present
- Server components use `requireAuth()` which checks the session and redirects to `/login` if not authenticated
- API routes use `withAuth()` wrapper which returns 401 Unauthorized if no valid session

### 7.2 Authorization Model

**All users have equal access.** There is no role-based access control (RBAC) system in Hermod.

The authorization model is strictly **user-scoped data isolation**:
- Every database query filters by `userId: session.user.id`
- Users can only see and manage their own data: reports, connections, schedules, run history, blueprints
- There is no admin role, no editor/viewer distinction, no team sharing, no organization hierarchy
- No `role`, `isAdmin`, `canEdit`, `hasAccess`, or `permission` fields exist in the User model or anywhere in the codebase

**Data isolation confirmed across all resources:**

| Resource | Isolation |
|----------|-----------|
| Reports | `where: { userId: session.user.id }` |
| Connections (Database) | `where: { userId: session.user.id }` |
| Connections (SFTP) | `where: { userId: session.user.id }` |
| Connections (Email) | `where: { userId: session.user.id }` |
| Schedules | `where: { report: { userId: session.user.id } }` |
| Run History | `where: { report: { userId: session.user.id } }` |
| Blueprints | `where: { userId: session.user.id }` |

### 7.3 User-Visible Account Information

- User avatar (Google profile picture) shown in the sidebar
- User name shown in the sidebar
- First name shown in the dashboard greeting ("Welcome back, John")
- "Exit" button in the sidebar triggers sign-out

### 7.4 Permissions Summary

Every authenticated user can:
- Create, edit, and delete their own database connections, SFTP connections, and email connections
- Create, edit, and delete their own reports
- Run SQL queries against their own connections
- Format spreadsheet output with WYSIWYG styling
- Configure column mappings, display names, formulas, visibility, and ordering
- Create, edit, enable/disable, and delete schedules for their own reports
- Send test emails from the report editor
- View their own run history and re-run failed or successful reports
- Create, validate, and delete Mjolnir blueprints
- Attach blueprints to reports for automated data transformation

No user can:
- See or access another user's data in any way
- Perform administrative functions (there are none in the UI)
- Share reports, connections, or schedules with other users [VERIFY: confirm no sharing features are planned or hidden in API routes not yet surfaced in the UI]
