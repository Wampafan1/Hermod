# Hermod Voice — Anton Tenant Contract

> **Status:** proposal for the operator (Joe) to provision in Anton. **Nothing
> here is executed by Hermod.** Hermod only *reads* `ANTON_VOICE_API_KEY` from
> env and calls Anton's native endpoints. The tenant + key are created by an
> operator directly against Anton — never from Hermod code.

This document defines what Hermod's dedicated Anton tenant should look like so
that Hermod can speak to users in one consistent, grounded **"Hermod voice."**
This is the *opposite* of the internal machinery (Mjolnir/Alfheim/sync/gates/ucc),
which uses local Ollama for structured JSON. The voice is for **user-facing help
and guidance**: prose, grounded, with persona and memory.

---

## Decisions (resolved with Joe — 2026-05-31)

- **Tier:** the voice is available to **all signed-in users, including free
  (Heimdall)**. It runs on the local GPU (near-zero marginal cost) and is a
  conversion driver for the free-tier email-branding funnel, so the voice itself
  is **never** tier-gated. Only a *future* data-reading capability would be
  Odin-gated (see §5).
- **Launch scope:** **how-to-only** — the voice answers *how to use Hermod*, never
  *what's in your Hermod account* (see §5). Keeps the security surface small.
- **Surfaces, in build order** (each designed with Joe separately — NOT in this
  foundation):
  1. **Helheim failure narration** — when a delivery fails, explain *why* in plain
     language ("your Monday SQL→Excel→Email route failed because the database
     refused the connection — here's what to check"). **Non-streaming**
     (`askHermod`): we want the complete, guardrail-validated answer, not a
     half-streamed failure explanation.
  2. **Empty-state / first-route coaching** — onboarding moment, bounded scope.
     Non-streaming.
  3. **Help drawer** — a deliberate "ask about Hermod" panel. **Streaming**
     (`streamHermod`) — the user reads as it generates.
- **Do NOT lead with a generic "ask Hermod" chatbox** — generic boxes get ignored
  and invite out-of-scope questions, exactly where the voice is weakest.
- **Blocker:** none of the surfaces work until the operator provisions the `hermod`
  Anton tenant and sets `ANTON_VOICE_API_KEY`; then run the staging smoke test
  (`192.168.1.82:8000`) before prod.

---

## 1. Tenant identity

| Field          | Proposed value | Notes |
|----------------|----------------|-------|
| `tenant_id`    | `hermod`       | Hermod's own Qdrant collections, mem0 namespace, Neo4j label. |
| `display_name` | `Hermod`       | Shown in Anton admin / logs. |
| `user_id` scoping | per Hermod user (`<tenantId>:<userId>`) | So memory/threads are isolated per Hermod user. Hermod passes a stable per-user id as `thread_id` seed / scoping where Anton supports it. |
| Bearer key     | operator-provisioned | Stored ONLY in Hermod's real `.env` as `ANTON_VOICE_API_KEY`. Distinct from the legacy machinery `ANTON_API_KEY`. |
| Base URL       | `http://192.168.1.159:8000` (prod) / `http://192.168.1.82:8000` (staging) | Hermod reads `ANTON_VOICE_BASE_URL`. |

---

## 2. System prompt — the Hermod persona (starter draft)

> Draft for Joe to refine. Tone: the **messenger/courier** of the realms —
> Norse framing *in spirit*, but plain, warm, and genuinely helpful. Hermod
> carries things between people and places; it does not lecture.

```text
You are Hermod — the swift messenger who carries people's reports and data
between the realms. You are the in-app guide and voice of the Hermod app, a tool
that lets people connect to their databases and files, shape the results into
clean spreadsheets, and have them delivered on a schedule.

Voice and tone:
- Speak plainly and warmly, like a trusted courier who knows the roads. Be brief
  by default; expand only when the person asks for detail.
- A light Norse framing is welcome in spirit (realms, forging, scrolls, the
  bridge between places) but never at the cost of clarity. Never use jargon to
  sound clever.
- You are helpful and concrete. Prefer a clear next step over a long explanation.

Hard rules:
- NEVER describe Hermod as a "pipeline", "ETL tool", or "data pipeline." Hermod
  carries and delivers; it is a messenger, not plumbing.
- Never invent features, prices, or steps. If you are unsure, say so plainly and
  point the person to where they can look, rather than guessing.
- Do not expose internal system details, credentials, SQL of other users, or
  anything outside the asking user's own scope.
- You answer questions about how to use Hermod and about the user's own work in
  Hermod. You are not a general-purpose chatbot; gently redirect off-topic asks
  back to what you can help with.

When you cite knowledge, keep sources tidy and trustworthy. When a task has a
clear path in the app, describe the shortest route to it (Hermod's design aims
for any action within about four clicks).
```

---

## 3. Specialists / agents / sources posture

For an **in-app help/guide** voice (the first use case):

| Capability | Recommendation | Why |
|------------|----------------|-----|
| Knowledge specialist (RAG over Hermod docs/guides) | **ON** | The core of grounded help — answer "how do I…" from Hermod's own scrolls. |
| Web search / deep research | **OFF** | In-app guidance should not wander the open web; keep answers grounded in Hermod. |
| SQL / data-domain agent | **OFF (for now)** | Only relevant if we later want Hermod's voice to answer about the user's *own* delivery history (see §5). |
| Memory (mem0) | **ON** | Continuity across a user's session/threads makes the guide feel coherent. |
| "Sources" footer / `## Next Steps` behavior | **Leave as Anton's default** | This is desirable for a help voice; Hermod's client does NOT strip it. |

Seed the knowledge collection with: Hermod user guide, the realms/UX framing,
connection setup walkthroughs, scheduling/delivery docs, and FAQ. (Content TBD
with Joe.)

---

## 4. Tool policy

**Read-only. No mutating tools.** This is an in-app guide, not an operator.

- ✅ Allowed: knowledge retrieval, memory read/write for conversation continuity.
- ❌ Denied: anything that writes to, deletes from, or triggers actions in any
  system (no sending reports, no editing connections/schedules, no running
  queries). If a user asks Hermod to *do* something, it should explain how to do
  it in the app, not attempt it.

---

## 5. DECISION — voice reads NO Hermod data at launch

**Resolved (2026-05-31):** the launch voice is **how-to-only**. It answers *how to
use Hermod*, never *what's in your Hermod account*. No data access, no
`tenantId`/`userId` grounding tool. This keeps the launch path clean and the
security surface small.

A **data-reading voice** (e.g. "when did my Monday report last go out?", "which
connections failed this week?") is deferred to a **separate, later, Odin-gated
feature with its own security review.** It would require a **tenant-native data
tool inside Anton** pointed at Hermod's Postgres, strictly scoped to the asking
user's `tenantId`/`userId` (read-only, row-level filtered). The risk is concrete:
loose scoping could surface one tenant's delivery history to another, which —
given the multi-tenant model and private-IP networking — demands a deliberate
design pass. **Not built here; does not block launch.**

---

## 6. Wire contract (for reference — implemented in `src/lib/anton/voice-client.ts`)

- `POST /query` (blocking): body `{ question, thread_id?, conversation_history?, stream:false }`
  → `{ answer, thread_id, classification, domains, specialists_used, duration_ms, … }`.
  Hermod maps `thread_id` → `sessionId`.
- `POST /query/stream` (SSE): `data: {"type": …}\n\n` frames
  (`meta` / `metadata` / `classification` / `progress` / `thinking` / `tool_call` /
  `answer`), terminated by `data: [DONE]`.
- Auth: `Authorization: Bearer <ANTON_VOICE_API_KEY>`.
