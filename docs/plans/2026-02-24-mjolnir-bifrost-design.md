# Mjolnir — Design Document

> Living document. Build, refine, repeat.

---

## 1. What We're Building NOW

**Mjolnir** — the AI-powered transformation forge. Upload a BEFORE Excel and an AFTER Excel. AI reverse-engineers what you did. Generates a reusable Forge Blueprint. Blueprint executes deterministically forever — zero AI cost per run.

**What we're NOT building now:**
- The full Bifrost routing engine (future)
- Other realm connectors (future)
- The 3-decision route builder UI (future)
- Premium access gating (future)

The Nine Realms vocabulary exists for the **landing page narrative** and to keep naming consistent when we build the rest later. The realm names appear in this doc as context, not as implementation targets.

## 2. The Nine Realms (Context Only)

This is the vision. We're not building connectors for all of these — just using the names.

| Realm | Represents | Status |
|-------|-----------|--------|
| Asgard | Databases | EXISTS (`src/lib/connectors.ts`) |
| Vanaheim | Excel Workbooks | EXISTS (`generateExcel()`) |
| Midgard | FTP / SFTP / Files | EXISTS (`sftp-watcher.ts`) |
| Nidavellir | The Forge (transformation) | **BUILDING NOW** (Mjolnir) |
| Jotunheim | CSV / Flat Files | Future |
| Alfheim | Cloud / APIs | Future |
| Muspelheim | Webhooks / Triggers | Future |
| Niflheim | Cold Storage / Archives | Future |
| Helheim | Dead Letter / Error Queue | Partial (`RunLog` FAILED status) |

## 3. Mjolnir User Workflow

### Step 1: Upload BEFORE file
Raw source data. The Excel file as-is from the source.

### Step 2: Upload AFTER file
The user's manually transformed version. They did this in Excel — renames, filters, calculated columns, formatting, whatever they normally do.

### Step 3: (Optional) Describe what you did
Plain English: "I cleaned up the vendor feed, matched SKUs, calculated landed cost."

### Step 4: Mjolnir analyzes the diff
- Phase 1 (deterministic): column matching, row counting, sort detection, format detection — no AI
- Phase 2 (AI): ambiguous cases — formula inference, complex filter patterns, uncertain mappings

### Step 5: Human review
User sees detected steps in plain English. Confirm, edit, remove, add, or re-analyze.

### Step 6: Test run
Blueprint runs against the BEFORE file. Output compared to AFTER file. Discrepancies flagged.

### Step 7: Save blueprint
Validated blueprint stored in DB. Ready to attach to a scheduled job.

## 4. Database Schema

```prisma
// ─── Blueprints (Mjolnir) ────────────────────────────
model Blueprint {
  id            String          @id @default(cuid())
  name          String
  description   String?
  version       Int             @default(1)
  steps         Json            // ForgeStep[] — the transformation pipeline
  sourceSchema  Json?           // Expected input columns + types (for validation)
  analysisLog   Json?           // Full Mjolnir analysis results (audit trail)
  beforeSample  String?         // Original BEFORE filename
  afterSample   String?         // Original AFTER filename
  status        BlueprintStatus @default(DRAFT)
  userId        String
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt
}

enum BlueprintStatus {
  DRAFT       // Being created/edited in Mjolnir UI
  VALIDATED   // Test run passed, output matches AFTER
  ACTIVE      // In use
  ARCHIVED    // Retired but preserved
}
```

That's it for now. One model. When we build the Bifrost route system later, `Route` will reference `Blueprint` via a foreign key. But we don't need `Route` to build and test Mjolnir.

## 5. Forge Blueprint Steps

```typescript
interface ForgeStep {
  order: number;
  type: ForgeStepType;
  confidence: number;    // 0.0–1.0 from Mjolnir analysis
  config: Record<string, unknown>;
  description: string;   // Human-readable, shown in review UI
}

type ForgeStepType =
  | "remove_columns"
  | "rename_columns"
  | "reorder_columns"
  | "filter_rows"
  | "format"
  | "calculate"
  | "sort"
  | "deduplicate"
  | "lookup"
  | "pivot"
  | "unpivot"
  | "custom_sql";
```

Each step type maps to a pure function. No AI at runtime. The executor processes steps in order.

## 6. Mjolnir Engine Architecture

```
┌─────────────────────────────────┐
│         Mjolnir Engine          │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Phase 1: Structural Diff │  │  ← Deterministic. No AI.
│  │  (column match, row count,│  │     Handles 60-70% of cases.
│  │   sort, format detection) │  │
│  └───────────┬───────────────┘  │
│              │ ambiguous cases  │
│  ┌───────────▼───────────────┐  │
│  │  Phase 2: AI Inference    │  │  ← LLM call. Model-agnostic.
│  │  (formula, complex filter,│  │     Cheap model for dev.
│  │   uncertain mappings)     │  │     Heavy hitter for prod.
│  └───────────┬───────────────┘  │
│              │ ForgeStep[]      │
│  ┌───────────▼───────────────┐  │
│  │  Phase 3: Validation      │  │  ← Run blueprint on BEFORE,
│  │  (test run, compare to    │  │     diff output vs AFTER.
│  │   AFTER, flag mismatches) │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### Phase 1: Structural Diff (No AI)

Deterministic analysis before any LLM call:

- **Column inventory**: columns in BEFORE only, AFTER only, or both
- **Fuzzy column matching**: exact → case-insensitive → Levenshtein → data fingerprint
- **Row analysis**: count delta, which rows removed, pattern in removed rows
- **Data fingerprinting**: type, cardinality, null rate, sample hash, value range
- **Sort detection**: is AFTER sorted? On which column? ASC/DESC?
- **Format detection**: date patterns, whitespace changes, casing changes
- **Value comparison**: sampled row-by-row for matched columns

### Phase 2: AI Inference (Model-Agnostic)

Only called for ambiguous cases Phase 1 couldn't resolve:

- New columns that appear calculated — infer the formula
- Row removals that don't match a simple filter
- Multiple possible column renames (fingerprint ambiguity)
- Complex transforms (pivot, unpivot, multi-source merge)

The AI receives: structural diff JSON + 50-row sample from each file + user description.
The AI returns: JSON array of ForgeStep objects with confidence scores.

### Phase 3: Validation

Run the generated blueprint against the original BEFORE file. Compare output to the user's AFTER file cell-by-cell. Report match percentage and flag discrepancies.

## 7. LLM Provider Abstraction

Model-agnostic. Cheap for testing (Grok, Groq), heavy for production (Claude, GPT-4o).

```typescript
// src/lib/llm/types.ts
interface LlmProvider {
  name: string;
  chat(request: LlmChatRequest): Promise<LlmChatResponse>;
}

interface LlmChatRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  responseFormat?: { type: "json_object" };
  maxTokens?: number;
}

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmChatResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
```

**Providers:** OpenAI-compatible format covers most (Grok, Groq, OpenAI, Together, Fireworks). Anthropic needs its own adapter (Messages API format differs).

**Config:**
```env
LLM_PROVIDER=xai
LLM_MODEL=grok-2
LLM_API_KEY=xai-xxx
LLM_BASE_URL=           # Optional custom endpoint
```

## 8. Prompt Architecture

Prompts are **separate files**, not embedded in code. Testable, versionable, refinable independently.

```
src/lib/mjolnir/
  prompts/
    analyze-columns.txt      — Infer column relationships
    infer-formula.txt        — Reverse-engineer calculated columns
    detect-filters.txt       — Understand row removal patterns
    classify-ambiguous.txt   — Handle uncertain transformations
  engine/
    structural-diff.ts       — Phase 1
    ai-inference.ts          — Phase 2
    validation.ts            — Phase 3
    blueprint-executor.ts    — Runtime execution (no AI)
  index.ts                   — Public API: analyze(), execute(), validate()
```

**Prompt testing CLI:**
```bash
npm run mjolnir:test-prompt -- --prompt analyze-columns --input samples/vendor-feed --model grok-2
npm run mjolnir:test-prompt -- --prompt analyze-columns --input samples/vendor-feed --model gpt-4o-mini
```

Compare model outputs side-by-side. Refine prompts without touching code.

## 9. File Upload API

```
POST /api/mjolnir/upload
Content-Type: multipart/form-data
Body: file (.xlsx), type ("before" | "after")
Response: { fileId, filename, columns, rowCount, sampleRows }
```

Next.js App Router `request.formData()` — no external library. ExcelJS parses the file. Temp storage cleaned up after blueprint creation.

## 10. File Structure

```
src/lib/
  llm/
    types.ts              — LlmProvider interface, request/response types
    index.ts              — getLlmProvider() factory
    providers/
      openai-compatible.ts — Works for OpenAI, xAI, Groq, Together
      anthropic.ts         — Claude Messages API adapter
  mjolnir/
    prompts/              — .txt prompt templates
    engine/
      structural-diff.ts  — Phase 1: deterministic diff
      fingerprint.ts      — Column data fingerprinting
      ai-inference.ts     — Phase 2: LLM calls
      validation.ts       — Phase 3: test run comparison
      blueprint-executor.ts — Runtime: execute steps
      expression-parser.ts  — Formula evaluation for "calculate" steps
    types.ts              — ForgeStep, ForgeStepType, etc.
    index.ts              — Public API

src/app/
  (app)/mjolnir/
    page.tsx              — Mjolnir UI (upload, review, test, save)
  api/mjolnir/
    upload/route.ts       — File upload endpoint
    analyze/route.ts      — Trigger analysis (Phase 1 + 2)
    validate/route.ts     — Run test comparison (Phase 3)
    blueprints/route.ts   — CRUD for blueprints
```

## 11. What We Build First

1. **LLM abstraction** (`src/lib/llm/`) — provider interface + OpenAI-compatible adapter
2. **Structural diff engine** (`src/lib/mjolnir/engine/structural-diff.ts`) — the deterministic Phase 1
3. **File upload API** — parse Excel, return columns + sample rows
4. **AI inference** — prompts + Phase 2 engine
5. **Blueprint executor** — run steps against data
6. **Validation** — Phase 3 comparison
7. **Mjolnir UI page** — upload, review, test, save

Build each piece. Test it. Refine it. Move to the next.

## 12. Open Questions (Will Learn by Building)

- Right prompt structure for each analysis task (test with real before/after files)
- Expression parser scope — how much of Excel's formula language do we need?
- Where uploaded files live (temp dir vs. persistent storage)
- Blueprint versioning UX — how does the user manage versions?
- How blueprints attach to scheduled jobs (Route model comes later)
- Confidence thresholds — what's the right cutoff for auto-include vs. ask?

---

*"I am Mjolnir. Show me what you want. I will remember. I will repeat.
I will never forget, and I will never tire."*
