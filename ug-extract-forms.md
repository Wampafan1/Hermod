## Pass 4: Forms & Data Entry

All forms in Hermod use custom `useState` + `onChange` patterns (no `<form>` elements, no form libraries). Validation is enforced server-side via Zod schemas; client-side enforcement is done via disabled buttons and inline error messages.

---

### Form 1: Login Page

**Location:** `src/app/login/page.tsx`

**Purpose:** Authenticate users before they can access the application.

**Fields:** None. This is a button-based authentication screen, not a traditional form.

| Element | Type | Details |
|---------|------|---------|
| Sign in with Google | Button | Initiates Google OAuth sign-in. While signing in, the button text changes to "Summoning the Bifrost..." and a spinner appears. |
| Microsoft -- Soon | Button (disabled) | Placeholder for future Microsoft authentication. Currently disabled with tooltip "Coming soon." |

**Post-submission behavior:** On successful Google sign-in, redirects to `/dashboard`.

---

### Form 2: Database Connection Form (Add / Edit)

**Location:** `src/components/connections/connection-form.tsx`

**Purpose:** Create or edit a database connection. Opens as a modal dialog over the Connections page.

**Heading:** "Add Connection" (new) or "Edit Connection" (editing existing)

#### Fields

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Name | Text input | Yes | Min 1 character, max 100 characters | Empty | "Production Database" | |
| Type | Dropdown | Yes | Must be one of the listed options | PostgreSQL | N/A | **Options:** PostgreSQL, SQL Server, MySQL, BigQuery. Disabled when editing (cannot change type after creation). |

**Conditional fields -- shown when Type is PostgreSQL, SQL Server, or MySQL:**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Host | Text input | Yes | Min 1 character | Empty | "localhost" | |
| Port | Number input | Yes | Integer between 1 and 65535 | Auto-set based on type: PostgreSQL=5432, SQL Server=1433, MySQL=3306 | N/A | Changing the Type dropdown auto-updates the port to the standard default for that database type. |
| Database | Text input | Yes | Min 1 character | Empty | "my_database" | |
| Username | Text input | Yes | Min 1 character | Empty | "postgres" | |
| Password | Password input | Yes (new) / Optional (edit) | Min 1 character on create | Empty | Shown as dots | When editing, the label changes to "Password (blank = keep)" -- leaving it blank keeps the existing password. |

**Conditional fields -- shown when Type is BigQuery:**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Service Account JSON | File upload (click-to-browse) | Yes | Must be a `.json` file. The JSON must contain `"type": "service_account"`, plus fields: `project_id`, `private_key_id`, `private_key`, `client_email`, `client_id`, `auth_uri` (valid URL), `token_uri` (valid URL). | N/A | "Click to upload service account JSON file" | Appears as a dashed-border drop area. After successful upload, shows the filename. Only one file accepted. Accepted file types: `.json`. |

**Auto-populated fields:** None visible to user. User ID is attached server-side from the session.

#### Buttons

| Button | Behavior |
|--------|----------|
| Test Connection | Sends the current field values to the server to verify connectivity. Shows "Testing..." while in progress. Displays a green success banner ("Connection successful!") or a red error banner with the specific error message. |
| Cancel | Closes the modal without saving. |
| Save | Creates or updates the connection. Disabled while saving (shows "Saving..."). On success: shows toast "Connection created" or "Connection updated", closes the modal, and refreshes the connection list. On failure: shows toast with error message. |

---

### Form 3: Email Connection Form (Add / Edit)

**Location:** `src/components/connections/email-connection-form.tsx`

**Purpose:** Create or edit an SMTP email connection used for sending report deliveries.

**Heading:** "Add Email Connection" (new) or "Edit Email Connection" (editing existing)

#### Fields

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Name | Text input | Yes | Min 1 character, max 200 characters | Empty | "Workspace Relay" | Save button is disabled until Name, SMTP Host, and From Address are all filled. |
| Authentication | Dropdown | Yes | Must be one of the listed options | Username & Password | N/A | **Options:** "None (IP whitelist / relay)", "Username & Password", "OAuth2". Changing this resets the test result and auto-adjusts the Port: None sets port to 25 and unchecks TLS; the others set port to 587. |
| SMTP Host | Text input | Yes | Min 1 character, max 500 characters | Empty | "smtp.gmail.com" | |
| Port | Number input | Yes | Integer between 1 and 65535 | 587 (or 25 if Auth is "None") | N/A | Auto-adjusts when toggling TLS/SSL: enabling TLS switches 587 to 465; disabling TLS switches 465 to 587. |
| Use TLS/SSL (port 465) | Checkbox | No | N/A | Unchecked (false) | N/A | Toggles the `secure` flag. Also auto-adjusts Port as described above. |

**Conditional fields -- shown when Authentication is "Username & Password" or "OAuth2":**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Username | Text input | Yes (when visible) | Max 500 characters. Server-side: required when authType is PLAIN or OAUTH2 | Empty | "user@domain.com" | |
| Password | Password input | Yes (new, when visible) / Optional (edit) | Max 2000 characters. Server-side: required when authType is PLAIN or OAUTH2 | Empty | Shown as dots | When editing, label shows "Password (blank = keep)". |

**Always visible (continued):**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| From Address | Text input | Yes | Min 1 character, max 500 characters | Empty | "Hermod <reports@yourdomain.com>" | The sender address that appears on delivered emails. Can include a display name in the format `Name <email>`. |

#### Buttons

| Button | Behavior |
|--------|----------|
| Test Connection | Tests the SMTP connection with current settings. Disabled when SMTP Host is empty. Shows "Testing..." while in progress. Displays a green success or red error banner. |
| Cancel | Closes the modal without saving. |
| Save | Creates or updates the email connection. Disabled when Name, SMTP Host, or From Address are empty, or while saving. Shows "Saving..." during save. On success: shows toast "Email connection created" or "Email connection updated", closes modal, refreshes list. |

---

### Form 4: SFTP Connection Wizard (Multi-Step)

**Location:** `src/components/connections/sftp-wizard.tsx`

**Purpose:** Create an SFTP file-delivery connection for receiving files from external systems (ADP, QuickBooks, SAP, generic file drop, or custom SFTP). This is a 4-step wizard.

**Accessed from:** The "New Connection" page (`src/app/(app)/connections/new/page.tsx`) after selecting an SFTP-type source from the Source Picker.

**Available source types:** ADP, QuickBooks, SAP, File Drop, Custom SFTP

#### Step 1: Name It

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Connection Name | Text input | Yes | Min 1 character, max 100 characters | Empty | "e.g., Acme Corp Payroll" | Auto-focused on load. |
| Description (optional) | Text input | No | Max 500 characters | Empty | "e.g., Weekly payroll export from ADP" | |

**Buttons:**
- **Back** -- returns to the source picker
- **Generate Credentials** -- disabled until Connection Name is filled. Creates the SFTP connection on the server and generates credentials. Shows "Creating..." while in progress. On success, advances to Step 2.

#### Step 2: Credentials

This step displays the auto-generated SFTP credentials (Host, Port, Username, Password) in a read-only credential card with "Copy" and "Copy All" buttons. No user input is required.

The step also shows source-specific setup instructions (e.g., how to configure ADP, QuickBooks, or SAP to deliver files via SFTP).

**Buttons:**
- **Test Connection** -- tests whether the SFTP server is reachable. Shows "Testing..." while running. Displays success or error banner.
- **Download Setup Guide (PDF)** -- currently disabled (grayed out).
- **Back** -- returns to Step 1.
- **Configure Processing** -- advances to Step 3.

#### Step 3: Configure Processing

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Expected File Format | Dropdown | Yes | Must be one of the listed options | CSV | N/A | **Options:** ".csv (Comma Separated)", ".tsv (Tab Separated)", ".xlsx (Excel)" |
| BigQuery Dataset | Text input | Yes | Min 1 character, max 100 characters | Empty | "e.g., payroll_data" | The destination BigQuery dataset name. |
| BigQuery Table | Text input | Yes | Min 1 character, max 100 characters | Empty | "e.g., adp_export" | The destination BigQuery table name. |
| Load Mode | Dropdown | Yes | Must be one of the listed options | Replace | N/A | **Options:** "Replace (drop and reload)", "Append (add rows)" |
| Notification Emails | Text input | No | Comma-separated email addresses; each must be a valid email | Empty | "e.g., team@company.com, admin@company.com" | Help text: "Comma-separated. Notified when files are processed." |

A static info box is displayed above the fields reading: **Destination: Load to BigQuery**.

**Buttons:**
- **Back** -- returns to Step 2.
- **Review** -- disabled until BigQuery Dataset and BigQuery Table are both filled. Saves the processing configuration to the server and advances to Step 4.

#### Step 4: Review

Displays a read-only summary of all settings: Connection name, Source type, SFTP User, File Format, Destination (dataset.table), Load Mode, and Notification Emails (if any).

**Buttons:**
- **Back** -- returns to Step 3.
- **Done** -- shows toast "Connection created" and redirects to `/connections`.

---

### Form 5: Source Picker (Connection Type Selection)

**Location:** `src/components/connections/source-picker.tsx`

**Purpose:** Choose which type of connection to create. Not a traditional form -- it is a selection grid that routes you to the appropriate form.

**Accessed from:** `/connections/new`

**Categories and options:**

| Category | Options (clickable cards) |
|----------|--------------------------|
| Database Connections | PostgreSQL, SQL Server, MySQL, BigQuery |
| File Integrations | ADP, QuickBooks, SAP, File Drop, Custom SFTP |
| Email Delivery | SMTP Email |

**Behavior on selection:**
- Database type: Redirects to `/connections?add=TYPE` which opens the Database Connection Form (Form 2) as a modal.
- SMTP Email: Redirects to `/connections?addEmail=SMTP` which opens the Email Connection Form (Form 3) as a modal.
- SFTP types: Renders the SFTP Wizard (Form 4) inline on the same page.

---

### Form 6: Report Editor

**Location:** `src/components/reports/report-editor.tsx` (main editor) + `src/components/reports/report-config.tsx` (config sidebar)

**Purpose:** Create or edit a report. This is the primary work surface combining a SQL editor, spreadsheet preview, column configuration, and a config sidebar.

**Accessed from:** `/reports/new` (new report) or `/reports/[id]` (edit existing report).

#### Toolbar (above SQL editor)

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Connection | Dropdown | Yes (for Run and Save) | Must select a connection | Empty ("Select connection...") | "Select connection..." | **Options:** Loaded from API -- lists all database connections the user has created. Displays connection name. |
| Run Query | Button | N/A | N/A | N/A | N/A | Executes the SQL query against the selected connection. Disabled if no connection is selected or a query is running. Keyboard shortcut: CTRL+ENTER. Shows "Running..." while executing. After execution, displays row count and execution time. |

#### SQL Editor Panel

| Element | Type | Notes |
|---------|------|-------|
| SQL Query | Code editor (Monaco) | Full SQL editor with syntax highlighting. Validation: min 1 character, max 100,000 characters. Default value for new reports: `SELECT 1;`. Supports CTRL+ENTER to run query. |

#### Column Config Panel (appears after first query run)

**Location:** `src/components/reports/column-config-panel.tsx`

This panel appears between the SQL editor and the spreadsheet once a query has been executed and column configuration exists. It is collapsible.

**Table of columns (one row per column):**

| Column | Type | Notes |
|--------|------|-------|
| Drag handle | Drag target | Reorder columns by dragging. |
| Source | Dropdown | Maps to a query result column. **Options:** All columns returned by the query, plus a "-- select --" placeholder (or "-- (formula)" for formula columns). |
| Display Name | Text input | The column header shown in the spreadsheet and exported Excel file. |
| Width | Number input | Excel character-width units. Min: 2, max: 100, step: 0.5. Default: 8.43. |
| Formula | Text input | Optional. An Excel-style formula expression (e.g., `=A2*B2`). Placeholder shown only for formula columns. |
| Vis (Visibility) | Toggle button | Shows "on" (visible) or "off" (hidden). Controls whether the column appears in the export. |
| x (Remove) | Button | Removes the column from the configuration. |

**Actions:**
- **+ Add Formula** -- opens an inline row to define a new formula column:
  - **Column name** (text input, placeholder: "Column name")
  - **Formula expression** (text input, placeholder: "=A2*B2")
  - **Add** button -- adds the formula column to the config
  - **x** button -- cancels adding

**Warnings:** If query columns change between runs (columns added or removed), warning messages appear in a yellow banner above the column list.

#### Header Row Setting (appears after query results load)

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Header Row | Number input | No | Integer between 1 and 20 | 1 | N/A | Controls where the header row appears in the spreadsheet. Values greater than 1 create "preamble rows" above the data. Displayed as 1-indexed to the user (internally stored as 0-indexed). |

#### Spreadsheet Preview

The Univer spreadsheet component displays query results with Excel-style formatting capabilities. Users can:
- Apply cell formatting (fonts, colors, borders, number formats) directly in the spreadsheet
- All formatting is auto-saved and persisted with the report
- Preview is capped to 20 rows; full data is used in exports

#### Config Sidebar (right side)

**Location:** `src/components/reports/report-config.tsx`

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Name | Text input | Yes | Min 1 character, max 200 characters | Empty | "Monthly Sales Report" | |
| Description | Textarea | No | Max 2000 characters | Empty | "What does this report show?" | 3 rows tall. |
| Connection | Dropdown | Yes | Must select a value | Empty ("Select a connection...") | "Select a connection..." | **Options:** All database connections. Shows "name (type)" format. This is a duplicate of the toolbar dropdown for convenience. |
| Forge Blueprint | Dropdown | No | Optional | "None (raw query output)" | N/A | **Options:** "None (raw query output)" plus all blueprints with status ACTIVE or VALIDATED. Only shown if at least one blueprint exists. Help text: "Applies transformation steps to query results before export." |

**Buttons:**
- **Save Report** -- disabled when Name or Connection are empty, or while saving. Shows "Saving...". On success: toast "Report created" (new) or "Report saved" (edit). For new reports, redirects to `/reports/[new-id]`.
- **Save & Schedule** -- only shown for existing (already saved) reports. Saves the report and then redirects to `/reports/[id]/schedule`.

**Unsaved changes indicator:** When changes are detected, a warning label "Unsaved changes" appears below the buttons.

#### Test Send Sub-form (within Config Sidebar, existing reports only)

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Email Connection | Dropdown | Yes | Must select a value | Auto-selects if only one email connection exists | "Select email connection..." | **Options:** All email connections. Only shown if email connections exist. If none exist, shows a message with a link to add one. |
| Recipients | Text input | Yes | Comma, semicolon, or whitespace-separated email addresses. Max 20 recipients. Each must be a valid email. | Empty | "email@example.com" | Supports pressing Enter to send. |

**Buttons:**
- **Send Test Email** -- disabled when: no recipients entered, unsaved changes exist, or no email connection is selected. Shows a progress animation while sending. On success: toast "Sent to N recipient(s)". If unsaved changes exist, help text reads "Save changes before sending."

---

### Form 7: Schedule Form

**Location:** `src/components/schedule/schedule-form.tsx`

**Purpose:** Create or edit a delivery schedule for a report. Configures when and to whom the report is sent via email.

**Heading:** "Schedule Report" (new) or "Edit Schedule" (editing existing). Displays the report name below the heading.

#### Fields

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Enabled/Disabled toggle | Toggle switch | No | N/A | Enabled (on) | N/A | Appears in the top-right corner of the heading area. When disabled, the schedule will not run. |
| Frequency | Dropdown | Yes | Must be one of the listed options | Weekly | N/A | **Options:** Daily, Weekly, Biweekly, Monthly, Quarterly |

**Conditional fields -- shown when Frequency is "Weekly" or "Biweekly":**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Days | Multi-select day buttons | Yes (at least one) | At least one day must be selected | Monday (day 1) selected | N/A | Seven buttons: Sun, Mon, Tue, Wed, Thu, Fri, Sat. Click to toggle each day on/off. Selected days are highlighted in gold. |

**Conditional fields -- shown when Frequency is "Monthly" or "Quarterly":**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Day of Month | Dropdown | Yes | Integer 1-31, or 0 for "Last day" | 1 | N/A | **Options:** 1 through 31, plus "Last day" (value 0). |

**Conditional fields -- shown when Frequency is "Quarterly":**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Months | Multi-select month buttons | No [VERIFY: validation schema does not enforce minimum for monthsOfYear but UI defaults suggest intent] | N/A | January, April, July, October selected | N/A | Twelve buttons: Jan through Dec. Click to toggle each month. Selected months are highlighted in gold. |

**Always visible (continued):**

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Time (Hour) | Dropdown | Yes | 1-12 | 8 | N/A | **Options:** 1 through 12 (12-hour format). |
| Time (Minute) | Dropdown | Yes | 0-59 (displayed as 00, 15, 30, 45) | 00 | N/A | **Options:** 00, 15, 30, 45 (15-minute increments only). |
| Time (AM/PM) | Dropdown | Yes | AM or PM | AM | N/A | **Options:** AM, PM |
| Timezone | Dropdown | Yes | Must be a valid IANA timezone string | Auto-detected from user's browser | N/A | **Options:** Two groups -- "Common" (America/New_York, America/Chicago, America/Denver, America/Los_Angeles, America/Phoenix, America/Anchorage, Pacific/Honolulu) and "All Timezones" (all IANA timezones supported by the browser). |
| Email Connection | Dropdown | Yes | Must select a value | Auto-selects if only one email connection exists | "Select email connection..." | **Options:** All email connections. If none exist, shows text: "No email connections configured." with a link "Add one" pointing to `/connections/new`. |
| Recipients | Tag-style email input | Yes (at least 1) | Each entry must be a valid email address. Validated per-entry on add. | Empty | "Enter email addresses..." | Emails are added by pressing Enter or comma. Backspace removes the last tag when the input is empty. Clicking the x on a tag removes it. An "Add from previous" button appears if email addresses from other schedules exist -- opens a dropdown of previously-used addresses to quick-add. |
| Email Subject | Text input | Yes | Min 1 character, max 500 characters | `{report_name} -- {date}` | `{report_name} -- {date}` | Help text below: "Variables: {report_name}, {date}, {day_of_week}, {row_count}, {run_time}, {connection_name}" |
| Email Body (optional) | Textarea | No | Max 5000 characters | Empty | "Please find the attached report." | 4 rows tall. |

**Auto-populated fields:**
- Timezone defaults to the user's browser timezone.
- Email Connection auto-selects if only one exists.
- Previous email addresses from other schedules are loaded for the "Add from previous" quick-add feature.

**Schedule Preview:** Below the fields, a read-only preview box describes the schedule in plain English, e.g.: "This report will send **every Monday at 8:00 AM America/New_York** to **user@example.com**"

#### Buttons

| Button | Behavior |
|--------|----------|
| Save Schedule | Full-width button. Disabled while saving (shows "Saving..."). Client-side checks: requires an email connection to be selected and at least one recipient. On success: toast "Schedule created" or "Schedule updated", redirects to `/schedules`. On failure: shows toast with error message. |

---

### Form 8: Mjolnir Forge Wizard (Multi-Step)

**Location:** `src/components/mjolnir/mjolnir-forge.tsx`

**Purpose:** Upload a BEFORE and AFTER Excel file, let AI analyze the transformation, review and edit detected steps, validate the transformation, and save it as a reusable blueprint.

**Accessed from:** `/mjolnir`

This is a 6-step wizard with a progress bar at the top. Steps are navigable by clicking completed step indicators.

#### Step 1: Upload Before File

| Element | Type | Required | Validation | Default | Placeholder | Notes |
|---------|------|----------|------------|---------|-------------|-------|
| BEFORE file upload | File upload zone (drag-and-drop or click-to-browse) | Yes | Must be a `.xlsx` file only | N/A | "Drop .xlsx file here or click to browse" | Accepts exactly one file. Shows "Uploading..." spinner during upload. On success, displays the filename, column count, row count, and first 8 column names. File is uploaded to the server and a `fileId` is returned. On error: displays error message (e.g., "Only .xlsx files are supported." or "Upload failed."). |

**Auto-advance:** After successful upload, automatically advances to Step 2.

#### Step 2: Upload After File

Shows a summary of the uploaded BEFORE file (filename, column count, row count).

| Element | Type | Required | Validation | Default | Placeholder | Notes |
|---------|------|----------|------------|---------|-------------|-------|
| AFTER file upload | File upload zone (drag-and-drop or click-to-browse) | Yes | Must be a `.xlsx` file only | N/A | "Drop .xlsx file here or click to browse" | Same behavior as BEFORE upload. |

**Auto-advance:** After successful upload, automatically advances to Step 3.

#### Step 3: Describe Transformation

Displays a summary of both uploaded files (filenames).

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| (description textarea) | Textarea | No | Max 5000 characters | Empty | "e.g., Remove inactive accounts, rename 'Acct_Num' to 'Account Number', sort by date descending..." | 4 rows. Optional natural-language description of the transformation to help the AI resolve ambiguities. |

**Buttons:**
- **Analyze** -- sends both file IDs and the optional description to the server for AI analysis. Shows a loading overlay ("Forging... Analyzing transformation patterns.") while processing. On success: populates the steps list and advances to Step 4.
- **Skip Description** -- triggers the same analysis without a description (calls the same function).

#### Step 4: Review Detected Steps

Displays a diff summary showing: columns removed, columns added, columns matched, reorder detected, sort detected, ambiguous cases.

If AI warnings were generated, they appear in an orange warning box titled "AI Inference Warnings."

**Step List (`src/components/mjolnir/step-list.tsx`):**

Each detected transformation step is shown as a card with:
- **Step number** (auto-assigned)
- **Type badge** -- color-coded label showing the step type
- **Confidence badge** -- percentage showing AI confidence (color-coded: green >=80%, gold >=50%, red <50%)
- **Description** -- click to edit inline (textarea, 2 rows)
- **Config** button -- toggles a collapsible panel showing the raw JSON configuration
- **Remove** button -- deletes the step

Steps are reorderable via drag-and-drop.

**+ Add Step** button opens a dropdown menu of all available step types:
Remove Columns, Rename Columns, Reorder Columns, Filter Rows, Format, Calculate, Sort, Deduplicate, Lookup, Pivot, Unpivot, Aggregate, Split Column, Merge Columns, Custom SQL.

Adding a step creates a new entry with confidence 1.0, an empty config, and a description "(manually added)."

**Buttons:**
- **Test Run** -- sends the steps and file IDs to the server for validation. Disabled if no steps exist. Shows loading overlay while processing. On success: displays validation results in Step 5.
- **Skip Validation** -- advances directly to Step 6 (Save) without running validation.

#### Step 5: Validation Results

**Location:** `src/components/mjolnir/validation-report.tsx`

Displays a read-only validation report:
- **Overall score** (percentage) with Pass/Fail badge (threshold: 95%)
- **Pattern checks** -- list of individual checks with pass/warn/fail status
- **Column match rates** -- bar chart showing per-column match percentages
- **Mismatches** table (strict mode) -- shows first 50 mismatches: row, column, expected value, actual value
- **Unsupported steps** warning -- lists any steps that could not be executed

**Buttons:**
- **Save Blueprint** -- advances to Step 6.
- **Edit Steps** -- goes back to Step 4.
- **Re-validate** -- re-runs validation.

#### Step 6: Save Blueprint

| Label | Type | Required | Validation | Default | Placeholder | Notes |
|-------|------|----------|------------|---------|-------------|-------|
| Blueprint Name | Text input | Yes | Min 1 character, max 200 characters | Empty | "e.g., Monthly Account Cleanup" | |

A summary is displayed showing: step count, BEFORE filename, AFTER filename, and validation match percentage (if validation was run).

**Buttons:**
- **Forge Blueprint** -- disabled until Blueprint Name is filled. Saves the blueprint to the server. On success: toast "Blueprint forged successfully.", resets the wizard, and refreshes the page. On failure: shows error message.
- **Back to Steps** -- goes back to Step 4.

#### Global Wizard Controls

- **Start Over** button -- visible on any step after Step 1. Resets the entire wizard to Step 1.
- **Progress bar** -- shows 6 steps with rune icons. Completed steps are clickable for navigation. Steps: Upload Before, Upload After, Describe, Review Steps, Validate, Save.

---

### Form 9: Blueprint List (Delete Action)

**Location:** `src/components/mjolnir/blueprint-list.tsx`

**Purpose:** Displays saved blueprints below the Mjolnir Forge wizard. Not a traditional form, but includes a destructive action.

Each blueprint card shows: name, status badge (DRAFT / VALIDATED / ACTIVE / ARCHIVED), version number, description, source filenames, and last updated date.

| Action | Type | Behavior |
|--------|------|----------|
| Delete | Button (per blueprint) | Shows a browser `confirm()` dialog: "Delete this blueprint?" If confirmed, sends a DELETE request. On success: toast "Blueprint deleted", refreshes the list. On failure: shows error toast. |

---

### Form 10: Connection List Actions (Delete / View Credentials)

**Location:** `src/components/connections/connection-list.tsx`

**Purpose:** Manages the connection list page with inline actions for database, SFTP, and email connections.

#### Database Connection Actions

| Action | Behavior |
|--------|----------|
| Edit | Opens the Database Connection Form (Form 2) pre-populated with the connection's existing values. |
| Delete | Browser `confirm()` dialog: "Delete this connection?" On confirm: sends DELETE request. Toast on success/failure. |

#### SFTP Connection Actions

| Action | Behavior |
|--------|----------|
| View Credentials | Fetches the SFTP credentials from the server and displays them in a modal overlay using the Credential Card component (Host, Port, Username, Password with Copy buttons). |
| Delete | Browser `confirm()` dialog: "Delete this SFTP connection? This will remove the SFTP user and all configuration." On confirm: sends DELETE request. Toast on success/failure. |

#### Email Connection Actions

| Action | Behavior |
|--------|----------|
| Edit | Opens the Email Connection Form (Form 3) pre-populated with the connection's existing values. |
| Delete | Browser `confirm()` dialog: "Delete this email connection?" On confirm: sends DELETE request. Toast on success/failure. |

---

### Summary of All Form Validation Rules (Server-Side Zod Schemas)

For reference, the following server-side validation rules are enforced even if the client does not explicitly prevent submission:

**Database Connections (`src/lib/validations/connections.ts`):**
- Name: 1-100 characters
- Type: POSTGRES, MSSQL, MYSQL, or BIGQUERY
- Host: required (non-empty) for SQL types
- Port: integer 1-65535
- Database: required (non-empty) for SQL types
- Username: required (non-empty) for SQL types
- Password: required (non-empty) for SQL types on create
- BigQuery: requires service account JSON with specific fields

**Email Connections (`src/lib/validations/email-connections.ts`):**
- Name: 1-200 characters
- SMTP Host: 1-500 characters
- Port: integer 1-65535 (default 587)
- Secure: boolean (default false)
- Auth Type: NONE, PLAIN, or OAUTH2 (default PLAIN)
- Username: max 500 characters (required when authType is PLAIN or OAUTH2)
- Password: max 2000 characters (required when authType is PLAIN or OAUTH2)
- From Address: 1-500 characters

**SFTP Connections (`src/lib/validations/sftp-connections.ts`):**
- Name: 1-100 characters
- Description: max 500 characters (optional)
- Source Type: ADP, QUICKBOOKS, SAP, GENERIC_FILE, or CUSTOM_SFTP
- File Format: CSV, TSV, or XLSX (default CSV)
- BigQuery Dataset: 1-100 characters
- BigQuery Table: 1-100 characters
- Load Mode: APPEND or REPLACE (default REPLACE)
- Notification Emails: array of valid email addresses (default empty)

**Reports (`src/lib/validations/reports.ts`):**
- Name: 1-200 characters
- Description: max 2000 characters (optional)
- SQL Query: 1-100,000 characters
- Data Source ID (connection): required (non-empty)
- Test Send Recipients: 1-20 valid email addresses
- Test Send Email Connection: required

**Schedules (`src/lib/validations/schedules.ts`):**
- Report ID: required
- Enabled: boolean (default true)
- Frequency: DAILY, WEEKLY, BIWEEKLY, MONTHLY, or QUARTERLY
- Days of Week: array of integers 0-6 (at least 1 required for WEEKLY/BIWEEKLY)
- Day of Month: integer 1-31 (required for MONTHLY/QUARTERLY)
- Months of Year: array of integers 1-12
- Time Hour: integer 0-23
- Time Minute: integer 0-59
- Timezone: required (non-empty)
- Recipients: at least 1, each with valid email and optional name (max 100 chars)
- Email Subject: 1-500 characters
- Email Body: max 5000 characters (default empty)
- Email Connection ID: required

**Mjolnir Blueprints (`src/lib/validations/mjolnir.ts`):**
- Blueprint Name: 1-200 characters
- Description: max 2000 characters (optional)
- Steps: at least 1, each with order (int >= 0), type (one of 15 types), confidence (0-1), config (object), description (non-empty)
- Analyze: requires beforeFileId and afterFileId; optional description (max 5000 chars)
- Validate: requires steps (at least 1) and both file IDs
