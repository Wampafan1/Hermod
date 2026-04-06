# Hermod User Guide — Passes 8-10 Extract

Generated: Tue, Feb 25, 2026
Source directory: ./src

---

## Pass 8: Notifications & Feedback

### Notification System Overview

Hermod uses a toast notification system that appears in the bottom-right corner of the screen. Each notification auto-dismisses after 4 seconds or can be manually dismissed by clicking the X button.

There are three notification types:
- **Success** (green left border, rune icon): Confirms a successful action
- **Error** (red left border, rune icon): Reports a failure or validation problem
- **Info** (blue left border, rune icon): Informational messages

### Full-Screen Loading Overlays

Certain long-running operations display a full-screen loading overlay with a progress indicator and status message. These appear for:

| Action | Loading Message |
|--------|----------------|
| Running a query | "Forging the query results..." |
| Sending a test email | "Dispatching the raven..." |
| Analyzing files in Mjolnir | "Forging..." with subtitle "Analyzing transformation patterns." |

### Success Messages

| Trigger | Message |
|---------|---------|
| Create a new report | "Report created" |
| Save an existing report | "Report saved" |
| Test send email from report | "Sent to N recipient(s)" |
| Delete a report | "Report deleted" |
| Test database connection (pass) | "Connection successful!" |
| Create database connection | "Connection created" |
| Update database connection | "Connection updated" |
| Delete database connection | "Connection deleted" |
| Upload BigQuery credentials file | "Credentials file loaded" |
| Test email connection (pass) | "Connection successful!" |
| Create email connection | "Email connection created" |
| Update email connection | "Email connection updated" |
| Delete email connection | "Email connection deleted" |
| Create SFTP connection (wizard finish) | "Connection created" |
| Delete SFTP connection | "SFTP connection deleted" |
| Create schedule | "Schedule created" |
| Update schedule | "Schedule updated" |
| Enable a schedule via toggle | "Schedule enabled" |
| Pause a schedule via toggle | "Schedule paused" |
| Re-run a report from history | "Report re-sent" |
| Delete a Mjolnir blueprint | "Blueprint deleted" |
| Save a Mjolnir blueprint | "Blueprint forged successfully." |

### Error Messages

#### Validation Errors (shown in toast before any network request)

| Trigger | Message |
|---------|---------|
| Run query with no connection selected | "Select a connection first" |
| Save report without name or connection | "Name and connection are required" |
| Save schedule without email connection | "Select an email connection" |
| Save schedule without recipients | "Add at least one recipient" |
| SFTP wizard: proceed without name | "Connection name is required" |
| SFTP wizard: proceed without BigQuery dataset/table | "BigQuery dataset and table are required" |
| Upload a non-service-account JSON for BigQuery | "JSON must be a service account key file" |
| Upload an invalid JSON file for BigQuery | "Invalid JSON file" |
| Save Mjolnir blueprint without name | "Blueprint name is required." |
| Save Mjolnir blueprint without steps | "At least one step is required." |

#### Server/Network Errors (shown in toast after a failed request)

| Trigger | Message |
|---------|---------|
| Any request fails due to network | "Network error" |
| Test database connection fails | Server error message, or "Connection failed" |
| Test email connection fails | Server error message, or "Connection failed" |
| Save connection fails | Server error message, or "Save failed" |
| Save report fails | Server error message, or "Save failed" |
| Send test email fails | Server error message, or "Send failed" |
| Delete fails | Server error message, or "Delete failed" |
| Toggle schedule fails | "Toggle failed" |
| Re-run report fails | Server error message, or "Re-run failed" |
| Report not found on load | "Report not found" (then redirects to report list) |
| Failed to load connections on report page | "Failed to load connections" |
| Failed to load SFTP credentials | Server error message, or "Failed to load credentials" |
| Column schema changed between query runs | "Column changes detected: N warning(s)" |
| Mjolnir analysis fails | Server error message, or "Analysis failed." |
| Mjolnir validation fails | Server error message, or "Validation failed." |
| Mjolnir save fails | Server error message, or "Save failed." |
| Mjolnir network error during analysis | "Network error during analysis." |
| Mjolnir network error during validation | "Network error during validation." |
| Mjolnir network error during save | "Network error during save." |
| Mjolnir file upload fails | Server error message, or "Upload failed." |
| Mjolnir file upload network error | "Network error during upload." |

#### Server-Side API Error Messages

These are the specific error messages the server returns (displayed in toast notifications):

| Condition | Server Error Message |
|-----------|---------------------|
| Not logged in | "Unauthorized" |
| Unhandled server error | "Internal server error" |
| Connection not found or not owned | "Connection not found" |
| Report not found or not owned | "Report not found" |
| Schedule not found or not owned | "Schedule not found" |
| Email connection not found or not owned | "Email connection not found" |
| Blueprint not found or not owned | "Blueprint not found" |
| Delete connection that reports depend on | "Cannot delete: N report(s) use this connection" |
| Delete email connection that schedules depend on | "Cannot delete: N schedule(s) use this email connection. Update them first." |
| Create schedule for report that already has one | "Report already has a schedule. Update the existing one." |
| Re-run report with no schedule or recipients | "Report has no schedule or recipients" |
| Mjolnir: uploaded files expired | "Uploaded files not found. Please re-upload." |
| Mjolnir: upload non-.xlsx file | "Only .xlsx files are supported" |
| Mjolnir: upload with no file | "No file provided" |
| Email connection test: missing fields | "Host and from address are required" |
| Query execution database error | The database driver's error message is passed through |
| Any validation failure | "Validation failed" (with details object) |

### Confirmation Dialogs

These actions present a browser confirmation dialog before proceeding:

| Action | Confirmation Prompt |
|--------|-------------------|
| Delete a report | "Delete this report and its schedule?" |
| Delete a database connection | "Delete this connection?" |
| Delete an SFTP connection | "Delete this SFTP connection? This will remove the SFTP user and all configuration." |
| Delete an email connection | "Delete this email connection?" |
| Delete a Mjolnir blueprint | "Delete this blueprint?" |

### Loading / In-Progress States

| Component | Loading Indicator |
|-----------|-------------------|
| Report editor page load | Centered spinner (Norse style) |
| Run Query button pressed | Button text changes to "Running..." |
| Save Report button pressed | Button text changes to "Saving..." |
| Test Connection button pressed | Button text changes to "Testing..." |
| Save connection button pressed | Button text changes to "Saving..." |
| Test email connection pressed | Button text changes to "Testing..." |
| Save schedule button pressed | Button text changes to "Saving..." |
| SFTP wizard: Generate Credentials | Button text changes to "Creating..." |
| SFTP wizard: Test Connection | Button text changes to "Testing..." |
| Login: Sign in with Google | Button shows spinner and text "Summoning the Bifrost..." |
| Test Send email in progress | Text reads "Sending test email..." with progress bar |
| Mjolnir file upload in progress | Spinner with "Uploading..." text |
| Mjolnir analysis/validation in progress | Full panel: spinner + "Forging..." + "Analyzing transformation patterns." |

### Inline Warning/Status Indicators

| Context | Indicator |
|---------|-----------|
| Unsaved changes on report | Yellow text: "Unsaved changes" |
| Test Send button when changes exist | Button is disabled; helper text: "Save changes before sending" |
| Query execution error | Red error banner below the SQL editor showing the error message |
| No email connections configured (schedule form) | Text: "No email connections configured." with link to "Add one" |
| No email connections configured (report test send) | Text: "No email connections." with link to "Add one" |
| Preview row truncation | Banner: "Showing 20 of N rows -- full data used in export" |
| SFTP connection test passed | Green banner: "Connection test passed -- folders are accessible" |
| SFTP connection test failed | Red banner: "Test failed: [error details]" |
| Database/email test result displayed inline | Green or red banner in the form showing "Connection successful!" or the error message |

### Empty State Messages

| Page/Section | Empty State Message |
|-------------|---------------------|
| Reports list (no reports) | "No reports yet." with link "Create your first report" |
| Connections list (no connections) | "No connections yet." with link "Add your first connection" |
| Schedules list (no schedules) | "No scheduled reports yet." / "Create a report and add a schedule to get started." |
| History list (no runs) | "No run history yet." |
| Dashboard recent runs (no runs) | "No report runs yet. Create your first report to get started." |
| Blueprints list (no blueprints) | "No blueprints forged yet." / "Upload BEFORE and AFTER files above to create your first blueprint." |
| Report editor (no query results) | "Run a query to see results" |

---

## Pass 9: Calculated Fields & Auto-Generated Data

### Dashboard Statistics (Computed on Page Load)

The dashboard page displays three summary statistics that are computed from your data each time the page loads:

| Statistic | Source | Description |
|-----------|--------|-------------|
| Reports | Count of all your reports | Total number of reports you have created |
| Connections | Count of all your database connections | Total number of database connections configured |
| Runs (30d) | Count of recent run log entries | Number of report runs (up to 10 most recent) |

### Dashboard: Upcoming Schedules (Next 24 Hours)

The dashboard shows up to 5 enabled schedules whose next run time falls within the next 24 hours. Each entry shows the report name and a relative time description (e.g., "in 3 hrs").

### Dashboard: Recent Runs Table

Shows the 10 most recent report runs across all reports, displaying: report name, status (SUCCESS/FAILED/RUNNING), row count, and relative time.

### Schedule: Next Run Calculation

When you create or edit a schedule, the system automatically computes the next run time based on:
- **Frequency**: Daily, Weekly, Biweekly, Monthly, or Quarterly
- **Day selection**: Days of week (for Weekly/Biweekly) or day of month (for Monthly/Quarterly)
- **Month selection**: Specific months (for Quarterly only)
- **Time**: The scheduled hour and minute
- **Timezone**: All calculations are timezone-aware

The computed next run time is displayed in the Schedules list table under the "Next Run" column, formatted in your browser's local time.

For **Monthly** schedules: if the chosen day exceeds the number of days in a given month (e.g., day 31 in February), the system automatically uses the last day of that month.

For **Biweekly** schedules: after each run completes, the system advances by exactly 2 weeks from the last run time.

### Schedule: Preview Description

When editing a schedule, a preview sentence is automatically generated at the bottom of the form. Example:

> This report will send **Every Mon, Wed at 8:00 AM EST** to **user@example.com and 2 others**

This description updates live as you change frequency, day, time, timezone, and recipient settings.

### Schedule: Auto-Select Single Email Connection

If you have exactly one email connection configured, it is automatically selected when creating a new schedule or using the test send feature.

### Schedule: Auto-Detect Timezone

When creating a new schedule, the timezone field is automatically set to your browser's detected timezone (e.g., "America/New_York").

### Schedule: Previous Recipient Suggestions

When adding recipients to a schedule, the system loads all email addresses from your other existing schedules and makes them available for quick selection.

### Column Configuration: Auto-Generation

On the first query run for a new report, the system automatically generates a column configuration:
- Each SQL column gets a unique stable ID (used to track formatting even when columns are reordered)
- Column display names are auto-prettified from SQL column names: underscores and camelCase are converted to Title Case (e.g., `employee_id` becomes "Employee Id", `firstName` becomes "First Name")
- All columns default to visible
- Default column width is set to 8.43 (Excel's standard character width)

### Column Configuration: Reconciliation on Re-Run

When you re-run a query and the columns have changed since the last run:
- **Existing columns** that still appear in the query results are kept with their current settings
- **New columns** not in the existing config are appended at the end with default settings
- **Missing columns** (columns in the config that no longer appear in query results) are flagged with warnings
- Warning messages appear in a toast notification: "Column changes detected: N warning(s)"
- Individual warnings describe what changed, e.g., "Column 'Revenue' (source: revenue) is no longer in the query results" or "New column 'total_cost' added to config"

### Column Configuration: Width Sync

Before saving a report, the system synchronizes any column width changes you made by dragging column borders in the spreadsheet preview back into the column configuration. This ensures that the Excel export reflects the exact widths you see in the preview.

### Run History: Relative Time Display

Run times in the history list are displayed as relative timestamps that update as the page renders:
- Less than 1 minute ago: "Just now"
- Less than 60 minutes ago: "N min ago"
- Less than 24 hours ago: "N hour(s) ago"
- Less than 7 days ago: "N day(s) ago"
- Older than 7 days: Full date (e.g., "2/15/2026")

### Run History: Duration Calculation

Run duration is computed as the time between the start and completion timestamps:
- Sub-second runs: displayed in milliseconds (e.g., "342ms")
- Longer runs: displayed in seconds with one decimal (e.g., "4.2s")

### Report Editor: Row Count and Execution Time

After running a query, a summary line appears: "N rows in Xms" showing the total row count and query execution time in milliseconds.

### Report Editor: Preview Row Limit

The spreadsheet preview is capped at 20 rows. If the query returns more than 20 rows, a banner states: "Showing 20 of N rows -- full data used in export." The full dataset is used when generating the Excel file for email delivery.

### Report Editor: Header Row Offset

You can set the header row position (1-20). When set above row 1, rows above the header are treated as preamble rows. A label shows: "N preamble row(s) above data."

### Mjolnir: File Upload Summary

After uploading a file in the Mjolnir Forge, the system displays:
- Filename
- Number of columns
- Number of rows (formatted with locale separators)
- First 8 column names as chips (with "+N more" if there are additional columns)

### Mjolnir: Structural Diff Summary

After analysis, the system displays a summary of detected structural differences:
- Number of columns removed (in red)
- Number of columns added (in blue)
- Number of columns matched
- Whether column reordering was detected
- Sort detection (column name and direction)
- Number of ambiguous cases (in red)

### Mjolnir: AI Inference Warnings

If the AI engine encounters issues during analysis, warnings are displayed in an orange panel under the heading "AI Inference Warnings." These describe problems the AI had interpreting the transformation.

### Mjolnir: Validation Score

After running a test (validation), the system computes and displays:
- **Overall match rate**: Displayed as a large percentage (e.g., "87%")
- **Pass/Fail badge**: Passes at 95% or above
- **Pattern checks** (in pattern mode): Individual checks with pass/warn/fail status across categories like Column Structure, Formula, Format, Renames, and Row Count
- **Column match rates**: Per-column bar chart showing individual match percentages (gold for 95%+, red for below)
- **Mismatch table** (in strict mode): Shows up to 50 individual cell mismatches with row number, column name, expected value, and actual value
- If more than 50 mismatches exist: "Showing 50 of N mismatches."
- **Unsupported steps warning**: Lists any blueprint steps that were skipped during validation

### Mjolnir: Blueprint Status Badges

Each saved blueprint displays a status badge:
- **DRAFT**: Gold/amber styling
- **VALIDATED**: Green styling
- **ACTIVE**: Blue styling
- **ARCHIVED**: Dimmed/grey styling

### SFTP Connection: Generated Credentials

When creating an SFTP connection, the system auto-generates:
- An SFTP username (derived from the connection name, slugified)
- A random SFTP password
- Host and port from server configuration

These credentials are shown once during creation and can be viewed later via the "View Credentials" button.

### SFTP Connection: Activity Tracking

Each SFTP connection card displays auto-tracked statistics:
- Files processed count
- Last file received timestamp
- Last filename

### Report List: Status Badges

Each report in the list displays automatically computed badges:
- **Last run status**: SUCCESS (green), FAILED (red), or RUNNING (animated)
- **Schedule status**: "Scheduled" (green) if schedule is enabled, "Paused" (grey) if disabled

### Email Subject: Template Variables

When configuring a schedule, the email subject line supports these auto-replaced variables:
- `{report_name}` -- The report's name
- `{date}` -- The current date
- `{day_of_week}` -- The day of the week
- `{row_count}` -- Number of rows in the report
- `{run_time}` -- How long the report took to generate
- `{connection_name}` -- The database connection name

Default subject template: `{report_name} -- {date}`

### Test Send: Subject Prefix

When sending a test email, the subject line is automatically prefixed with `[Test]` to distinguish it from scheduled deliveries.

---

## Pass 10: Edge Cases & Troubleshooting

### Authentication

- **Sign-in method**: Google OAuth only (Microsoft sign-in is shown but marked "Coming Soon")
- **Session expiration**: If your session expires, any API request returns "Unauthorized" and you will need to sign in again
- **Data isolation**: All data (reports, connections, schedules, blueprints) is strictly isolated per user. You cannot see or access another user's data.

### Connection Limits and Timeouts

| Parameter | Value |
|-----------|-------|
| Database connection timeout | 30 seconds |
| Query execution timeout | 120 seconds (2 minutes) |
| SQL query maximum length | 100,000 characters |

If a database query exceeds 120 seconds, it will be terminated and you will see the database driver's timeout error message.

### Validation Rules Reference

#### Database Connection

| Field | Rules |
|-------|-------|
| Name | Required, 1-100 characters |
| Type | Must be PostgreSQL, SQL Server, MySQL, or BigQuery |
| Host | Required (for SQL databases) |
| Port | Integer, 1-65535 (defaults: PostgreSQL=5432, SQL Server=1433, MySQL=3306) |
| Database | Required (for SQL databases) |
| Username | Required (for SQL databases) |
| Password | Required on creation (for SQL databases); leave blank when editing to keep existing |
| BigQuery credentials | Must be a valid service account JSON key file (type must be "service_account") |

#### Email Connection

| Field | Rules |
|-------|-------|
| Name | Required, 1-200 characters |
| SMTP Host | Required, 1-500 characters |
| Port | Integer, 1-65535 (defaults: STARTTLS=587, SSL/TLS=465, None=25) |
| Auth Type | None (relay), Username & Password, or OAuth2 |
| Username | Required when auth type is Username & Password or OAuth2 |
| Password | Required when auth type is Username & Password or OAuth2; leave blank when editing to keep existing; max 2,000 characters |
| From Address | Required, 1-500 characters |

When switching auth type:
- Selecting "None" auto-sets port to 25 and disables TLS
- Selecting a credentialed auth type auto-sets port to 587
- Enabling TLS/SSL auto-adjusts port from 587 to 465 (and vice versa)

#### Report

| Field | Rules |
|-------|-------|
| Name | Required, 1-200 characters |
| Description | Optional, max 2,000 characters |
| SQL Query | Required, 1-100,000 characters |
| Connection | Required (must be a connection you own) |
| Blueprint | Optional (must be a blueprint you own with ACTIVE or VALIDATED status) |

#### Schedule

| Field | Rules |
|-------|-------|
| Report | Required (must be a report you own) |
| Frequency | Daily, Weekly, Biweekly, Monthly, or Quarterly |
| Days of Week | Required for Weekly and Biweekly (at least one day) |
| Day of Month | Required for Monthly and Quarterly (1-31, or "Last day") |
| Months | Selectable for Quarterly (1-12) |
| Time | Hour (1-12 AM/PM), minute (00, 15, 30, 45) |
| Timezone | Required |
| Email Connection | Required |
| Recipients | At least 1 required; each must be a valid email address |
| Email Subject | Required, 1-500 characters |
| Email Body | Optional, max 5,000 characters |

Additional constraints:
- A report can only have one schedule. Attempting to create a second schedule returns: "Report already has a schedule. Update the existing one."

#### Test Send

| Field | Rules |
|-------|-------|
| Recipients | 1-20 email addresses (comma, semicolon, or space separated) |
| Email Connection | Required |

Note: The Test Send button is disabled when there are unsaved changes to the report. You must save first.

#### SFTP Connection

| Field | Rules |
|-------|-------|
| Name | Required, 1-100 characters |
| Description | Optional, max 500 characters |
| Source Type | ADP, QuickBooks, SAP, Generic File, or Custom SFTP |
| File Format | CSV, TSV, or XLSX |
| BigQuery Dataset | Required, 1-100 characters |
| BigQuery Table | Required, 1-100 characters |
| Load Mode | Replace (drop and reload) or Append (add rows) |
| Notification Emails | Optional; comma-separated; each must be valid email |

#### Mjolnir Blueprint

| Field | Rules |
|-------|-------|
| Blueprint Name | Required, 1-200 characters |
| Description | Optional, max 2,000 characters (entered during the "Describe" step) |
| Steps | At least 1 step required |
| File Format | Only .xlsx files are supported for upload |

### Deletion Constraints

- **Database connections** cannot be deleted if any reports reference them. Error: "Cannot delete: N report(s) use this connection." You must delete or reassign the reports first.
- **Email connections** cannot be deleted if any schedules reference them. Error: "Cannot delete: N schedule(s) use this email connection. Update them first." You must update the schedules to use a different email connection first.
- **SFTP connections**: Deleting removes the SFTP user and all server-side configuration. This action is irreversible.
- **Reports**: Deleting a report also deletes its schedule and all run history.

### Common Error Scenarios and Resolutions

#### "Connection not found"
The database or email connection referenced by this report/schedule no longer exists, or you do not have access to it. Re-select a valid connection.

#### "Query failed" or database-specific errors
The SQL query could not execute against the target database. Common causes:
- Syntax errors in your SQL
- Referenced tables or columns do not exist
- Insufficient database permissions
- Database server is unreachable (connection timeout after 30 seconds)
- Query took longer than 2 minutes (execution timeout)

The exact error message from the database driver is displayed, which typically includes details about what went wrong.

#### "Network error"
The request could not reach the Hermod server. Check your internet connection and try again.

#### "Uploaded files not found. Please re-upload."
In the Mjolnir Forge, uploaded BEFORE/AFTER files are stored temporarily. If too much time passes between upload and analysis/validation, the files may be cleaned up. Re-upload the files and try again.

#### "Only .xlsx files are supported"
The Mjolnir Forge only accepts Excel files in .xlsx format. Convert your file to .xlsx before uploading.

#### "Column changes detected: N warning(s)"
After re-running a query, the result columns differ from the saved column configuration. Warnings indicate:
- A column that was in the config is no longer returned by the query
- A new column appeared in the query results and was appended to the configuration

Review the column configuration panel to verify the changes are expected.

#### "Report has no schedule or recipients"
When using the Re-run button in Run History, the report must have an active schedule with at least one recipient configured.

### Bookmarkable URLs

The following URL patterns can be bookmarked or shared:

| URL Pattern | Page |
|-------------|------|
| `/dashboard` | Dashboard home page |
| `/reports` | Report list |
| `/reports/new` | Create new report |
| `/reports/{id}` | Edit specific report |
| `/reports/{id}/schedule` | Schedule editor for a specific report |
| `/connections` | Connections list (database, SFTP, email) |
| `/connections/new` | Add new connection (source type picker) |
| `/connections?add=POSTGRES` | Opens connection form pre-set to PostgreSQL [VERIFY: also works with MSSQL, MYSQL, BIGQUERY] |
| `/connections?addEmail=SMTP` | Opens email connection form |
| `/schedules` | Schedule list |
| `/history` | Run history |
| `/mjolnir` | Mjolnir Forge (blueprint wizard + saved blueprints) |

### Navigation

The sidebar provides access to all main sections:
- Dashboard
- Reports
- Connections
- Mjolnir
- Schedules
- History

The currently active section is highlighted in the sidebar.

### Data Refresh Behavior

- **Report list, connection list, schedule list**: These pages load data on the server side. After create/update/delete operations, the page automatically refreshes to show current data.
- **Dashboard statistics**: Computed on each page load from the database. No auto-refresh; navigate away and back to update.
- **Run History**: Loaded on page load. Use the status filter dropdown to narrow results. The "Re-run" button triggers an immediate report execution.
- **Report editor**: Connection and report data are loaded once on page open. New query results require clicking "Run Query" (or pressing Ctrl+Enter). The spreadsheet template auto-saves every 5 seconds internally, but the report itself must be explicitly saved.
- **Mjolnir Forge**: The wizard state resets when you click "Start Over." Uploaded files are stored temporarily in the server's temp directory and will be cleaned up after a blueprint is saved.

### Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| Ctrl+Enter | Report editor (SQL panel) | Run the current SQL query |
| Enter | Test Send email input | Send the test email |

### Browser and Display Notes

- The application uses a dark theme exclusively. There is no light mode.
- All text uses the Cinzel (headings) and Inconsolata (body) fonts loaded from Google Fonts.
- The SQL editor (Monaco Editor) and spreadsheet component (Univer) are loaded dynamically and may take a moment to appear on first load.
- [VERIFY: minimum supported browser versions -- the app uses modern JavaScript features including `Intl.supportedValuesOf` and `crypto.getRandomValues`]

### SFTP Setup Instructions

The SFTP wizard provides system-specific setup instructions based on the selected source type:

- **ADP**: Instructions for configuring ADP Scheduled Exports with SFTP delivery
- **QuickBooks**: Instructions for QuickBooks Desktop/Online scheduled report SFTP export
- **SAP**: Instructions for SAP periodic export job with SFTP delivery
- **Generic File**: Instructions for using any SFTP client (FileZilla, WinSCP) to upload CSV/TSV/XLSX
- **Custom SFTP**: Generic instructions for connecting any system that supports SFTP file delivery

All file types upload to the `/inbound` folder on the SFTP server. Supported file formats: CSV, TSV, XLSX.

### Mjolnir Forge Step Types

The Mjolnir analysis engine can detect and create the following transformation step types:

| Step Type | Description |
|-----------|-------------|
| remove_columns | Remove specified columns from the output |
| rename_columns | Rename columns (mapping of old names to new names) |
| reorder_columns | Change the order of columns |
| filter_rows | Filter rows based on conditions |
| format | Apply formatting to a column (date format, number padding, etc.) |
| calculate | Add a computed column using a formula expression |
| sort | Sort rows by a column (ascending or descending) |
| deduplicate | Remove duplicate rows |
| aggregate | Aggregate/group data |
| split_column | Split one column into multiple |
| merge_columns | Merge multiple columns into one |
| lookup | Cross-reference data from another source |
| pivot | Pivot rows to columns |
| unpivot | Unpivot columns to rows |
| custom_sql | Custom SQL transformation |

Unsupported steps are noted in the validation report and skipped during test runs.

### Mjolnir Validation Modes

- **Pattern mode** (default): Checks column structure, formulas, renames, and formats at a structural level. Score = 50% structure + 50% individual checks. Pass threshold: 95%.
- **Strict mode**: Performs cell-by-cell comparison using key-based row matching (finds a column with 95%+ uniqueness and 50%+ overlap between datasets). Falls back to positional matching if no key column is found. Pass threshold: 95%.

### Email Template Formats

Scheduled report emails are sent in two formats:
- **End-user template**: Light parchment-style design with report name, date, filename, file size, and next scheduled delivery. Supports an optional custom message block when the schedule's email body is provided.
- **Admin template**: Dark Norse-themed design with additional technical details (data source, execution time, row count, SQL preview).

Test sends use the end-user template.

### File Size Display

Email attachments display file sizes in human-readable format:
- Under 1 KB: displayed in bytes (e.g., "512 B")
- Under 1 MB: displayed in kilobytes (e.g., "34.5 KB")
- 1 MB and above: displayed in megabytes (e.g., "2.1 MB")

### Port Auto-Suggestions

| Connection Type | Default Port |
|----------------|-------------|
| PostgreSQL | 5432 |
| SQL Server | 1433 |
| MySQL | 3306 |
| SMTP (STARTTLS) | 587 |
| SMTP (SSL/TLS) | 465 |
| SMTP (No auth/relay) | 25 |
| SFTP | 2222 (configurable via server environment) |
