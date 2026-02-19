# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hermod is a Next.js 14 (App Router) SQL report builder with Excel formatting and scheduled email delivery. Users connect to databases (Postgres, SQL Server, MySQL, BigQuery), write SQL in a Monaco editor, format results in an AG Grid spreadsheet, and schedule `.xlsx` email delivery via a visual scheduler.

## Commands

```bash
npm run dev          # Start Next.js dev server
npm run worker       # Start pg-boss background worker (separate terminal)
npm run build        # Production build
npm run test         # Run Vitest unit tests
npm run test:watch   # Run tests in watch mode
npm run lint         # ESLint
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run Prisma migrations
```

## Architecture

- **Next.js App** (port 3000): Pages + API routes. All API routes use `withAuth()` wrapper from `src/lib/api.ts` for auth + error handling.
- **Worker Process** (`src/lib/worker.ts`): Separate Node process that polls `nextRunAt` every 60s, enqueues pg-boss jobs, executes queries, generates Excel via ExcelJS, sends emails via Nodemailer.
- **Database**: PostgreSQL via Prisma. pg-boss uses the same database (creates its own tables).
- **Connection passwords**: Encrypted at rest with AES-256-GCM (`src/lib/crypto.ts`). Decrypted in the connector factory.

### Key Patterns

- **`withAuth(handler)`** (`src/lib/api.ts`): Wraps all API route handlers. Handles session check → 401, try/catch → 500. Every route uses this.
- **Zod validation**: Feature-grouped in `src/lib/validations/` (connections.ts, reports.ts, schedules.ts).
- **Connectors** (`src/lib/connectors.ts`): `DataSourceConnector` interface with `getConnector()` factory. Connect-per-query, no pooling. 30s connection timeout, 120s query timeout.
- **Query execution**: Single `POST /api/query/execute` endpoint used by editor preview, report run, and worker.
- **Schedule math**: `calculateNextRun()` in `src/lib/schedule-utils.ts` uses date-fns-tz for timezone-aware computation. This is the highest-risk code — test edge cases thoroughly.
- **Toast notifications**: `useToast()` hook from `src/components/toast.tsx`. Success/error feedback everywhere.

### File Organization

- `src/components/` organized by feature: `connections/`, `reports/`, `schedule/`
- `src/app/api/` mirrors REST resources: `connections/`, `reports/`, `schedules/`, `query/`, `history/`
- `src/lib/` for shared utilities — never import from `components/` or `app/`

## Code Quality Rules

- All API routes filter by `userId` — users never see other users' data
- All inputs validated with Zod schemas before processing
- Dark theme throughout (gray-950 background). No external UI library — Tailwind only.
- TypeScript strict mode. Avoid `any` except for driver interop.
- API routes preferred over server actions (worker needs the same endpoints).

## Plan Mode Guidelines

Review this plan thoroughly before making any code changes. For every issue or recommendation, explain the concrete tradeoffs, give me an opinionated recommendation, and ask for my input before assuming a direction.

My engineering preferences (use these to guide your recommendations):

- DRY is important—flag repetition aggressively.
- Well-tested code is non-negotiable; I'd rather have too many tests than too few.
- I want code that's "engineered enough" — not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity).
- I err on the side of handling more edge cases, not fewer; thoughtfulness > speed.
- Bias toward explicit over clever.

### 1. Architecture review

Evaluate:

- Overall system design and component boundaries.
- Dependency graph and coupling concerns.
- Data flow patterns and potential bottlenecks.
- Scaling characteristics and single points of failure.
- Security architecture (auth, data access, API boundaries).

### 2. Code quality review

Evaluate:

- Code organization and module structure.
- DRY violations—be aggressive here.
- Error handling patterns and missing edge cases (call these out explicitly).
- Technical debt hotspots.
- Areas that are over-engineered or under-engineered relative to my preferences above.

### 3. Test review

Evaluate:

- Test coverage gaps (unit, integration, e2e).
- Test quality and assertion strength.
- Missing edge case coverage—be thorough.
- Untested failure modes and error paths.

### 4. Performance review

Evaluate:

- N+1 queries and database access patterns.
- Memory-usage concerns.
- Caching opportunities.
- Slow or high-complexity code paths.

### For each issue found

For every specific issue (bug, smell, design concern, or risk):

- Describe the problem concretely, with file and line references.
- Present 2–3 options, including "do nothing" where that's reasonable.
- For each option, specify: implementation effort, risk, impact on other code, and maintenance burden.
- Give a recommended option and why, mapped to the engineering preferences above.
- Then explicitly ask whether the user agrees or wants to choose a different direction before proceeding.

### Workflow and interaction

- Do not assume priorities on timeline or scale.
- After each section, pause and ask for feedback before moving on.

### Before starting plan review

Ask if the user wants one of two options:

1. **BIG CHANGE:** Work through this interactively, one section at a time (Architecture → Code Quality → Tests → Performance) with at most 4 top issues in each section.
2. **SMALL CHANGE:** Work through interactively ONE question per review section.

### For each stage of review

Output the explanation and pros/cons of each stage's questions AND an opinionated recommendation and why, then use AskUserQuestion. NUMBER issues and give LETTERS for options. When using AskUserQuestion, each option must clearly label the issue NUMBER and option LETTER so the user doesn't get confused. The recommended option should always be the 1st option.
