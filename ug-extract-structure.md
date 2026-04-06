# Hermod User Guide Extract -- Application Structure, Navigation, and Authentication

---

## Pass 1: Routing

### Sitemap

Hermod is organized into six main sections plus a sign-in page. All sections except the sign-in page require authentication. There are no role-based restrictions -- every signed-in user sees the same pages and can only access their own data.

| URL Pattern | Page Name | Description |
|---|---|---|
| `/login` | Sign In | The sign-in page. Public (no authentication required). |
| `/dashboard` | Dashboard | Landing page after sign-in. Shows summary counts, quick-action buttons, upcoming scheduled runs (next 24 hours), and a table of recent report runs. |
| `/reports` | Reports | List of all your saved reports, showing each report's name, connection, last run status, and whether it has a schedule. |
| `/reports/new` | New Report | Opens the report editor with a blank report. You choose a connection, write SQL, preview results, format the spreadsheet, and save. |
| `/reports/[id]` | Report Editor | Opens an existing report for editing. Same interface as "New Report" but pre-filled with saved SQL, formatting, and column configuration. |
| `/reports/[id]/schedule` | Schedule Builder | Configure automated delivery for a specific report: frequency, day/time, timezone, recipients, email subject, body, and which email connection to use. |
| `/connections` | Connections | List of all your database connections, SFTP file integrations, and email (SMTP) connections. You can edit, test, delete, or add new connections from here. |
| `/connections/new` | New Connection | Picker screen where you choose what type of connection to add. Categories: Database Connections, File Integrations (SFTP), and Email Delivery (SMTP). Selecting a database type redirects to the Connections page with the add form open. Selecting an SFTP type opens the SFTP setup wizard inline. Selecting SMTP Email redirects to the Connections page with the email form open. |
| `/mjolnir` | Mjolnir | AI-powered transformation tool. Upload a "before" and "after" Excel file, and Mjolnir reverse-engineers the transformation into a reusable blueprint. Also shows your list of saved blueprints. |
| `/schedules` | Schedules | Read-only overview of all your report delivery schedules. Shows frequency, next run time, recipients, and an enable/disable toggle. |
| `/history` | Run History | Log of the last 100 report executions across all your reports. Shows report name, status (SUCCESS/FAILED/RUNNING), row count, duration, and timestamps. You can filter by status and re-send failed reports. |

### Route Protection

- **Public pages:** `/login` only.
- **Protected pages:** `/dashboard`, `/reports/*`, `/connections/*`, `/schedules/*`, `/history/*`. If you visit any of these without being signed in, you are immediately redirected to `/login`.
- **Mjolnir (`/mjolnir`):** Protected at the page level (the page code checks your session and redirects to `/login` if missing), but it is not listed in the middleware route matcher. The practical effect is the same -- you must be signed in.

### Role-Based Access

There are no user roles, admin privileges, or permission tiers. Every authenticated user has the same capabilities. All data is scoped to the signed-in user -- you cannot see or modify another user's reports, connections, schedules, or history.

### Redirects

- Visiting the root URL (`/`) does not display a page. There is no root page defined. [VERIFY: Confirm whether the root URL shows a blank page, a 404, or auto-redirects to `/login` or `/dashboard` in practice.]
- After signing in with Google, you are redirected to `/dashboard`.
- If a page-level authentication check fails (e.g., expired session), you are redirected to `/login`.
- From the New Connection picker, choosing a database type (PostgreSQL, SQL Server, MySQL, BigQuery) redirects to `/connections?add=TYPE`, which opens the database connection form inline on the Connections page.
- From the New Connection picker, choosing "SMTP Email" redirects to `/connections?addEmail=SMTP`, which opens the email connection form inline on the Connections page.

### Connection Types Available

When adding a new connection, you choose from three categories:

**Database Connections (for writing SQL queries against):**
- PostgreSQL
- SQL Server (Microsoft)
- MySQL
- BigQuery (Google Cloud)

**File Integrations (receive files via SFTP):**
- ADP (payroll/HR data)
- QuickBooks (accounting data)
- SAP (ERP data)
- File Drop (receive any file)
- Custom SFTP (manual configuration)

**Email Delivery (SMTP for sending reports):**
- SMTP Email

---

## Pass 2: Navigation

### Layout

Every page (except Sign In) uses a consistent layout with three regions:

1. **Left Sidebar** -- Fixed-width (224px) vertical navigation panel, always visible. Contains the Hermod logo, main navigation links, and the user profile section at the bottom.
2. **Top Bar** -- Horizontal header strip across the top of the main content area. Displays a breadcrumb-style label showing which section you are in (e.g., "Reports", "Report Editor", "Schedule") and a live clock on the right.
3. **Main Content Area** -- The remainder of the screen, scrollable, where page content appears.

The Sign In page (`/login`) does not use this layout -- it is a full-screen centered page.

### Sidebar Navigation Items

The sidebar contains six navigation links, listed top to bottom. Each link has a Norse rune icon and an uppercase label:

| Order | Label | Destination | Rune |
|---|---|---|---|
| 1 | Dashboard | `/dashboard` | ᛟ |
| 2 | Reports | `/reports` | ᚱ |
| 3 | Connections | `/connections` | ᚷ |
| 4 | Mjolnir | `/mjolnir` | ᛗ |
| 5 | Schedules | `/schedules` | ᛏ |
| 6 | History | `/history` | ᚺ |

The currently active item is highlighted with a gold left border and brighter text. For "Dashboard," only an exact match on `/dashboard` activates the highlight. For all other items, any URL that starts with that item's path activates it (e.g., `/reports/new` highlights "Reports").

### Top Bar Labels

The top bar displays a context-sensitive label based on your current URL:

| URL | Label Shown |
|---|---|
| `/dashboard` | Dashboard |
| `/reports` | Reports |
| `/reports/new` | New Report |
| `/reports/[id]` | Report Editor |
| `/reports/[id]/schedule` | Schedule |
| `/connections` | Connections |
| `/schedules` | Schedules |
| `/history` | Run History |

[VERIFY: The Mjolnir page (`/mjolnir`) is not in the top bar label map. The top bar likely shows no label text when on the Mjolnir page.]

### User Menu (Sidebar Footer)

At the bottom of the sidebar, separated by a horizontal line, is the user section:

- **User avatar** -- Your Google profile picture (small circle).
- **User name** -- Your display name from Google, shown as small text.
- **Exit button** -- Signs you out and returns you to the Sign In page.

There is no settings page, profile editor, or account management screen. Your account information comes entirely from your Google sign-in.

### Breadcrumbs

There are no multi-level breadcrumbs. The top bar shows a single label for the current section. Navigation between parent and child pages (e.g., from a report editor back to the reports list) is handled by explicit buttons within the page content (such as "Back to Connections" on the New Connection page).

### In-Page Navigation and Quick Actions

**Dashboard quick actions:**
- "New Report" button links to `/reports/new`
- "Add Connection" button links to `/connections`
- Clicking the "Reports" stat card links to `/reports`
- Clicking the "Connections" stat card links to `/connections`
- Clicking the "Runs (30d)" stat card links to `/history`

**Reports page:**
- "New Report" button in the page header links to `/reports/new`
- Each report row is a clickable link to `/reports/[id]` (the report editor)

**Report Editor page actions:**
- "Save" and "Save & Schedule" buttons (Schedule navigates to `/reports/[id]/schedule` after saving)
- "Test Send" section lets you enter an email address and select an email connection to send a test delivery
- Column configuration panel on the right side for reordering, renaming, and toggling column visibility

**Connections page:**
- "Add Connection" button links to `/connections/new`
- Each connection card has Edit and Delete actions (inline, no page navigation)
- SFTP connection cards show status and file delivery statistics

**Schedules page:**
- Each schedule row has an enable/disable toggle
- Clicking a schedule's report name navigates to the report editor

**History page:**
- Status filter dropdown (All, Success, Failed, Running)
- "Re-send" button on each row to re-execute and re-deliver a report
- Error details shown in a modal when clicking on a failed run

### Conditional Navigation

There are no items in the sidebar that show or hide based on user role or permissions. All six navigation items are always visible to every authenticated user.

### Notifications

Hermod uses toast notifications (small temporary messages that appear and auto-dismiss) to confirm actions or report errors throughout the application. Toast types:

- **Success** (green/gold) -- e.g., "Report saved," "Schedule enabled," "Connection tested successfully"
- **Error** (red) -- e.g., "Delete failed," "Network error," "Report not found"
- **Info** (blue/frost) -- Informational messages

---

## Pass 3: Authentication

### Sign-In Methods

Hermod uses **Google Sign-In** as the primary (and currently only active) authentication method.

- Click the "Sign in with Google" button on the Sign In page.
- You are redirected to Google's authentication screen to choose your Google account.
- After successful authentication, you are returned to Hermod at `/dashboard`.

A **Microsoft Sign-In** button is visible on the Sign In page but is disabled. It shows the label "Microsoft -- Soon" and cannot be clicked. [VERIFY: Confirm there is no target date for enabling Microsoft authentication.]

### User Information Captured

When you sign in with Google, the following information is automatically captured and stored:

- **Name** -- Your Google display name (shown in the sidebar and on the Dashboard welcome message, e.g., "Welcome back, John").
- **Email** -- Your Google email address (used for account identification).
- **Profile image** -- Your Google profile picture (shown as a small avatar in the sidebar).
- **User ID** -- An internal identifier (not visible to you) used to scope all your data.

There is no manual profile editing, no editable display name, and no way to change your email address within Hermod. All profile information comes from Google.

### First-Time Setup / Onboarding

There is no dedicated onboarding wizard or first-time setup flow. When you sign in for the first time:

1. A user account is automatically created in the database via the Prisma adapter (NextAuth handles this transparently).
2. You land on the Dashboard, which will show zero reports, zero connections, and zero runs.
3. The Dashboard provides quick-action buttons ("New Report" and "Add Connection") to help you get started.
4. The empty states on other pages include helpful hints, such as "No reports yet. Create your first report to get started." on the Reports page.

The typical first-time workflow is:
1. Go to Connections and add a database connection (provide host, port, database name, username, and password).
2. Test the connection to verify it works.
3. Optionally add an SMTP email connection (needed for scheduled delivery).
4. Go to Reports and create a new report: pick your connection, write a SQL query, run it to see results, format the spreadsheet, and save.
5. Optionally set up a schedule for automated email delivery.

### Session Management

- **Session storage:** Sessions are stored in the database (not JWT tokens). This means sessions persist across server restarts.
- **Session cookie:** The browser stores a session cookie named `next-auth.session-token` (or `__Secure-next-auth.session-token` on HTTPS).
- **Session expiration:** [VERIFY: The code does not set a custom `maxAge` for sessions. NextAuth's default database session lifetime is 30 days. Confirm whether a custom session duration has been configured or if the default applies.]
- **Automatic redirect on expiry:** If your session expires or is invalid, any navigation to a protected page immediately redirects you to the Sign In page.
- **Sign out:** Click the "Exit" button in the bottom of the sidebar. This clears your session and returns you to the Sign In page.
- **No "remember me" option:** Sessions persist by default via the database session store. There is no toggle for staying signed in.

### Security Notes for Users

- Each user's data is completely isolated. You can only see and modify your own reports, connections, schedules, and run history.
- Database connection passwords are encrypted at rest. They are never displayed back to you after initial entry.
- There is no shared/team workspace. Each Google account maps to one independent Hermod account.
