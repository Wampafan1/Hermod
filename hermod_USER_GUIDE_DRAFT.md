# Hermod User Guide

**Version:** 1.0 Draft
**Last Updated:** February 25, 2026
**Audience:** Internal power users -- technical staff who write SQL and manage report schedules

---

# 1. Introduction

Hermod is an internal SQL report builder for creating, formatting, and scheduling automated Excel report deliveries. A "report" in Hermod is a SQL query paired with spreadsheet formatting and an optional delivery schedule -- you write the query, style the output in a live spreadsheet preview, and Hermod handles generating polished `.xlsx` files and emailing them on your chosen cadence.

This guide walks you through every feature of the system, from signing in and connecting to your databases, to writing SQL queries, formatting spreadsheet output, scheduling automated deliveries, and using the Mjolnir AI forge to create reusable data transformation blueprints.

Hermod uses a dark interface with gold accents inspired by Norse mythology. You will encounter Norse terminology throughout the application: navigation icons use Elder Futhark runes, connections are organized by "realms," transformations are "forged," and the AI tool is named after Thor's hammer.

---

# 2. Getting Started

## 2.1 Signing In

Navigate to Hermod in your web browser. You will see the sign-in page -- a dark full-screen display with the Hermod logo and two sign-in options.

[Figure 1 -- The Hermod sign-in page showing the Google sign-in button and the disabled Microsoft option.]

Click the **Sign in with Google** button. The button text changes to **"Summoning the Bifrost..."** with a spinner while the authentication process runs.

[Figure 2 -- The sign-in page with the "Summoning the Bifrost..." loading state.]

You are redirected to Google's account selection screen. Choose your Google account and authorize access.

After successful authentication, you land on the **Dashboard**. Your name, email address, and profile picture are automatically captured from your Google account. There is no manual profile setup or account editing within Hermod -- all identity information comes from Google.

A **Microsoft** sign-in button is visible but currently disabled. It displays the label **"Microsoft -- Soon"** and cannot be clicked. [VERIFY: Confirm whether there is a target date for enabling Microsoft authentication.]

### First-Time Experience

When you sign in for the first time, Hermod automatically creates your account. You arrive at an empty Dashboard showing zero reports, zero connections, and zero runs. The Dashboard provides quick-action buttons to help you get started:

1. Click **Add Connection** to configure your first database connection.
2. Test the connection to verify it works.
3. Optionally add an SMTP email connection (required for scheduled delivery and test sends).
4. Click **New Report** to create your first report: select a connection, write SQL, run the query, format the spreadsheet preview, and save.
5. Optionally set up a delivery schedule for automated email delivery.

Other pages display helpful empty-state messages when you have no data, such as *"No reports yet. Create your first report to get started."*

### Signing Out

Click the **Exit** button at the bottom of the sidebar to sign out. This clears your session and returns you to the sign-in page.

### Session Behavior

Your session is stored on the server and persists across browser restarts. If your session expires or becomes invalid, any attempt to access a protected page automatically redirects you to the sign-in page. There is no "remember me" toggle -- sessions persist by default. [VERIFY: Confirm whether session duration is the default 30 days or a custom value.]

---

## 2.2 Navigation

Every page (except the sign-in page) uses a consistent three-region layout:

1. **Left Sidebar** -- A fixed-width vertical navigation panel, always visible. Contains the Hermod logo, main navigation links, and your user profile at the bottom.
2. **Top Bar** -- A horizontal header strip across the top of the main content area. Displays the current section name on the left and a live clock on the right.
3. **Main Content Area** -- The remainder of the screen where page content appears, scrollable as needed.

[Figure 3 -- The full application layout showing the sidebar, top bar, and main content area with labels.]

### Sidebar Navigation

The sidebar contains six navigation links, listed top to bottom. Each link has a Norse rune icon and an uppercase label:

| Order | Rune | Label | Purpose |
|-------|------|-------|---------|
| 1 | ᛟ | **DASHBOARD** | Overview of your activity with summary statistics and quick actions |
| 2 | ᚱ | **REPORTS** | List of all your saved reports; create, edit, and delete reports |
| 3 | ᚷ | **CONNECTIONS** | Manage database, SFTP, and email connections |
| 4 | ᛗ | **MJOLNIR** | AI-powered transformation forge for creating data blueprints |
| 5 | ᛏ | **SCHEDULES** | View and manage all automated report delivery schedules |
| 6 | ᚺ | **HISTORY** | Log of report execution history with status and timing |

The currently active section is highlighted with a gold left border and brighter text. For Dashboard, only an exact match activates the highlight. For all other sections, any page that falls under that section activates it (for example, editing a report highlights "Reports").

### Top Bar Labels

The top bar displays a section-specific label based on your current page:

| Page | Label Shown |
|------|-------------|
| Dashboard | Dashboard |
| Reports list | Reports |
| New Report | New Report |
| Report Editor | Report Editor |
| Schedule Editor | Schedule |
| Connections | Connections |
| Schedules list | Schedules |
| Run History | Run History |

[VERIFY: The Mjolnir page may not display a top bar label. Confirm what appears in the top bar when on the Mjolnir page.]

### User Profile

At the bottom of the sidebar, below a horizontal divider, you see:

- Your **profile picture** from Google (small circular avatar)
- Your **display name** from Google
- The **Exit** button to sign out

There is no settings page, profile editor, or account management screen within Hermod.

### Toast Notifications

Throughout the application, temporary notification messages appear in the bottom-right corner of the screen to confirm actions or report errors. Each notification auto-dismisses after 4 seconds, or you can click the **X** button to dismiss it immediately. Notifications come in three styles:

- **Success** (green left border) -- Confirms a successful action, such as "Report saved" or "Connection created"
- **Error** (red left border) -- Reports a failure, such as "Delete failed" or "Network error"
- **Info** (blue left border) -- Informational messages

---

# 3. Core Workflows

## 3.1 Dashboard

The Dashboard is your landing page after signing in. It provides an overview of your Hermod activity and quick access to common actions.

[Figure 4 -- The Dashboard showing summary cards, quick actions, upcoming runs, and recent runs table.]

### Summary Cards

Three clickable cards span the top of the Dashboard:

| Card | Shows | Links To |
|------|-------|----------|
| **Reports** | Total number of your reports | Reports list |
| **Connections** | Total number of your database connections | Connections list |
| **Runs (30d)** | Number of recent report runs | Run History |

Click any card to navigate directly to that section.

### Quick Actions

Two buttons appear below the summary cards:

- **New Report** (primary button) -- Opens the report creation page
- **Add Connection** (secondary button) -- Opens the Connections page

### Upcoming Runs

When you have at least one enabled schedule with a run due within the next 24 hours, the **Upcoming Runs** section appears. It lists up to 5 upcoming deliveries, sorted by soonest first. Each entry shows:

- The report name
- Relative time until the run (e.g., "in 3 hrs")

If no runs are upcoming within 24 hours, this section does not appear.

### Recent Runs

A table at the bottom of the Dashboard shows the 10 most recent report executions across all your reports.

| Column | Description |
|--------|-------------|
| **Report** | The report name |
| **Status** | A color-coded badge: **SUCCESS** (green), **FAILED** (red), or **RUNNING** (animated) |
| **Rows** | Number of rows returned, or a dash if unavailable |
| **Time** | Relative timestamp (e.g., "5 min ago") |

If you have no run history, the table displays: *"No report runs yet. Create your first report to get started."*

The Dashboard statistics refresh each time you load the page. To see updated numbers, navigate away and return.

### Welcome Message

The Dashboard greets you with a personalized welcome message using your first name, e.g., *"Welcome back, John."*

---

## 3.2 Connections

Connections are the foundation of Hermod -- they define where your data comes from (database connections), how files are received (SFTP connections), and how reports are delivered (email connections). You must create at least one database connection before you can write and run reports, and at least one email connection before you can schedule deliveries or send test emails.

### Viewing Connections

Click **CONNECTIONS** in the sidebar to see all your connections. The page organizes connections into three sections separated by decorative rune dividers:

[Figure 5 -- The Connections page showing database, SFTP, and email connection cards in their respective sections.]

**Database Connections** -- Each card displays:
- Connection name
- Type badge (PostgreSQL, SQL Server, MySQL, or BigQuery)
- Host and port (or project path for BigQuery)
- **Edit** and **Delete** action buttons

**File Integrations (SFTP)** -- Each card displays:
- Connection name
- Source type badge (ADP, QuickBooks, SAP, File Drop, or Custom SFTP)
- Status indicator with a colored dot: **Watching** (green, pulsing), **Error** (red), or **Disabled** (gray)
- Last file received (filename and date)
- Total files processed count
- **Credentials** and **Delete** action buttons

**Email Delivery** -- Each card displays:
- Connection name
- Auth type badge (No Auth, Password, or OAuth2)
- SMTP host and port
- From address
- **Edit** and **Delete** action buttons

If you have no connections, the page displays: *"No connections yet."* with a link to *"Add your first connection."*

Click **Add Connection** in the page header to add a new connection.

### Adding a New Connection

Click **Add Connection** to open the connection type picker page. You choose from three categories of connections:

[Figure 6 -- The New Connection page showing the source picker with database, SFTP, and email categories.]

**Database Connections** (for running SQL queries):

| Option | Description |
|--------|-------------|
| **PostgreSQL** | Open-source relational database |
| **SQL Server** | Microsoft SQL Server |
| **MySQL** | MySQL database |
| **BigQuery** | Google Cloud BigQuery |

**File Integrations** (for receiving files via SFTP):

| Option | Description |
|--------|-------------|
| **ADP** | Payroll and HR data via SFTP |
| **QuickBooks** | Accounting data via SFTP |
| **SAP** | ERP data via SFTP |
| **File Drop** | Receive any file via SFTP |
| **Custom SFTP** | Manual SFTP configuration |

**Email Delivery** (for sending report emails):

| Option | Description |
|--------|-------------|
| **SMTP Email** | Configure SMTP for sending reports |

Each option is displayed as a clickable card with a decorative rune icon, the connection name, and a short description.

---

### 3.2.1 Adding a Database Connection

Select a database type (PostgreSQL, SQL Server, MySQL, or BigQuery) from the connection picker. A modal dialog opens over the Connections page with the heading **"Add Connection."**

[Figure 7 -- The Add Connection modal for a PostgreSQL database with all fields visible.]

#### Required Fields

- **Name** -- A descriptive name for this connection (e.g., "Production Database"). Maximum 100 characters.
- **Type** -- The database type, pre-selected based on your choice from the picker. Options: PostgreSQL, SQL Server, MySQL, BigQuery. You cannot change the type after creation.

#### Fields for PostgreSQL, SQL Server, and MySQL

- **Host** -- The hostname or IP address of the database server (e.g., "db.example.com").
- **Port** -- The port number. Auto-filled with the standard default for the selected type:
  - PostgreSQL: 5432
  - SQL Server: 1433
  - MySQL: 3306

  Changing the database type automatically updates the port to that type's default. You can override this with any value from 1 to 65535.
- **Database** -- The database name to connect to (e.g., "my_database").
- **Username** -- The database login username.
- **Password** -- The database login password. Displayed as dots for security.

#### Fields for BigQuery

Instead of host/port/database/username/password fields, BigQuery requires:

- **Service Account JSON** -- Click the upload area (or drag and drop) to provide a Google Cloud service account key file. The file must be a `.json` file containing a valid service account key with the fields `project_id`, `private_key`, `client_email`, and related authentication URLs. After upload, the filename is displayed to confirm the file was loaded. The system validates the JSON structure and shows an error if the file is not a valid service account key.

#### Testing and Saving

- **Test Connection** -- Click to verify that Hermod can connect to the database using your provided credentials. The button shows **"Testing..."** while in progress. A green banner reading **"Connection successful!"** appears on success, or a red banner with the specific error message appears on failure.
- **Cancel** -- Closes the modal without saving.
- **Save** -- Creates the connection. The button shows **"Saving..."** during the save. On success, a toast notification confirms **"Connection created"** and the connections list refreshes.

> **Note:** Database connection passwords are encrypted at rest and are never displayed back to you after the initial save.

### Editing a Database Connection

Click **Edit** on any database connection card. The same modal opens with the heading **"Edit Connection"** and all fields pre-filled with the existing values. The **Type** dropdown is disabled -- you cannot change the database type after creation.

The password field label changes to **"Password (blank = keep)"** -- leave it blank to keep the existing password, or enter a new value to change it.

Click **Save** to apply changes. A toast notification confirms **"Connection updated."**

---

### 3.2.2 Adding an Email Connection

Select **SMTP Email** from the connection picker. A modal dialog opens with the heading **"Add Email Connection."**

[Figure 8 -- The Add Email Connection modal with Username & Password authentication selected.]

#### Required Fields

- **Name** -- A descriptive name for this email connection (e.g., "Office 365 Relay"). Maximum 200 characters.
- **Authentication** -- How the SMTP server authenticates. Options:
  - **None (IP whitelist / relay)** -- No credentials required; used for internal relay servers. Selecting this auto-sets the port to 25 and unchecks TLS.
  - **Username & Password** -- Standard SMTP authentication. Selecting this auto-sets the port to 587.
  - **OAuth2** -- OAuth2-based authentication. Selecting this auto-sets the port to 587.
- **SMTP Host** -- The hostname of the SMTP server (e.g., "smtp.gmail.com"). Maximum 500 characters.
- **Port** -- The SMTP port. Auto-adjusted based on authentication type and TLS settings:
  - Standard STARTTLS: 587
  - SSL/TLS: 465
  - No auth relay: 25

  You can override the port manually with any value from 1 to 65535.
- **Use TLS/SSL (port 465)** -- Check this box to enable SSL/TLS encryption. When toggled, the port automatically adjusts between 587 and 465.
- **From Address** -- The sender address that appears on delivered emails (e.g., `Hermod <reports@yourdomain.com>`). You can include a display name in the format `Name <email>`. Maximum 500 characters.

#### Conditional Fields (Username & Password or OAuth2)

When authentication is set to **Username & Password** or **OAuth2**, two additional fields appear:

- **Username** -- The SMTP login username (e.g., "user@domain.com"). Maximum 500 characters.
- **Password** -- The SMTP login password. Displayed as dots. Maximum 2,000 characters.

#### Testing and Saving

- **Test Connection** -- Click to verify the SMTP connection. Disabled when the SMTP Host field is empty. Shows **"Testing..."** while running. Displays a green success or red error banner.
- **Cancel** -- Closes the modal without saving.
- **Save** -- Creates the email connection. Disabled until Name, SMTP Host, and From Address are all filled. Shows **"Saving..."** during save. On success, a toast notification confirms **"Email connection created."**

### Editing an Email Connection

Click **Edit** on any email connection card. The modal opens with the heading **"Edit Email Connection"** and fields pre-filled. The password field label changes to **"Password (blank = keep)."**

Click **Save** to apply changes. A toast notification confirms **"Email connection updated."**

---

### 3.2.3 Adding an SFTP Connection

Select any SFTP source type (ADP, QuickBooks, SAP, File Drop, or Custom SFTP) from the connection picker. A 4-step wizard opens inline on the page.

[Figure 9 -- The SFTP Connection Wizard at Step 1, showing the name and description fields.]

#### Step 1: Name It

- **Connection Name** -- A descriptive name for this file integration (e.g., "Acme Corp Payroll"). Maximum 100 characters. Required.
- **Description (optional)** -- Additional context (e.g., "Weekly payroll export from ADP"). Maximum 500 characters.

Click **Generate Credentials** to create the SFTP connection on the server. The button is disabled until a name is entered and shows **"Creating..."** while processing. On success, the wizard advances to Step 2.

Click **Back** to return to the source picker.

#### Step 2: Credentials

The system auto-generates SFTP credentials and displays them in a read-only credential card:

- **Host** -- The SFTP server address
- **Port** -- The SFTP port
- **Username** -- Auto-generated from your connection name
- **Password** -- A randomly generated secure password

[Figure 10 -- The SFTP Wizard Step 2 showing generated credentials with Copy buttons.]

Each field has a **Copy** button, and a **Copy All** button copies all credentials at once. Below the credentials, source-specific setup instructions appear (for example, how to configure ADP to deliver files via SFTP to these credentials).

- **Test Connection** -- Tests that the SFTP server is reachable. Shows **"Testing..."** while running. A green banner confirms **"Connection test passed -- folders are accessible"** on success.
- **Download Setup Guide (PDF)** -- Currently disabled (grayed out).
- **Back** -- Returns to Step 1.
- **Configure Processing** -- Advances to Step 3.

#### Step 3: Configure Processing

[Figure 11 -- The SFTP Wizard Step 3 showing file format, BigQuery destination, and load mode settings.]

An info box at the top reads: **"Destination: Load to BigQuery."**

- **Expected File Format** -- The format of incoming files. Options: ".csv (Comma Separated)", ".tsv (Tab Separated)", ".xlsx (Excel)". Default: CSV.
- **BigQuery Dataset** -- The destination dataset name in BigQuery (e.g., "payroll_data"). Maximum 100 characters. Required.
- **BigQuery Table** -- The destination table name in BigQuery (e.g., "adp_export"). Maximum 100 characters. Required.
- **Load Mode** -- How data is loaded into the destination table. Options:
  - **Replace (drop and reload)** -- Clears the table and loads fresh data each time. Default.
  - **Append (add rows)** -- Adds new rows to existing data.
- **Notification Emails** -- Comma-separated email addresses to notify when files are processed (e.g., "team@company.com, admin@company.com"). Optional.

Click **Review** to save the configuration and advance to Step 4. This button is disabled until both BigQuery Dataset and BigQuery Table are filled.

Click **Back** to return to Step 2.

#### Step 4: Review

A read-only summary displays all settings: connection name, source type, SFTP username, file format, destination (dataset.table), load mode, and notification emails (if any).

[Figure 12 -- The SFTP Wizard Step 4 showing the complete configuration summary.]

Click **Done** to finish. A toast notification confirms **"Connection created"** and you are redirected to the Connections page.

Click **Back** to return to Step 3 for edits.

---

### 3.2.4 Viewing SFTP Credentials

After an SFTP connection is created, you can view its credentials at any time by clicking **Credentials** on the connection card. A modal overlay displays the Host, Port, Username, and Password with individual **Copy** buttons.

### 3.2.5 Deleting Connections

Click **Delete** on any connection card. A confirmation dialog appears:

- **Database connections:** *"Delete this connection?"* -- You cannot delete a database connection if any reports reference it. If reports depend on it, the error reads: *"Cannot delete: N report(s) use this connection."* Delete or reassign those reports first.
- **SFTP connections:** *"Delete this SFTP connection? This will remove the SFTP user and all configuration."* -- This action is irreversible.
- **Email connections:** *"Delete this email connection?"* -- You cannot delete an email connection if any schedules reference it. If schedules depend on it, the error reads: *"Cannot delete: N schedule(s) use this email connection. Update them first."* Update those schedules to use a different email connection first.

On successful deletion, a toast notification confirms the action (e.g., **"Connection deleted"**).

---

## 3.3 Reports

Reports are the core of Hermod. Each report combines a SQL query, a database connection, optional column configuration, spreadsheet formatting, and an optional delivery schedule. When a report runs (either manually or on schedule), Hermod executes the SQL query, applies your formatting, generates a polished `.xlsx` Excel file, and emails it to the configured recipients.

### Viewing Reports

Click **REPORTS** in the sidebar to see all your saved reports. Reports are displayed as a vertical list of cards, sorted by most recently updated first.

[Figure 13 -- The Reports list page showing several report cards with status badges.]

Each report card shows:

- **Report name** -- Click to open the report editor
- **Connection name** -- Which database connection the report uses
- **Last run status** -- A color-coded badge: **SUCCESS** (green), **FAILED** (red), or **RUNNING** (animated). Absent if the report has never been run.
- **Schedule status** -- **"Scheduled"** (green badge) if the report has an active schedule, **"Paused"** (neutral badge) if the schedule is disabled, or absent if no schedule exists.
- **Delete** button -- Deletes the report, its schedule, and all run history after confirmation.

If you have no reports, the page displays: *"No reports yet."* with a link to *"Create your first report."*

Click **New Report** in the page header to create a new report.

---

### 3.3.1 Creating and Editing Reports

Click **New Report** from the Reports page header or Dashboard quick action. The report editor opens with a blank workspace. When editing an existing report, click the report name in the list to open the editor pre-filled with saved data.

The report editor is a full-screen workspace with two main regions: the **editor area** (left, larger) and the **configuration sidebar** (right).

[Figure 14 -- The Report Editor showing the SQL editor, column config panel, spreadsheet preview, and config sidebar.]

#### The SQL Editor

The top portion of the editor area contains a Monaco code editor with SQL syntax highlighting. This is where you write and edit your SQL query.

**Toolbar above the editor:**
- **Connection dropdown** -- Select which database connection to run the query against. All your database connections appear in this list.
- **Run Query** button -- Executes the SQL query. Disabled when no connection is selected or a query is already running. Shows **"Running..."** while executing.
- **Keyboard shortcut:** Press **Ctrl+Enter** anywhere in the SQL editor to run the query (a shortcut hint is displayed in the toolbar).

After a successful query run, a summary line appears: **"N rows in Xms"** showing the total row count and execution time.

If the query fails, a red error banner appears below the SQL editor displaying the specific database error message. Common causes include SQL syntax errors, missing tables or columns, insufficient database permissions, connection timeouts (30 seconds), or query timeouts (2 minutes).

The SQL editor supports queries up to 100,000 characters. New reports start with `SELECT 1;` as a placeholder.

[Figure 15 -- The SQL editor after a successful query run showing the row count and execution time summary.]

#### Column Configuration

After your first query run, the **Column Config** panel appears between the SQL editor and the spreadsheet preview. This collapsible panel lets you control which columns appear in the output and how they are displayed.

[Figure 16 -- The Column Config panel showing a list of columns with drag handles, source mapping, display names, widths, and visibility toggles.]

Each column in your query results appears as a row in the column config with these controls:

| Control | Description |
|---------|-------------|
| **Drag handle** | Grab and drag to reorder columns |
| **Source** | Dropdown mapping to a query result column |
| **Display Name** | The column header shown in the spreadsheet and exported Excel file. Auto-generated from the SQL column name (e.g., `employee_id` becomes "Employee Id") |
| **Width** | The column width in Excel character units. Range: 2 to 100, step 0.5. Default: 8.43 |
| **Formula** | Optional Excel-style formula expression for computed columns |
| **Vis** | Visibility toggle -- "on" (visible) or "off" (hidden in export) |
| **x** | Remove the column from the configuration |

**Adding a formula column:** Click **+ Add Formula** at the bottom of the column list. Enter a column name and a formula expression (e.g., `=A2*B2`), then click **Add**. Formula columns appear in the configuration alongside query columns and are computed in the exported Excel file.

**Column reconciliation:** If you change your SQL query and re-run it, Hermod automatically reconciles the column configuration:
- Existing columns that still appear in the results keep their current settings (display names, widths, visibility, formatting).
- New columns not in the existing config are appended at the end with default settings.
- Columns in the config that no longer appear in the query results are flagged with warnings.
- A toast notification reads **"Column changes detected: N warning(s)"** with specific details about what changed.

#### Header Row Setting

Below the column config, a **Header Row** number input (range 1 to 20) controls where the header row appears in the spreadsheet. Setting this to a value greater than 1 creates "preamble rows" above the data headers -- useful for adding a report title or summary row in the exported Excel file.

#### Spreadsheet Preview

Below the column config and header row setting, an interactive spreadsheet preview displays your query results with Excel-style formatting capabilities. This is a WYSIWYG (what-you-see-is-what-you-get) editing surface -- the formatting you apply here is exactly what appears in the exported Excel file.

[Figure 17 -- The spreadsheet preview showing formatted query results with styled headers and data rows.]

You can:
- Apply cell formatting (fonts, font sizes, colors, bold, italic)
- Set background colors and borders
- Configure number formats (currency, percentages, dates)
- Adjust column widths by dragging column borders

The preview is capped at 20 rows. If your query returns more, a banner reads: *"Showing 20 of N rows -- full data used in export."* The full dataset is always used when generating the Excel file for delivery.

Formatting auto-saves internally every few seconds. When you drag column borders to resize columns in the preview, those widths are synchronized back to the column configuration before saving.

If no query has been run yet, the preview area displays: *"Run a query to see results."*

#### Configuration Sidebar

The right side of the report editor contains the configuration sidebar with report settings and the test send feature.

[Figure 18 -- The configuration sidebar showing the Name, Description, Connection, and Blueprint fields, plus Save buttons.]

**Report settings:**

- **Name** -- The report name. Required. Maximum 200 characters.
- **Description** -- An optional description of what the report shows. Maximum 2,000 characters.
- **Connection** -- Select the database connection for this report. Required. This is a duplicate of the toolbar dropdown for convenience -- changing either one updates both.
- **Forge Blueprint** -- Optionally attach a Mjolnir blueprint to apply transformation steps to query results before export. Options: "None (raw query output)" plus any of your blueprints with ACTIVE or VALIDATED status. This dropdown only appears if you have at least one blueprint. See section 3.6 for details on blueprints.

**Action buttons:**

- **Save Report** -- Saves the report with all current settings, column configuration, and formatting. Disabled when Name or Connection is empty. Shows **"Saving..."** during save. On success, a toast reads **"Report created"** (new) or **"Report saved"** (existing).
- **Save & Schedule** -- Available only for existing (already saved) reports. Saves the report and then navigates to the schedule editor for that report.
- **Unsaved changes** -- A yellow warning label appears below the buttons when you have unsaved changes.

For new reports, after the first save, the page URL updates to the new report's permanent address.

#### Test Send

The test send section appears in the configuration sidebar for saved reports. Use it to send a one-time test email with the current report output to verify that everything looks correct before setting up a schedule.

[Figure 19 -- The Test Send section showing the email connection dropdown, recipient input, and Send Test Email button.]

- **Email Connection** -- Select which of your SMTP email connections to use for sending. If you have only one email connection, it is auto-selected. If you have no email connections, a message reads *"No email connections."* with a link to add one.
- **Recipients** -- Enter one or more email addresses, separated by commas, semicolons, or spaces. Maximum 20 recipients. Press Enter to send.
- **Send Test Email** -- Sends the test email. Disabled when:
  - No recipients are entered
  - No email connection is selected
  - There are unsaved changes (helper text: *"Save changes before sending"*)

While sending, a progress message reads **"Sending test email..."** followed by a progress indicator. The loading overlay displays the message **"Dispatching the raven..."**

On success, a toast reads **"Sent to N recipient(s)."** Test emails have the subject line automatically prefixed with **[Test]** to distinguish them from scheduled deliveries.

---

### 3.3.2 Deleting Reports

Click the **Delete** button on a report card in the reports list. A confirmation dialog reads: *"Delete this report and its schedule?"* Confirming the deletion removes the report, its delivery schedule (if any), and all run history associated with it.

---

## 3.4 Schedules

Schedules automate your report delivery. Each report can have one schedule that defines when the report runs, who receives it, and what the email looks like.

### Viewing Schedules

Click **SCHEDULES** in the sidebar to see all your delivery schedules. Schedules are displayed in a table sorted by next run time (soonest first).

[Figure 20 -- The Schedules list page showing a table of schedules with frequency, next run, recipients, and toggle switches.]

| Column | Description |
|--------|-------------|
| **Report** | The report name |
| **Frequency** | Human-readable schedule description (e.g., "Every Mon, Wed, Fri at 8:00 AM", "Monthly on the 15th at 6:00 AM", "Daily at 9:30 AM") |
| **Next Run** | The date and time of the next scheduled run, or a dash if not set |
| **Recipients** | The number of recipients (e.g., "3 recipients") |
| **Enabled** | A toggle switch to instantly enable or disable the schedule |
| **Edit** | Opens the schedule editor for that report |

If you have no schedules, the page displays: *"No scheduled reports yet. Create a report and add a schedule to get started."*

### Enabling and Disabling Schedules

Click the **Enabled** toggle on any schedule row to instantly enable or disable it. When disabled, the system skips the schedule during its regular polling cycle. A toast confirms **"Schedule enabled"** or **"Schedule paused."**

A disabled schedule retains all its settings. The next run time remains stored but no deliveries occur until you re-enable it. In the Reports list, disabled schedules show a **"Paused"** badge instead of **"Scheduled."**

---

### 3.4.1 Creating a Schedule

Navigate to a saved report's editor, then click **Save & Schedule**. This saves the report and opens the schedule editor.

Alternatively, click **Edit** on a schedule row in the Schedules list to modify an existing schedule.

[Figure 21 -- The Schedule Editor showing all fields for a weekly schedule configuration.]

The schedule editor displays the heading **"Schedule Report"** (new) or **"Edit Schedule"** (existing) with the report name below it. An **Enabled/Disabled** toggle appears in the top-right corner.

#### Frequency

Select the delivery frequency from the **Frequency** dropdown:

| Frequency | Description |
|-----------|-------------|
| **Daily** | Runs every day at the specified time |
| **Weekly** | Runs on selected days every week |
| **Biweekly** | Runs on selected days every two weeks |
| **Monthly** | Runs on a specific day of the month |
| **Quarterly** | Runs on a specific day in selected months |

#### Day Selection

Depending on the frequency, different day selection controls appear:

**For Weekly and Biweekly:** Seven toggle buttons appear (Sun, Mon, Tue, Wed, Thu, Fri, Sat). Click each day to toggle it on or off. Selected days are highlighted in gold. At least one day must be selected. Default: Monday.

**For Monthly and Quarterly:** A **Day of Month** dropdown appears with options 1 through 31, plus **"Last day."** Selecting "Last day" ensures the report runs on the final day of the month, regardless of how many days that month has. For months with fewer days than the selected number (e.g., day 31 in February), the system automatically uses the last day of that month.

**For Quarterly only:** Twelve toggle buttons appear (Jan through Dec) for selecting which months the report runs. Default: January, April, July, October (standard quarters). [VERIFY: Confirm whether at least one month must be selected for quarterly schedules.]

#### Time

Three dropdowns set the delivery time:
- **Hour** -- 1 through 12 (12-hour format). Default: 8.
- **Minute** -- 00, 15, 30, or 45 (15-minute increments). Default: 00.
- **AM/PM** -- AM or PM. Default: AM.

#### Timezone

Select your timezone from the **Timezone** dropdown. It is organized into two groups:

- **Common** -- Seven frequently used US timezones: America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix, America/Anchorage, Pacific/Honolulu
- **All Timezones** -- Every IANA timezone supported by your browser

The timezone defaults to your browser's detected timezone (e.g., "America/New_York").

All schedule calculations are timezone-aware. The system accounts for daylight saving time transitions automatically.

#### Email Settings

- **Email Connection** -- Select which of your SMTP email connections to use for delivery. Required. If you have only one, it is auto-selected. If you have none, a message reads *"No email connections configured."* with a link to *"Add one"* pointing to the new connection page.
- **Recipients** -- Add email addresses for report delivery. Type an address and press **Enter** or type a comma to add it. Each address appears as a tag that you can remove by clicking the **x** on it. Pressing Backspace when the input is empty removes the last tag. At least one recipient is required.
  - **Add from previous** -- If you have recipients configured in other schedules, an **"Add from previous"** button appears. Clicking it opens a dropdown of previously used email addresses for quick selection.
- **Email Subject** -- The subject line for the delivery email. Required. Maximum 500 characters. Default: `{report_name} -- {date}`. The following template variables are supported:
  - `{report_name}` -- The report's name
  - `{date}` -- The current date
  - `{day_of_week}` -- The day of the week (e.g., "Monday")
  - `{row_count}` -- Number of rows in the report
  - `{run_time}` -- How long the report took to generate
  - `{connection_name}` -- The database connection name
- **Email Body (optional)** -- An optional custom message included in the delivery email. Maximum 5,000 characters.

#### Schedule Preview

Below all the form fields, a read-only preview sentence describes your schedule in plain language. This updates live as you change settings. Example:

> This report will send **every Monday at 8:00 AM America/New_York** to **user@example.com**

#### Saving

Click **Save Schedule** (full-width button) to save the schedule. The button is disabled while saving and shows **"Saving..."** On success, a toast reads **"Schedule created"** or **"Schedule updated"** and you are redirected to the Schedules list.

**Constraint:** A report can only have one schedule. If you try to create a second schedule for the same report, you will receive the error: *"Report already has a schedule. Update the existing one."*

#### How Scheduled Deliveries Work

After you save a schedule, the system automatically computes the next run time based on your frequency, day, time, and timezone settings. A background worker process checks for due schedules every 60 seconds. When a schedule's next run time arrives:

1. The system executes the report's SQL query against the configured database connection.
2. Column configuration is applied (reordering, renaming, visibility, formulas).
3. Spreadsheet formatting is applied (cell styles, fonts, colors, borders, number formats).
4. If a Forge Blueprint is attached, transformation steps are applied.
5. A polished `.xlsx` Excel file is generated.
6. The file is emailed to all configured recipients using the selected email connection.
7. The run is logged in the History section.
8. The next run time is recalculated.

---

## 3.5 Run History

Click **HISTORY** in the sidebar to view the execution log for all your reports. The page shows the 100 most recent report runs, sorted by most recent first.

[Figure 22 -- The Run History page showing the status filter and results table.]

### Filtering

A **Status** filter dropdown at the top of the page lets you narrow results:
- **All statuses** (default) -- Shows all runs
- **Success** -- Shows only successful runs
- **Failed** -- Shows only failed runs
- **Running** -- Shows only currently executing runs

There is no text search, date range filter, or pagination. The page is capped at 100 most recent runs.

### Results Table

| Column | Description |
|--------|-------------|
| **Report** | The report name |
| **Status** | A color-coded badge: **SUCCESS** (green), **FAILED** (red, clickable), or **RUNNING** (animated) |
| **Rows** | Number of rows returned, or a dash |
| **Started** | When the run started, displayed as a relative time (e.g., "5 min ago", "2 hours ago") or a full date for older runs |
| **Duration** | How long the run took (e.g., "312ms", "2.5s"), or a dash if still running |
| **Re-run** | Button to immediately re-execute and re-deliver the report |

### Viewing Error Details

When a run has the **FAILED** status, click the red FAILED badge to open a modal showing the full error message in a scrollable code block. This is the raw error from the database driver or the delivery process, which typically includes specific details about what went wrong.

[Figure 23 -- The error detail modal for a failed run showing the database error message.]

### Re-Running a Report

Click the **Re-run** button on any history row to immediately re-execute and re-deliver the report. The report must have an active schedule with at least one recipient configured. If not, you will see the error: *"Report has no schedule or recipients."*

On success, a toast reads **"Report re-sent"** and a new entry appears in the history.

### Time Display

Run times use relative timestamps:
- Less than 1 minute ago: "Just now"
- Less than 60 minutes: "N min ago"
- Less than 24 hours: "N hour(s) ago"
- Less than 7 days: "N day(s) ago"
- Older than 7 days: Full date (e.g., "2/15/2026")

Run duration is displayed as:
- Sub-second: Milliseconds (e.g., "342ms")
- Longer: Seconds with one decimal (e.g., "4.2s")

If you have no run history, the page displays: *"No run history yet."*

---

## 3.6 Mjolnir -- The Forge

Mjolnir is Hermod's AI-powered transformation tool. It lets you teach the system how to transform data by providing a "before" and "after" example: you upload an original Excel file and the desired output file, and the AI reverse-engineers the transformation into a reusable **blueprint**. Blueprints can then be attached to reports, so that query results are automatically transformed before export.

Click **MJOLNIR** in the sidebar to access the forge. The page has two sections: the **Forge Wizard** (top) for creating new blueprints, and the **Saved Blueprints** list (bottom) showing your existing blueprints.

[Figure 24 -- The Mjolnir page showing the Forge Wizard progress bar and the Saved Blueprints section below.]

### The Forge Wizard

The wizard guides you through 6 steps to create a blueprint. A progress bar at the top shows your current step, with rune icons for each stage. Completed steps are clickable for navigation.

A **Start Over** button is available at any step after Step 1 to reset the entire wizard.

---

#### Step 1: Upload Before File

Upload the original source Excel file -- the "before" state of your data.

[Figure 25 -- Mjolnir Step 1 showing the file upload zone for the BEFORE file.]

Drag and drop a `.xlsx` file onto the upload zone, or click to browse your files. Only `.xlsx` files are accepted. The upload area shows **"Drop .xlsx file here or click to browse."**

While uploading, a spinner with **"Uploading..."** appears. After a successful upload, a summary displays:
- Filename
- Number of columns
- Number of rows
- The first 8 column names as chips (with **"+N more"** if there are additional columns)

The wizard automatically advances to Step 2 after a successful upload.

If you upload a non-`.xlsx` file, the error reads: *"Only .xlsx files are supported."*

---

#### Step 2: Upload After File

A summary of the uploaded BEFORE file appears at the top. Now upload the "after" file -- the desired output after transformation.

[Figure 26 -- Mjolnir Step 2 showing the BEFORE file summary and the AFTER file upload zone.]

The upload behavior is identical to Step 1. After a successful upload, the wizard automatically advances to Step 3.

---

#### Step 3: Describe Transformation

Both uploaded files are summarized at the top. An optional text area lets you describe the transformation in plain language to help the AI resolve ambiguities.

[Figure 27 -- Mjolnir Step 3 showing file summaries and the optional description text area.]

- **Description textarea** -- Describe what changed between the BEFORE and AFTER files (e.g., "Remove inactive accounts, rename 'Acct_Num' to 'Account Number', sort by date descending"). Maximum 5,000 characters. Optional.

Two buttons:
- **Analyze** -- Sends both files and your description to the AI for analysis. A loading overlay appears: **"Forging..."** with the subtitle **"Analyzing transformation patterns."** On success, the wizard advances to Step 4 with the detected transformation steps.
- **Skip Description** -- Triggers the same analysis without a description.

---

#### Step 4: Review Detected Steps

The AI analysis results appear as a **diff summary** at the top and an editable **step list** below.

[Figure 28 -- Mjolnir Step 4 showing the structural diff summary, AI warnings, and the list of detected transformation steps.]

**Diff Summary:**
- Columns removed (in red)
- Columns added (in blue)
- Columns matched
- Whether column reordering was detected
- Sort detection (column and direction)
- Ambiguous cases (in red)

**AI Inference Warnings:** If the AI encountered issues during analysis, warnings appear in an orange panel under the heading **"AI Inference Warnings."**

**Step List:** Each detected transformation step is shown as a card with:
- **Step number** (auto-assigned)
- **Type badge** -- Color-coded label (e.g., "rename_columns", "calculate", "filter_rows")
- **Confidence badge** -- Percentage showing AI confidence (green at 80%+, gold at 50%+, red below 50%)
- **Description** -- Click to edit inline
- **Config** button -- Toggles a collapsible panel showing the step's configuration details
- **Remove** button -- Deletes the step

Steps can be reordered by drag-and-drop.

**Adding a step manually:** Click **+ Add Step** to open a dropdown of all available transformation types:
- Remove Columns, Rename Columns, Reorder Columns, Filter Rows, Format, Calculate, Sort, Deduplicate, Lookup, Pivot, Unpivot, Aggregate, Split Column, Merge Columns, Custom SQL

A manually added step starts with 100% confidence, an empty configuration, and the description "(manually added)."

Two buttons:
- **Test Run** -- Sends the steps and files to the server for validation testing. Disabled if no steps exist. On success, the wizard advances to Step 5 with the validation results.
- **Skip Validation** -- Advances directly to Step 6 (Save) without running validation.

---

#### Step 5: Validation Results

The validation report shows how well the blueprint's transformation steps reproduce the expected AFTER file.

[Figure 29 -- Mjolnir Step 5 showing the validation report with overall score, pattern checks, and column match rates.]

**Overall Score:** A large percentage with a **Passed** (green) or **Failed** (red) badge. The pass threshold is **95%**.

**Summary line:** Describes the validation mode:
- Pattern mode: *"Pattern validation -- X of Y checks passed across Z columns."*
- Strict mode: *"N of M cells matched across Z columns."*

**Pattern Checks** (pattern validation mode): A list of individual checks, each with a pass/warn/fail icon and a category label (Column Structure, Formula, Format, Renames, Row Count).

**Column Match Rates:** A bar chart showing per-column match percentages. Columns are sorted by match rate (worst first). Bars are gold for 95%+ and red for below 95%.

**Unsupported Steps Warning:** Lists any transformation steps that were skipped during validation because they are not yet supported by the execution engine.

**Mismatches Table** (strict mode only): Shows up to 50 individual cell mismatches with columns: Row, Column, Expected, Actual. If more exist, a note reads *"Showing 50 of N mismatches."*

Three buttons:
- **Save Blueprint** -- Advances to Step 6
- **Edit Steps** -- Returns to Step 4 to modify steps
- **Re-validate** -- Re-runs the validation with the current steps

---

#### Step 6: Save Blueprint

Enter a name for the blueprint and save it.

[Figure 30 -- Mjolnir Step 6 showing the blueprint name input and summary details.]

- **Blueprint Name** -- A descriptive name (e.g., "Monthly Account Cleanup"). Required. Maximum 200 characters.

A summary below shows: step count, BEFORE filename, AFTER filename, and validation match percentage (if validation was run).

Two buttons:
- **Forge Blueprint** -- Saves the blueprint. Disabled until a name is entered. On success, a toast reads **"Blueprint forged successfully."** The wizard resets and the blueprint appears in the Saved Blueprints list.
- **Back to Steps** -- Returns to Step 4.

---

### Saved Blueprints

Below the Forge Wizard, the **Saved Blueprints** section lists all your created blueprints as vertical cards.

[Figure 31 -- The Saved Blueprints list showing blueprint cards with status badges, versions, and file references.]

Each blueprint card displays:
- **Blueprint name**
- **Status badge:** DRAFT (gold), VALIDATED (green), ACTIVE (blue), or ARCHIVED (gray)
- **Version number** (e.g., "v1")
- **Description** (if provided, may be truncated)
- **Source files** -- BEFORE and AFTER filenames with an arrow between them
- **Last updated date**
- **Delete** button

Click **Delete** to remove a blueprint. A confirmation dialog reads: *"Delete this blueprint?"*

If you have no blueprints, the section displays: *"No blueprints forged yet. Upload BEFORE and AFTER files above to create your first blueprint."*

### Attaching a Blueprint to a Report

In the report editor, the **Forge Blueprint** dropdown in the configuration sidebar lets you attach any ACTIVE or VALIDATED blueprint to a report. When a blueprint is attached, the system applies its transformation steps to query results before generating the Excel export. Select "None (raw query output)" to use query results without any transformation.

[VERIFY: Confirm the trigger for promoting a blueprint from VALIDATED to ACTIVE status, and from ACTIVE to ARCHIVED. The current UI does not appear to expose controls for changing blueprint status manually.]

---

# 4. Access and Data Isolation

Hermod does not have user roles, admin privileges, or permission tiers. **Every authenticated user has the same capabilities.** There is no admin panel, no editor/viewer distinction, no team sharing, and no organization hierarchy.

All data is strictly isolated per user:

| Resource | Visibility |
|----------|------------|
| Reports | Only you can see and manage your reports |
| Database Connections | Only you can see and manage your connections |
| SFTP Connections | Only you can see and manage your SFTP integrations |
| Email Connections | Only you can see and manage your email connections |
| Schedules | Only you can see and manage your schedules |
| Run History | Only you can see your execution history |
| Blueprints | Only you can see and manage your blueprints |

You cannot see, access, or modify another user's data in any way. Each Google account maps to one independent Hermod workspace.

Database connection passwords are encrypted at rest and are never displayed back to you after initial entry.

[VERIFY: Confirm that no sharing or collaboration features are planned or available through hidden interfaces.]

---

# 5. Status and Workflow Reference

## 5.1 Report Run Statuses

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| **RUNNING** | Animated | The report is currently executing -- the query is running, the Excel file is being generated, or the email is being sent |
| **SUCCESS** | Green | The report executed successfully and the email was delivered |
| **FAILED** | Red | An error occurred during query execution, file generation, or email delivery |

**Progression:** Every run starts as RUNNING and ends as either SUCCESS or FAILED. You cannot manually change a run's status.

**Available actions by status:**
- RUNNING: No actions -- wait for completion
- SUCCESS: Click **Re-run** to re-execute and re-deliver
- FAILED: Click the badge to view the error details; click **Re-run** to retry

## 5.2 SFTP Connection Statuses

| Status | Label | Visual |
|--------|-------|--------|
| **ACTIVE** | Watching | Green badge with pulsing indicator dot |
| **ERROR** | Error | Red badge with static indicator dot |
| **DISABLED** | Disabled | Gray badge with gray indicator dot |

SFTP connection statuses are managed automatically by the system's file-watching process. [VERIFY: Confirm how transitions between ACTIVE, ERROR, and DISABLED are triggered. No manual toggle for SFTP status was found in the interface.]

## 5.3 Schedule Statuses

| Status | Meaning |
|--------|---------|
| **Enabled** | The schedule is active and will run at the next scheduled time |
| **Disabled** | The schedule is paused; no deliveries occur, but all settings are preserved |

Toggle between enabled and disabled from either:
- The **Enabled** toggle in the Schedules list table
- The toggle in the schedule editor header

## 5.4 Blueprint Statuses

| Status | Badge Color | Meaning |
|--------|-------------|---------|
| **DRAFT** | Gold | The blueprint has been saved but not yet validated |
| **VALIDATED** | Green | The blueprint passed validation testing (95%+ match rate) |
| **ACTIVE** | Blue | The blueprint is available for attachment to reports |
| **ARCHIVED** | Gray | The blueprint is retired and no longer available for new attachments |

Only **ACTIVE** and **VALIDATED** blueprints appear in the report editor's Forge Blueprint dropdown.

[VERIFY: Confirm the mechanisms for promoting blueprints from VALIDATED to ACTIVE and for archiving blueprints. The current interface does not appear to expose manual status controls.]

---

# 6. Tips and Best Practices

## Connections

- **Set up email connections early.** You need at least one SMTP email connection before you can send test emails or schedule deliveries. Configure this before building your first report.
- **Test connections after creation.** Always click **Test Connection** after entering credentials. This verifies connectivity before you rely on it for reports.
- **Use descriptive names.** Name connections clearly (e.g., "Production Postgres" or "QA SQL Server") so you can quickly identify them in dropdowns.

## Reports and SQL

- **Use Ctrl+Enter to run queries.** This keyboard shortcut is faster than clicking the Run Query button.
- **Start simple, then refine.** Write a basic `SELECT` query first, verify the results, then add complexity. This makes debugging easier.
- **Preview is 20 rows.** The spreadsheet preview shows only the first 20 rows, but the full dataset is used for exports. If you need to verify data beyond row 20, adjust your query with `LIMIT` or `TOP` for testing.
- **Save before test sending.** The Test Send button is disabled when you have unsaved changes. Save your report first, then send the test.
- **Use column config for clean output.** Rename SQL column names to friendly display names (e.g., `emp_id` becomes "Employee ID"). Hide columns that are needed for queries but not for the final report. Reorder columns to match your recipients' expectations.
- **Format the header row.** Bold headers, distinct background colors, and consistent fonts make reports look professional. The formatting you apply in the preview is exactly what recipients see.

## Schedules

- **One schedule per report.** Each report can only have one schedule. If you need the same query delivered on different cadences, create separate reports.
- **Use template variables in subjects.** Variables like `{report_name}`, `{date}`, and `{row_count}` make email subjects informative without manual updates.
- **The "Last day" option handles short months.** For monthly schedules, selecting "Last day" as the day of month ensures consistent delivery on the final day, whether February or December.
- **Check the schedule preview.** The preview sentence at the bottom of the schedule form summarizes your settings in plain English. Review it before saving to confirm the schedule is correct.
- **Reuse recipient addresses.** The "Add from previous" feature pulls email addresses from your other schedules, saving you from retyping them.

## Mjolnir

- **Provide good examples.** The quality of the AI analysis depends on how clearly the BEFORE and AFTER files demonstrate the transformation. Use files with enough rows to show patterns.
- **Describe ambiguous transformations.** If the transformation involves logic that is not obvious from the data alone (e.g., "remove rows where the Status column is 'Inactive'"), describe it in Step 3. This helps the AI produce more accurate steps.
- **Review and edit steps.** The AI's detected steps are a starting point. Review each step's confidence score and configuration. Edit descriptions, remove unnecessary steps, or add missing ones.
- **Validate before saving.** Running a test validation (Step 5) gives you confidence that the blueprint produces the expected output. A 95%+ match rate is required for the blueprint to pass.
- **Only .xlsx files are supported.** Convert CSV or other formats to `.xlsx` before uploading to Mjolnir.

## General

- **Bookmark report URLs.** Each report has a stable URL (e.g., `/reports/abc123`) that you can bookmark for quick access.
- **Dashboard for quick status.** The Dashboard shows your upcoming runs and recent execution history at a glance -- use it as your daily starting point.
- **Watch for toast notifications.** Success and error messages appear briefly in the bottom-right corner. They contain important feedback about whether your action succeeded.

---

# 7. Troubleshooting

| Problem | Solution |
|---------|----------|
| Cannot sign in | Make sure you are using the correct Google account. Microsoft sign-in is not yet available. |
| Session expired ("Unauthorized") | Your session has expired. Sign in again with Google. |
| "Connection not found" | The database or email connection referenced by this report or schedule no longer exists or was deleted. Re-select a valid connection. |
| Query fails with a database error | Check your SQL syntax, verify that referenced tables and columns exist, and confirm that your database user has sufficient permissions. The exact database error message is displayed. |
| Query times out | Queries that exceed 2 minutes are terminated. Optimize your SQL to run within the timeout, or request a larger timeout from your database administrator. |
| "Connection failed" on Test Connection | Verify the host, port, database name, username, and password. Confirm that the database server is reachable from the Hermod server and that firewall rules allow the connection. The connection timeout is 30 seconds. |
| Cannot delete a database connection | Reports depend on this connection. Error: *"Cannot delete: N report(s) use this connection."* Delete or reassign those reports first. |
| Cannot delete an email connection | Schedules depend on this connection. Error: *"Cannot delete: N schedule(s) use this email connection. Update them first."* Update those schedules to use a different email connection. |
| "Report already has a schedule" | Each report can only have one schedule. Edit the existing schedule instead of creating a new one. |
| "Report has no schedule or recipients" | When using Re-run from History, the report must have an active schedule with at least one recipient. Set up a schedule first. |
| Test Send button is disabled | You have unsaved changes. Save the report first, then send the test. Also verify that you have entered recipients and selected an email connection. |
| "Network error" | The request could not reach the Hermod server. Check your internet connection and try again. |
| "Uploaded files not found. Please re-upload." | In the Mjolnir Forge, uploaded files are stored temporarily and may expire. Re-upload both BEFORE and AFTER files and restart the analysis. |
| "Only .xlsx files are supported" | Mjolnir accepts only Excel files in `.xlsx` format. Convert your file before uploading. |
| "Column changes detected" | Your SQL query now returns different columns than when the report was last configured. Review the column configuration panel to verify that new columns are configured correctly and that warnings about missing columns are expected. |
| Spreadsheet preview shows only 20 rows | This is by design. The preview is capped at 20 rows for performance. The full dataset is used in the exported Excel file. |
| Formatting not appearing in export | Formatting auto-saves internally, but the report itself must be explicitly saved. Click **Save Report** before sending or scheduling. |
| SQL editor or spreadsheet loads slowly on first visit | The code editor and spreadsheet components are loaded dynamically. They may take a moment to appear on the first visit to the report editor. Subsequent visits are faster. |
| Changes not appearing after an action | List pages refresh automatically after create, update, and delete operations. Dashboard statistics refresh on page load -- navigate away and back to see updated numbers. |
| [VERIFY: Minimum supported browser versions] | The application uses modern browser features. Use a current version of Chrome, Firefox, Edge, or Safari for the best experience. |

---

# 8. Appendix: Field Reference

## 8.1 Database Connection Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Name | Yes | 1 to 100 characters |
| Type | Yes | PostgreSQL, SQL Server, MySQL, or BigQuery. Cannot be changed after creation. |
| Host | Yes (SQL types) | Non-empty |
| Port | Yes (SQL types) | Integer, 1 to 65,535. Defaults: PostgreSQL = 5432, SQL Server = 1433, MySQL = 3306 |
| Database | Yes (SQL types) | Non-empty |
| Username | Yes (SQL types) | Non-empty |
| Password | Yes on create (SQL types) | Non-empty on creation; leave blank when editing to keep existing password |
| Service Account JSON | Yes (BigQuery) | Must be a valid `.json` file containing a service account key with `project_id`, `private_key`, `client_email`, and authentication URLs |

## 8.2 Email Connection Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Name | Yes | 1 to 200 characters |
| Authentication | Yes | None (IP whitelist / relay), Username & Password, or OAuth2. Default: Username & Password |
| SMTP Host | Yes | 1 to 500 characters |
| Port | Yes | Integer, 1 to 65,535. Defaults: STARTTLS = 587, SSL/TLS = 465, None = 25 |
| Use TLS/SSL | No | Checkbox. Default: unchecked. Toggles the secure flag and auto-adjusts port |
| Username | Conditional | Required when Authentication is Username & Password or OAuth2. Max 500 characters |
| Password | Conditional | Required on creation when Authentication is Username & Password or OAuth2. Max 2,000 characters. Leave blank when editing to keep existing |
| From Address | Yes | 1 to 500 characters. Supports `Display Name <email>` format |

## 8.3 SFTP Connection Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Connection Name | Yes | 1 to 100 characters |
| Description | No | Max 500 characters |
| Source Type | Yes | ADP, QuickBooks, SAP, File Drop, or Custom SFTP |
| Expected File Format | Yes | CSV, TSV, or XLSX. Default: CSV |
| BigQuery Dataset | Yes | 1 to 100 characters |
| BigQuery Table | Yes | 1 to 100 characters |
| Load Mode | Yes | Replace (drop and reload) or Append (add rows). Default: Replace |
| Notification Emails | No | Comma-separated valid email addresses |

## 8.4 Report Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Name | Yes | 1 to 200 characters |
| Description | No | Max 2,000 characters |
| SQL Query | Yes | 1 to 100,000 characters |
| Connection | Yes | Must be a database connection you own |
| Forge Blueprint | No | Must be a blueprint you own with ACTIVE or VALIDATED status |
| Header Row | No | Integer, 1 to 20. Default: 1 |

**Column Configuration per Column:**

| Field | Validation Rules |
|-------|-----------------|
| Source | Must map to a query result column |
| Display Name | Text input (auto-generated from column name) |
| Width | Number, 2 to 100, step 0.5. Default: 8.43 |
| Formula | Optional Excel-style formula expression |
| Visibility | On or off. Default: on |

## 8.5 Schedule Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Enabled | No | Toggle. Default: enabled |
| Frequency | Yes | Daily, Weekly, Biweekly, Monthly, or Quarterly |
| Days of Week | Conditional | Required for Weekly and Biweekly. At least one day (0-6, Sun-Sat) |
| Day of Month | Conditional | Required for Monthly and Quarterly. 1-31, or "Last day" |
| Months | Conditional | Available for Quarterly. 1-12 (Jan-Dec) |
| Hour | Yes | 1 to 12. Default: 8 |
| Minute | Yes | 00, 15, 30, or 45. Default: 00 |
| AM/PM | Yes | AM or PM. Default: AM |
| Timezone | Yes | Valid IANA timezone. Default: browser-detected |
| Email Connection | Yes | Must be an email connection you own |
| Recipients | Yes | At least 1. Each must be a valid email address |
| Email Subject | Yes | 1 to 500 characters. Default: `{report_name} -- {date}` |
| Email Body | No | Max 5,000 characters |

**Constraint:** Each report can have only one schedule.

## 8.6 Test Send Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| Email Connection | Yes | Must be an email connection you own |
| Recipients | Yes | 1 to 20 email addresses, separated by commas, semicolons, or spaces |

**Constraint:** The report must be saved (no unsaved changes) before sending.

## 8.7 Mjolnir Blueprint Fields

| Field | Required | Validation Rules |
|-------|----------|-----------------|
| BEFORE file | Yes | Must be a `.xlsx` file |
| AFTER file | Yes | Must be a `.xlsx` file |
| Description | No | Max 5,000 characters |
| Blueprint Name | Yes | 1 to 200 characters |
| Steps | Yes | At least 1 step. Each step has: order (integer >= 0), type (one of 15 types), confidence (0 to 1), config (key-value settings), and description (non-empty) |

**Available step types:** Remove Columns, Rename Columns, Reorder Columns, Filter Rows, Format, Calculate, Sort, Deduplicate, Lookup, Pivot, Unpivot, Aggregate, Split Column, Merge Columns, Custom SQL.

## 8.8 System Limits

| Parameter | Value |
|-----------|-------|
| Database connection timeout | 30 seconds |
| Query execution timeout | 120 seconds (2 minutes) |
| SQL query maximum length | 100,000 characters |
| Spreadsheet preview row limit | 20 rows |
| Run history display limit | 100 most recent runs |
| Dashboard recent runs | 10 most recent |
| Dashboard upcoming schedules | 5 soonest within 24 hours |
| Test send max recipients | 20 |
| Schedule max email subject | 500 characters |
| Schedule max email body | 5,000 characters |
| Mjolnir validation pass threshold | 95% |
| Mjolnir mismatch display limit | 50 mismatches |
| Toast notification auto-dismiss | 4 seconds |

## 8.9 Default Port Reference

| Connection Type | Default Port |
|----------------|-------------|
| PostgreSQL | 5432 |
| SQL Server | 1433 |
| MySQL | 3306 |
| SMTP (STARTTLS) | 587 |
| SMTP (SSL/TLS) | 465 |
| SMTP (No auth / relay) | 25 |

## 8.10 Email Template Formats

Scheduled report emails are sent in two styles:

- **End-user template** -- A light parchment-style design showing the report name, date, filename, file size, and next scheduled delivery. If the schedule has a custom email body, it is included as a message block. Test sends use this template.
- **Admin template** -- A dark Norse-themed design with additional technical details including data source name, execution time, row count, and a SQL preview.

File sizes in emails are displayed in human-readable format:
- Under 1 KB: bytes (e.g., "512 B")
- Under 1 MB: kilobytes (e.g., "34.5 KB")
- 1 MB and above: megabytes (e.g., "2.1 MB")

## 8.11 Bookmarkable URLs

All page URLs are stable and can be bookmarked:

| URL Pattern | Page |
|-------------|------|
| `/dashboard` | Dashboard |
| `/reports` | Reports list |
| `/reports/new` | New report |
| `/reports/{id}` | Edit a specific report |
| `/reports/{id}/schedule` | Schedule editor for a specific report |
| `/connections` | Connections list |
| `/connections/new` | New connection type picker |
| `/connections?add=POSTGRES` | Open new PostgreSQL connection form [VERIFY: also works with `MSSQL`, `MYSQL`, `BIGQUERY`] |
| `/connections?addEmail=SMTP` | Open new email connection form |
| `/schedules` | Schedules list |
| `/history` | Run history |
| `/mjolnir` | Mjolnir Forge and saved blueprints |

## 8.12 Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| **Ctrl+Enter** | Report editor SQL panel | Run the current SQL query |
| **Enter** | Test Send recipient input | Send the test email |

---

# 9. Items Requiring Verification

The following items could not be fully determined from the application source and should be verified against a running instance:

| # | Section | What to Verify |
|---|---------|----------------|
| 1 | 2.1 Signing In | Whether the root URL (`/`) shows a blank page, a 404, or auto-redirects to `/login` or `/dashboard` |
| 2 | 2.1 Signing In | Whether there is a target date for enabling Microsoft authentication |
| 3 | 2.1 Signing In | Whether session duration is the default 30 days or a custom value |
| 4 | 2.2 Navigation | What the top bar displays when on the Mjolnir page (`/mjolnir`) |
| 5 | 3.4.1 Creating a Schedule | Whether at least one month must be selected for Quarterly schedules (the validation schema does not enforce a minimum for months) |
| 6 | 5.2 SFTP Connection Statuses | How transitions between ACTIVE, ERROR, and DISABLED are triggered for SFTP connections |
| 7 | 5.4 Blueprint Statuses | The trigger for promoting a blueprint from VALIDATED to ACTIVE status |
| 8 | 5.4 Blueprint Statuses | The trigger for archiving a blueprint (ACTIVE to ARCHIVED) |
| 9 | 5.4 Blueprint Statuses | Whether a DRAFT blueprint can be archived directly |
| 10 | 5.4 Blueprint Statuses | Whether there is a UI for manually changing blueprint status (promoting, archiving) |
| 11 | 4. Access and Data Isolation | Whether any sharing or collaboration features are planned or accessible through interfaces not yet surfaced in the UI |
| 12 | 7. Troubleshooting | Minimum supported browser versions (the application uses `Intl.supportedValuesOf` and `crypto.getRandomValues`) |
| 13 | 8.11 Bookmarkable URLs | Whether the `?add=` URL parameter works for all database types (MSSQL, MYSQL, BIGQUERY) |

---

*This guide was generated from application source analysis on February 25, 2026. For the most current information, consult the application directly or contact the development team.*
