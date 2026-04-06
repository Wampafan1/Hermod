# Hermod User Guide -- Screenshot Guide

This document lists every `[Figure N]` placeholder in the user guide draft, with instructions for capturing each screenshot.

---

## Figure 1 -- The Hermod sign-in page showing the Google sign-in button and the disabled Microsoft option.
- **Page/Route:** `/login`
- **What to capture:** The full sign-in page showing the Hermod logo, the "Sign in with Google" button, and the disabled "Microsoft -- Soon" button. The dark background with gold accents should be clearly visible.
- **Required state:** Not logged in. No active session.
- **Annotations:** Arrow pointing to the "Sign in with Google" button. Label on the disabled Microsoft button noting it is not yet available.

---

## Figure 2 -- The sign-in page with the "Summoning the Bifrost..." loading state.
- **Page/Route:** `/login`
- **What to capture:** The sign-in page after clicking "Sign in with Google," showing the loading spinner and "Summoning the Bifrost..." text on the button.
- **Required state:** Mid-authentication -- click "Sign in with Google" and capture during the brief loading state before the Google redirect. May require throttling network speed or using browser dev tools to pause.
- **Annotations:** Highlight the button text change and spinner.

---

## Figure 3 -- The full application layout showing the sidebar, top bar, and main content area with labels.
- **Page/Route:** `/dashboard`
- **What to capture:** The complete application layout with all three regions visible: left sidebar with navigation links and user profile, top bar with section label and clock, and the main content area showing Dashboard content.
- **Required state:** Logged in. Ideally with some data (at least 1 report, 1 connection, some run history) so the dashboard is not empty.
- **Annotations:** Three labeled boxes/outlines: "Sidebar" on the left panel, "Top Bar" on the header strip, "Main Content Area" on the center region. Arrows pointing to the Hermod logo, the navigation links, and the user profile at the bottom of the sidebar.

---

## Figure 4 -- The Dashboard showing summary cards, quick actions, upcoming runs, and recent runs table.
- **Page/Route:** `/dashboard`
- **What to capture:** The full Dashboard page showing: the welcome message with the user's first name, the three summary cards (Reports, Connections, Runs), the New Report and Add Connection buttons, the Upcoming Runs section (with at least one upcoming schedule), and the Recent Runs table with a mix of SUCCESS and FAILED entries.
- **Required state:** Logged in with: at least 2-3 reports, at least 1 connection, at least 1 enabled schedule due within 24 hours, and several recent runs with mixed statuses.
- **Annotations:** Labels for each section: "Summary Cards," "Quick Actions," "Upcoming Runs," "Recent Runs."

---

## Figure 5 -- The Connections page showing database, SFTP, and email connection cards in their respective sections.
- **Page/Route:** `/connections`
- **What to capture:** The Connections page with at least one card in each of the three sections: Database Connections (showing type badge, host/port), File Integrations/SFTP (showing status indicator with pulsing dot, file stats), and Email Delivery (showing auth type, host, from address). The decorative rune dividers between sections should be visible.
- **Required state:** Logged in with at least one database connection, one SFTP connection (ideally in "Watching" status), and one email connection.
- **Annotations:** Labels for each section heading. Arrow pointing to the SFTP status indicator dot. Arrow pointing to Edit and Delete buttons on a database connection card.

---

## Figure 6 -- The New Connection page showing the source picker with database, SFTP, and email categories.
- **Page/Route:** `/connections/new`
- **What to capture:** The full source picker page showing all three categories: Database Connections (4 cards: PostgreSQL, SQL Server, MySQL, BigQuery), File Integrations (5 cards: ADP, QuickBooks, SAP, File Drop, Custom SFTP), and Email Delivery (1 card: SMTP Email). Each card should show its rune icon, name, and description.
- **Required state:** Logged in. No special data required.
- **Annotations:** Labels for each category heading. Optionally highlight one card (e.g., PostgreSQL) to show it is clickable.

---

## Figure 7 -- The Add Connection modal for a PostgreSQL database with all fields visible.
- **Page/Route:** `/connections?add=POSTGRES` (or `/connections` after selecting PostgreSQL from the picker)
- **What to capture:** The Add Connection modal dialog showing: Name field, Type dropdown (set to PostgreSQL), Host field, Port field (showing 5432), Database field, Username field, Password field, Test Connection button, Cancel button, and Save button.
- **Required state:** Logged in. The modal is open with PostgreSQL selected. Fields can be empty or filled with example values (e.g., Name: "Production Database", Host: "db.example.com", Port: 5432, Database: "analytics", Username: "readonly_user").
- **Annotations:** Arrow pointing to the Type dropdown noting it is locked when editing. Arrow pointing to the Test Connection button.

---

## Figure 8 -- The Add Email Connection modal with Username & Password authentication selected.
- **Page/Route:** `/connections?addEmail=SMTP` (or `/connections` after selecting SMTP Email from the picker)
- **What to capture:** The Add Email Connection modal showing: Name field, Authentication dropdown (set to "Username & Password"), SMTP Host field, Port field (587), Use TLS/SSL checkbox, Username field, Password field, From Address field, Test Connection button, Cancel button, and Save button.
- **Required state:** Logged in. The modal is open with Username & Password auth selected. Fields can be filled with example values (e.g., Name: "Office 365", Host: "smtp.office365.com", From: "Hermod <reports@company.com>").
- **Annotations:** Arrow pointing to the Authentication dropdown. Note next to the TLS checkbox explaining port auto-adjustment.

---

## Figure 9 -- The SFTP Connection Wizard at Step 1, showing the name and description fields.
- **Page/Route:** `/connections/new` (after selecting an SFTP source type, e.g., ADP)
- **What to capture:** Step 1 of the SFTP wizard showing: the step indicator at the top (Step 1 highlighted), the "Name It" heading, Connection Name input field, Description input field, Back button, and Generate Credentials button.
- **Required state:** Logged in. Selected an SFTP source type (e.g., ADP) from the source picker.
- **Annotations:** Arrow pointing to the step progress indicator. Arrow pointing to the Generate Credentials button.

---

## Figure 10 -- The SFTP Wizard Step 2 showing generated credentials with Copy buttons.
- **Page/Route:** `/connections/new` (SFTP wizard, Step 2)
- **What to capture:** Step 2 of the SFTP wizard showing: the credential card with Host, Port, Username, and Password fields (each with a Copy button), the Copy All button, the source-specific setup instructions below, and the Test Connection, Back, and Configure Processing buttons.
- **Required state:** Logged in. Completed Step 1 (generated credentials for an SFTP connection). The credential card should show actual generated values.
- **Annotations:** Arrow pointing to the Copy buttons. Highlight the credential card area.

---

## Figure 11 -- The SFTP Wizard Step 3 showing file format, BigQuery destination, and load mode settings.
- **Page/Route:** `/connections/new` (SFTP wizard, Step 3)
- **What to capture:** Step 3 showing: the "Destination: Load to BigQuery" info box, Expected File Format dropdown, BigQuery Dataset input, BigQuery Table input, Load Mode dropdown, Notification Emails input, Back button, and Review button.
- **Required state:** Logged in. Completed Steps 1-2 of the SFTP wizard.
- **Annotations:** Arrow pointing to the "Destination: Load to BigQuery" info box. Arrow pointing to the Load Mode dropdown options.

---

## Figure 12 -- The SFTP Wizard Step 4 showing the complete configuration summary.
- **Page/Route:** `/connections/new` (SFTP wizard, Step 4)
- **What to capture:** Step 4 showing the read-only summary: Connection name, Source type, SFTP User, File Format, Destination (dataset.table), Load Mode, and Notification Emails. Back button and Done button.
- **Required state:** Logged in. Completed Steps 1-3 with realistic data filled in.
- **Annotations:** None required -- the summary is self-explanatory.

---

## Figure 13 -- The Reports list page showing several report cards with status badges.
- **Page/Route:** `/reports`
- **What to capture:** The Reports list showing 3-5 report cards. Cards should display a mix of: reports with SUCCESS status, at least one with FAILED status, one with "Scheduled" badge, one with "Paused" badge, and one without any schedule. The "New Report" button should be visible in the header.
- **Required state:** Logged in with at least 3-5 reports in various states (some with schedules enabled, some paused, some with no schedule, various last-run statuses).
- **Annotations:** Arrow pointing to the status badges (SUCCESS, FAILED). Arrow pointing to the schedule badges (Scheduled, Paused). Arrow pointing to the Delete button on one card.

---

## Figure 14 -- The Report Editor showing the SQL editor, column config panel, spreadsheet preview, and config sidebar.
- **Page/Route:** `/reports/{id}` (an existing report with query results)
- **What to capture:** The complete report editor workspace showing all four regions: the SQL editor at the top with a query visible and the connection dropdown, the column config panel below it with several columns listed, the spreadsheet preview with formatted data, and the configuration sidebar on the right with Name, Description, Connection, and Save buttons.
- **Required state:** Logged in. An existing report with a saved query that has been run (showing results). The report should have column configuration and some spreadsheet formatting applied.
- **Annotations:** Labels for each region: "SQL Editor," "Column Config," "Spreadsheet Preview," "Config Sidebar." Arrow pointing to the Run Query button and Ctrl+Enter shortcut hint.

---

## Figure 15 -- The SQL editor after a successful query run showing the row count and execution time summary.
- **Page/Route:** `/reports/{id}` (report editor after running a query)
- **What to capture:** Close-up of the SQL editor toolbar area showing: the Connection dropdown (with a connection selected), the Run Query button, the Ctrl+Enter hint, and the result summary line (e.g., "42 rows in 312ms").
- **Required state:** Logged in. A report with a query that has just been successfully executed.
- **Annotations:** Arrow pointing to the "42 rows in 312ms" summary text. Highlight the Ctrl+Enter shortcut.

---

## Figure 16 -- The Column Config panel showing a list of columns with drag handles, source mapping, display names, widths, and visibility toggles.
- **Page/Route:** `/reports/{id}` (report editor, column config section)
- **What to capture:** Close-up of the Column Config panel showing 4-6 columns. Each row should show: the drag handle, the Source dropdown, the Display Name text input (with a friendly name), the Width number input, the Vis toggle (mix of on/off), and the x (remove) button. The "+ Add Formula" button should be visible at the bottom.
- **Required state:** Logged in. A report with query results and column configuration. At least one column should have visibility set to "off" and at least one should have a modified display name.
- **Annotations:** Arrow pointing to the drag handle (for reordering). Arrow pointing to the Vis toggle. Arrow pointing to "+ Add Formula."

---

## Figure 17 -- The spreadsheet preview showing formatted query results with styled headers and data rows.
- **Page/Route:** `/reports/{id}` (report editor, spreadsheet section)
- **What to capture:** The Univer spreadsheet preview showing formatted data: bold header row with a distinct background color, several data rows with consistent formatting, and the "Showing 20 of N rows" banner if applicable.
- **Required state:** Logged in. A report with query results, column formatting applied (bold headers, background colors, number formats). The query should return more than 20 rows to trigger the truncation banner.
- **Annotations:** Arrow pointing to the header row formatting. Arrow pointing to the "Showing 20 of N rows" truncation banner.

---

## Figure 18 -- The configuration sidebar showing the Name, Description, Connection, and Blueprint fields, plus Save buttons.
- **Page/Route:** `/reports/{id}` (report editor, sidebar)
- **What to capture:** Close-up of the configuration sidebar showing: Name field (filled), Description field (filled), Connection dropdown (with a connection selected), Forge Blueprint dropdown (if blueprints exist), Save Report button, Save & Schedule button, and the "Unsaved changes" warning indicator.
- **Required state:** Logged in. An existing report with some unsaved changes (to trigger the warning indicator). At least one blueprint should exist for the Forge Blueprint dropdown to appear.
- **Annotations:** Arrow pointing to the "Unsaved changes" warning. Arrow pointing to the "Save & Schedule" button.

---

## Figure 19 -- The Test Send section showing the email connection dropdown, recipient input, and Send Test Email button.
- **Page/Route:** `/reports/{id}` (report editor, sidebar, scrolled to Test Send section)
- **What to capture:** Close-up of the Test Send section showing: the Email Connection dropdown (with a connection selected), the Recipients text input (with one or two email addresses entered), and the Send Test Email button.
- **Required state:** Logged in. A saved report (no unsaved changes) with at least one email connection configured. The Send Test Email button should be enabled.
- **Annotations:** Arrow pointing to the Email Connection dropdown. Note that the button is disabled when there are unsaved changes.

---

## Figure 20 -- The Schedules list page showing a table of schedules with frequency, next run, recipients, and toggle switches.
- **Page/Route:** `/schedules`
- **What to capture:** The Schedules table with 3-5 rows showing a variety of frequencies (Daily, Weekly, Monthly). Each row should show: Report name, Frequency description, Next Run date/time, Recipients count, Enabled toggle (mix of enabled and disabled), and Edit button.
- **Required state:** Logged in with at least 3-5 schedules configured, with a mix of enabled and disabled states and different frequencies.
- **Annotations:** Arrow pointing to the Enabled toggle. Arrow pointing to the Edit button.

---

## Figure 21 -- The Schedule Editor showing all fields for a weekly schedule configuration.
- **Page/Route:** `/reports/{id}/schedule`
- **What to capture:** The full schedule editor form showing: heading with report name and Enabled toggle, Frequency dropdown (set to "Weekly"), Day selector buttons (some selected, highlighted in gold), Time dropdowns (Hour, Minute, AM/PM), Timezone dropdown, Email Connection dropdown, Recipients field (with email tags), Email Subject field (with template variables), Email Body textarea, the Schedule Preview sentence at the bottom, and the Save Schedule button.
- **Required state:** Logged in. Editing or creating a schedule for a report. Set frequency to Weekly with 2-3 days selected. Add at least 2 recipient tags. Fill in all fields.
- **Annotations:** Arrow pointing to the gold-highlighted day buttons. Arrow pointing to the schedule preview sentence. Arrow pointing to the "Add from previous" button (if visible).

---

## Figure 22 -- The Run History page showing the status filter and results table.
- **Page/Route:** `/history`
- **What to capture:** The full History page showing: the Status filter dropdown at the top, and the results table with 5-10 rows showing a mix of SUCCESS, FAILED, and possibly RUNNING statuses. Each row shows Report name, Status badge, Rows count, Started time, Duration, and Re-run button.
- **Required state:** Logged in with at least 5-10 run history entries with a mix of SUCCESS and FAILED statuses.
- **Annotations:** Arrow pointing to the Status filter dropdown. Arrow pointing to a FAILED badge (noting it is clickable). Arrow pointing to the Re-run button.

---

## Figure 23 -- The error detail modal for a failed run showing the database error message.
- **Page/Route:** `/history` (with error modal open)
- **What to capture:** The error detail modal that appears when clicking a FAILED status badge. The modal should show a scrollable code block containing a realistic database error message (e.g., a SQL syntax error or table not found error).
- **Required state:** Logged in. At least one FAILED run in history. Click the red FAILED badge to open the modal.
- **Annotations:** Arrow pointing to the error message text. Note that this modal is opened by clicking the FAILED badge.

---

## Figure 24 -- The Mjolnir page showing the Forge Wizard progress bar and the Saved Blueprints section below.
- **Page/Route:** `/mjolnir`
- **What to capture:** The full Mjolnir page showing: the Forge Wizard section at the top with the 6-step progress bar (rune icons), the current step content (Step 1 file upload zone), the decorative divider, and the Saved Blueprints section below with 1-2 blueprint cards showing status badges.
- **Required state:** Logged in. At least 1-2 saved blueprints in different statuses (e.g., one VALIDATED, one DRAFT).
- **Annotations:** Label for "Forge Wizard" section and "Saved Blueprints" section. Arrow pointing to the progress bar steps.

---

## Figure 25 -- Mjolnir Step 1 showing the file upload zone for the BEFORE file.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 1)
- **What to capture:** Close-up of Step 1 showing: the step indicator (Step 1 highlighted), the "Upload Before File" heading or instruction, the dashed-border file upload zone with "Drop .xlsx file here or click to browse" text.
- **Required state:** Logged in. Forge Wizard at Step 1 (initial state or after clicking Start Over).
- **Annotations:** Arrow pointing to the upload zone. Note that only .xlsx files are accepted.

---

## Figure 26 -- Mjolnir Step 2 showing the BEFORE file summary and the AFTER file upload zone.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 2)
- **What to capture:** Step 2 showing: the BEFORE file summary (filename, column count, row count, column name chips), and the AFTER file upload zone below it.
- **Required state:** Logged in. Uploaded a BEFORE file in Step 1 (auto-advanced to Step 2). The summary should show realistic file details.
- **Annotations:** Arrow pointing to the BEFORE file summary details. Arrow pointing to the column name chips.

---

## Figure 27 -- Mjolnir Step 3 showing file summaries and the optional description text area.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 3)
- **What to capture:** Step 3 showing: summaries of both BEFORE and AFTER files, the description textarea with placeholder text, and the Analyze and Skip Description buttons.
- **Required state:** Logged in. Uploaded both files (auto-advanced to Step 3).
- **Annotations:** Arrow pointing to the description textarea. Arrow pointing to both the Analyze and Skip Description buttons.

---

## Figure 28 -- Mjolnir Step 4 showing the structural diff summary, AI warnings, and the list of detected transformation steps.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 4)
- **What to capture:** Step 4 showing: the diff summary (columns removed, added, matched, reorder/sort detected), an AI Inference Warnings panel (if present), and the step list with 3-5 transformation steps showing type badges, confidence percentages, descriptions, and Config/Remove buttons. The "+ Add Step" button and Test Run/Skip Validation buttons should be visible.
- **Required state:** Logged in. Completed analysis (Steps 1-3). The analysis should have detected multiple transformation steps with varying confidence levels.
- **Annotations:** Arrow pointing to a confidence badge. Arrow pointing to the diff summary numbers. Arrow pointing to the "+ Add Step" button.

---

## Figure 29 -- Mjolnir Step 5 showing the validation report with overall score, pattern checks, and column match rates.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 5)
- **What to capture:** Step 5 showing: the overall score percentage with Passed/Failed badge, the summary line, the pattern checks list (mix of pass/warn/fail), the column match rate bar chart, and the Save Blueprint/Edit Steps/Re-validate buttons.
- **Required state:** Logged in. Completed validation (Steps 1-4 plus Test Run). Ideally a passing score (95%+) with some interesting pattern checks.
- **Annotations:** Arrow pointing to the overall score and pass/fail badge. Arrow pointing to a column with a low match rate (red bar) if present.

---

## Figure 30 -- Mjolnir Step 6 showing the blueprint name input and summary details.
- **Page/Route:** `/mjolnir` (Forge Wizard, Step 6)
- **What to capture:** Step 6 showing: the Blueprint Name text input, the summary of step count, BEFORE/AFTER filenames, and validation match percentage. The Forge Blueprint and Back to Steps buttons.
- **Required state:** Logged in. Reached Step 6 (either from validation or Skip Validation). The summary should show realistic details.
- **Annotations:** Arrow pointing to the Blueprint Name field. Arrow pointing to the Forge Blueprint button.

---

## Figure 31 -- The Saved Blueprints list showing blueprint cards with status badges, versions, and file references.
- **Page/Route:** `/mjolnir` (scrolled to the Saved Blueprints section)
- **What to capture:** Close-up of the Saved Blueprints section showing 2-3 blueprint cards. Each card should show: blueprint name, status badge (mix of DRAFT, VALIDATED, ACTIVE), version number, description, BEFORE/AFTER filenames with arrow, last updated date, and Delete button.
- **Required state:** Logged in with at least 2-3 saved blueprints in different statuses.
- **Annotations:** Arrow pointing to the different status badges (DRAFT vs. VALIDATED vs. ACTIVE) with color labels. Arrow pointing to the Delete button.

---

## Summary

| Figure | Page | Key Content |
|--------|------|-------------|
| 1 | `/login` | Sign-in page with Google and Microsoft buttons |
| 2 | `/login` | Loading state during sign-in |
| 3 | `/dashboard` | Full layout with sidebar, top bar, main content labeled |
| 4 | `/dashboard` | Complete Dashboard with all sections populated |
| 5 | `/connections` | Connections page with all three connection type sections |
| 6 | `/connections/new` | Source picker with all connection type cards |
| 7 | `/connections?add=POSTGRES` | Add Database Connection modal (PostgreSQL) |
| 8 | `/connections?addEmail=SMTP` | Add Email Connection modal |
| 9 | `/connections/new` | SFTP Wizard Step 1 |
| 10 | `/connections/new` | SFTP Wizard Step 2 (credentials) |
| 11 | `/connections/new` | SFTP Wizard Step 3 (processing config) |
| 12 | `/connections/new` | SFTP Wizard Step 4 (review summary) |
| 13 | `/reports` | Reports list with status badges |
| 14 | `/reports/{id}` | Full report editor workspace |
| 15 | `/reports/{id}` | SQL editor toolbar with execution summary |
| 16 | `/reports/{id}` | Column Config panel close-up |
| 17 | `/reports/{id}` | Spreadsheet preview with formatting |
| 18 | `/reports/{id}` | Config sidebar with fields and buttons |
| 19 | `/reports/{id}` | Test Send section |
| 20 | `/schedules` | Schedules list table |
| 21 | `/reports/{id}/schedule` | Schedule editor form (weekly) |
| 22 | `/history` | Run History with filter and table |
| 23 | `/history` | Error detail modal for failed run |
| 24 | `/mjolnir` | Full Mjolnir page overview |
| 25 | `/mjolnir` | Forge Step 1 (BEFORE upload) |
| 26 | `/mjolnir` | Forge Step 2 (AFTER upload) |
| 27 | `/mjolnir` | Forge Step 3 (describe) |
| 28 | `/mjolnir` | Forge Step 4 (review steps) |
| 29 | `/mjolnir` | Forge Step 5 (validation results) |
| 30 | `/mjolnir` | Forge Step 6 (save blueprint) |
| 31 | `/mjolnir` | Saved Blueprints list |

**Total screenshots needed: 31**
