# React User Guide — Recon Report
Generated: Wed, Feb 25, 2026  9:34:53 PM
Source directory: ./src

## Framework Detection
- **Framework:** React (unknown bundler)
- **Language:** JavaScript

## UI Library

## Form Libraries

## Pass 1 — Routing Files
### Next.js App Router Pages
- `./src/app/(app)/connections/new/page.tsx`
- `./src/app/(app)/connections/page.tsx`
- `./src/app/(app)/dashboard/page.tsx`
- `./src/app/(app)/history/page.tsx`
- `./src/app/(app)/mjolnir/page.tsx`
- `./src/app/(app)/reports/[id]/page.tsx`
- `./src/app/(app)/reports/[id]/schedule/page.tsx`
- `./src/app/(app)/reports/new/page.tsx`
- `./src/app/(app)/reports/page.tsx`
- `./src/app/(app)/schedules/page.tsx`
- `./src/app/login/page.tsx`

## Pass 2 — Navigation Components
- `./src/__tests__/llm.test.ts`
- `./src/__tests__/mjolnir/ai-inference.test.ts`
- `./src/__tests__/mjolnir/file-parser.test.ts`
- `./src/__tests__/mjolnir/structural-diff.test.ts`
- `./src/__tests__/mjolnir/validation.test.ts`
- `./src/__tests__/report-runner.test.ts`
- `./src/app/(app)/connections/new/page.tsx`
- `./src/app/(app)/layout.tsx`
- `./src/app/(app)/reports/[id]/loading.tsx`
- `./src/app/(app)/reports/[id]/schedule/page.tsx`
- `./src/components/connections/connection-form.tsx`
- `./src/components/connections/connection-list.tsx`
- `./src/components/connections/email-connection-form.tsx`
- `./src/components/connections/sftp-wizard.tsx`
- `./src/components/mjolnir/blueprint-list.tsx`
- `./src/components/mjolnir/mjolnir-forge.tsx`
- `./src/components/mjolnir/step-editor.tsx`
- `./src/components/reports/column-config-panel.tsx`
- `./src/components/reports/report-editor.tsx`
- `./src/components/reports/report-list.tsx`
- `./src/components/reports/univer-sheet.tsx`
- `./src/components/schedule/schedule-form.tsx`
- `./src/components/schedule/schedule-list.tsx`
- `./src/components/sidebar.tsx`
- `./src/components/topbar.tsx`
- `./src/lib/column-config.ts`
- `./src/lib/email-templates/admin.ts`
- `./src/lib/email-templates/enduser.ts`
- `./src/lib/llm/providers/anthropic.ts`
- `./src/lib/llm/providers/openai-compatible.ts`
- `./src/lib/mjolnir/file-parser.ts`
- `./src/lib/mjolnir/prompts.ts`
- `./src/lib/mjolnir/types.ts`
- `./src/lib/report-runner.ts`
- `./src/lib/session.ts`
- `./src/lib/sftp-watcher.ts`

## Pass 3 — Authentication Files
- `./src/app/api/auth/[...nextauth]/route.ts`
- `./src/app/login/page.tsx`
- `./src/components/providers.tsx`
- `./src/components/sidebar.tsx`
- `./src/lib/api.ts`
- `./src/lib/auth.ts`
- `./src/lib/session.ts`
- `./src/middleware.ts`
- `./src/types/next-auth.d.ts`

## Pass 4 — Form Components

## Pass 5 — Search & Data Display
- `./src/app/(app)/dashboard/page.tsx`
- `./src/components/connections/connection-list.tsx`
- `./src/components/history/history-list.tsx`
- `./src/components/mjolnir/validation-report.tsx`
- `./src/components/schedule/schedule-list.tsx`
- `./src/lib/email-templates/admin.ts`
- `./src/lib/email-templates/enduser.ts`

## Pass 6 — Status & Workflow Files
- `./src/__tests__/mjolnir/validation.test.ts`
- `./src/app/(app)/dashboard/page.tsx`
- `./src/lib/mjolnir/cleanup.ts`
- `./src/lib/validations/mjolnir.ts`
- `./src/lib/validations/sftp-connections.ts`
### Status Constants/Enums
- `./src/app/(app)/dashboard/page.tsx:113:                      <StatusBadge status={run.status} />`
- `./src/app/(app)/mjolnir/page.tsx:24:  const serialized = blueprints.map((b: { id: string; name: string; description: string | null; status: string; version: number; beforeSample: string | null; afterSample: string | null; createdAt: Date; updatedAt: Date }) => ({`
- `./src/app/api/mjolnir/blueprints/route.ts:18:      where.status = { in: statuses };`
- `./src/components/connections/sftp-connection-card.tsx:29:const STATUS_STYLES: Record<SftpStatus, { badge: string; dot: string }> = {`
- `./src/components/connections/sftp-connection-card.tsx:35:const STATUS_LABELS: Record<SftpStatus, string> = {`
- `./src/components/connections/sftp-connection-card.tsx:46:  const style = STATUS_STYLES[connection.status];`
- `./src/components/connections/sftp-connection-card.tsx:59:              {STATUS_LABELS[connection.status]}`
- `./src/components/hermod-loading-context.tsx:45:        statusText={statusText}`
- `./src/components/history/history-list.tsx:16:const STATUS_BADGES: Record<string, string> = {`
- `./src/components/history/history-list.tsx:100:                      className={`${STATUS_BADGES[run.status] ?? "badge-neutral"} ${run.status === "FAILED" ? "cursor-pointer" : ""}`}`
- `./src/components/mjolnir/blueprint-list.tsx:18:const STATUS_BADGES: Record<string, string> = {`
- `./src/components/mjolnir/blueprint-list.tsx:89:                    STATUS_BADGES[bp.status] || STATUS_BADGES.DRAFT`
- `./src/components/mjolnir/validation-report.tsx:20:const STATUS_STYLES: Record<string, { icon: string; color: string }> = {`
- `./src/components/mjolnir/validation-report.tsx:35:  const style = STATUS_STYLES[check.status] ?? STATUS_STYLES.fail;`
- `./src/components/mjolnir/validation-report.tsx:98:            Pattern validation — {result.patternChecks?.filter((c) => c.status === "pass").length ?? 0} of{" "}`
- `./src/components/reports/report-list.tsx:18:const STATUS_BADGES: Record<string, string> = {`
- `./src/components/reports/report-list.tsx:72:                  <span className={STATUS_BADGES[report.lastRunStatus] ?? "badge-neutral"}>`
- `./src/lib/report-runner.ts:131:    if (blueprint && blueprint.status !== "ARCHIVED") {`
- `./src/__tests__/llm.test.ts:24:function mockJsonResponse(body: unknown, status = 200): Response {`
- `./src/__tests__/mjolnir/validations.test.ts:162:  it("accepts valid status values", () => {`
- `./src/__tests__/mjolnir/validations.test.ts:169:  it("rejects invalid status value", () => {`

## Pass 7 — Roles & Permissions
- `./src/components/reports/sql-editor.tsx`

## Pass 8 — Notifications & Error Handling
- `./src/__tests__/email.test.ts`
- `./src/__tests__/email-templates.test.ts`
- `./src/app/(app)/reports/[id]/schedule/page.tsx`
- `./src/components/connections/connection-form.tsx`
- `./src/components/connections/connection-list.tsx`
- `./src/components/connections/email-connection-form.tsx`
- `./src/components/connections/sftp-wizard.tsx`
- `./src/components/history/history-list.tsx`
- `./src/components/mjolnir/blueprint-list.tsx`
- `./src/components/mjolnir/mjolnir-forge.tsx`
- `./src/components/providers.tsx`
- `./src/components/reports/report-editor.tsx`
- `./src/components/reports/report-list.tsx`
- `./src/components/schedule/schedule-form.tsx`
- `./src/components/schedule/schedule-list.tsx`
- `./src/components/toast.tsx`

## Pass 9 — Computed/Calculated Fields
- `./src/app/api/mjolnir/analyze/route.ts:8:import { computeStructuralDiff } from "@/lib/mjolnir/engine/structural-diff";`
- `./src/app/api/mjolnir/analyze/route.ts:41:  const diff = computeStructuralDiff(before, after);`
- `./src/app/api/schedules/route.ts:5:import { calculateNextRun } from "@/lib/schedule-utils";`
- `./src/app/api/schedules/route.ts:62:    ? calculateNextRun({`
- `./src/app/api/schedules/[id]/route.ts:5:import { calculateNextRun } from "@/lib/schedule-utils";`
- `./src/app/api/schedules/[id]/route.ts:33:  // Merge with existing to compute nextRunAt`
- `./src/app/api/schedules/[id]/route.ts:45:  const nextRunAt = enabled ? calculateNextRun(merged) : null;`
- `./src/app/api/schedules/[id]/toggle/route.ts:4:import { calculateNextRun } from "@/lib/schedule-utils";`
- `./src/app/api/schedules/[id]/toggle/route.ts:22:    ? calculateNextRun({`
- `./src/components/mjolnir/step-editor.tsx:12:  calculate: "Calculate",`
- `./src/components/mjolnir/step-editor.tsx:30:  calculate: "bg-gold/10 text-gold border-gold/30",`
- `./src/components/mjolnir/step-list.tsx:13:  "calculate",`
- `./src/components/mjolnir/step-list.tsx:31:  calculate: "Calculate",`
- `./src/components/reports/report-editor.tsx:141:  // Helper: compute and set mapped data from column config + raw data`
- `./src/components/reports/report-editor.tsx:167:      // Recompute mapped data synchronously using refs for raw data`
- `./src/components/reports/report-editor.tsx:224:      // Compute mapped data synchronously — avoids double-render from derived-state effect`
- `./src/lib/column-config.ts:123:        // Formula columns — value computed in the spreadsheet, pass placeholder`
- `./src/lib/mjolnir/engine/ai-inference.ts:405: * Parse a formula inference response into a calculate ForgeStep.`
- `./src/lib/mjolnir/engine/ai-inference.ts:459:      type: "calculate",`
- `./src/lib/mjolnir/engine/ai-inference.ts:552:      // We have a formula — generate a calculate step deterministically`
- `./src/lib/mjolnir/engine/ai-inference.ts:555:        type: "calculate",`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:6: * The expression parser is used for "calculate" steps.`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:18:  metrics: StepMetric[];`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:263: * Add or overwrite a column with calculated values using formula expressions.`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:540:  calculate: handleCalculate,`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:579:  // Execute each step with metrics collection`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:581:  const metrics: StepMetric[] = [];`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:595:    metrics.push({`
- `./src/lib/mjolnir/engine/blueprint-executor.ts:610:    metrics,`
- `./src/lib/mjolnir/engine/expression-parser.ts:2: * Mjolnir — Formula expression parser for the "calculate" step type.`

## Pass 10 — Validation Messages & Error Text
- `./src/app/(app)/reports/[id]/schedule/page.tsx:36:        toast.error("Report not found");`
- `./src/app/api/connections/route.ts:5:import { createConnectionSchema } from "@/lib/validations/connections";`
- `./src/app/api/connections/route.ts:35:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/connections/test/route.ts:3:import { testConnectionSchema } from "@/lib/validations/connections";`
- `./src/app/api/connections/test/route.ts:12:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/connections/test/route.ts:35:      error instanceof Error ? error.message : "Connection failed";`
- `./src/app/api/connections/[id]/route.ts:5:import { updateConnectionSchema } from "@/lib/validations/connections";`
- `./src/app/api/connections/[id]/route.ts:11:    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });`
- `./src/app/api/connections/[id]/route.ts:18:    return NextResponse.json({ error: "Connection not found" }, { status: 404 });`
- `./src/app/api/connections/[id]/route.ts:25:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/connections/[id]/route.ts:63:    return NextResponse.json({ error: "Missing connection ID" }, { status: 400 });`
- `./src/app/api/connections/[id]/route.ts:70:    return NextResponse.json({ error: "Connection not found" }, { status: 404 });`
- `./src/app/api/email-connections/route.ts:5:import { createEmailConnectionSchema } from "@/lib/validations/email-connections";`
- `./src/app/api/email-connections/route.ts:34:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/email-connections/test/route.ts:14:      { error: "Host and from address are required" },`
- `./src/app/api/email-connections/[id]/route.ts:5:import { updateEmailConnectionSchema } from "@/lib/validations/email-connections";`
- `./src/app/api/email-connections/[id]/route.ts:11:    return NextResponse.json({ error: "Missing ID" }, { status: 400 });`
- `./src/app/api/email-connections/[id]/route.ts:18:    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });`
- `./src/app/api/email-connections/[id]/route.ts:25:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/email-connections/[id]/route.ts:70:    return NextResponse.json({ error: "Missing ID" }, { status: 400 });`
- `./src/app/api/email-connections/[id]/route.ts:77:    return NextResponse.json({ error: "Email connection not found" }, { status: 404 });`
- `./src/app/api/mjolnir/analyze/route.ts:3:import { analyzeSchema } from "@/lib/validations/mjolnir";`
- `./src/app/api/mjolnir/analyze/route.ts:32:      { error: "Uploaded files not found. Please re-upload." },`
- `./src/app/api/mjolnir/blueprints/route.ts:5:import { createBlueprintSchema } from "@/lib/validations/mjolnir";`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:4:import { updateBlueprintSchema } from "@/lib/validations/mjolnir";`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:19:    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:27:    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:37:    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:55:    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:76:    return NextResponse.json({ error: "Missing blueprint ID" }, { status: 400 });`
- `./src/app/api/mjolnir/blueprints/[id]/route.ts:85:    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });`
- `./src/app/api/mjolnir/upload/route.ts:14:    return NextResponse.json({ error: "No file provided" }, { status: 400 });`
- `./src/app/api/mjolnir/upload/route.ts:19:      { error: "Only .xlsx files are supported" },`
- `./src/app/api/mjolnir/validate/route.ts:3:import { validateSchema } from "@/lib/validations/mjolnir";`
- `./src/app/api/mjolnir/validate/route.ts:8:import { validateBlueprint } from "@/lib/mjolnir/engine/validation";`
- `./src/app/api/mjolnir/validate/route.ts:31:      { error: "Uploaded files not found. Please re-upload." },`
- `./src/app/api/query/execute/route.ts:4:import { executeQuerySchema } from "@/lib/validations/reports";`
- `./src/app/api/query/execute/route.ts:13:      { error: "Validation failed", details: parsed.error.flatten() },`
- `./src/app/api/query/execute/route.ts:26:      { error: "Connection not found" },`
- `./src/app/api/query/execute/route.ts:44:      error instanceof Error ? error.message : "Query execution failed";`

## Bonus — File Upload Components
- `./src/app/api/mjolnir/analyze/route.ts`
- `./src/app/api/mjolnir/validate/route.ts`
- `./src/components/connections/connection-form.tsx`
- `./src/components/connections/sftp-wizard.tsx`
- `./src/components/mjolnir/blueprint-list.tsx`
- `./src/components/mjolnir/file-upload-zone.tsx`
- `./src/components/mjolnir/mjolnir-forge.tsx`
- `./src/lib/mjolnir/file-parser.ts`

## Summary
- Total component files: 53
- Estimated page components: 4

