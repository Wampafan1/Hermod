# NetSuite → BigQuery Integration via Bifrost

**Date:** 2026-03-03
**Status:** Approved — implementing

## Decisions

1. **Extend Bifrost** — not a parallel system. NetSuiteProvider implements CloudProvider.
2. **TBA auth only** (Phase 1) — OAuth 2.0 deferred.
3. **Extra metadata methods** on provider class — CloudProvider interface unchanged.
4. **Enhance RouteEditor** — no new Sync Builder page.
5. **Structured sourceConfig** — `{ recordType, fields[], filter? }`, SuiteQL generated at runtime.
6. **Credentials in extras JSON** — encrypted at app layer, same pattern as BigQuery.

## File Changes

### New Files
- `src/lib/bifrost/providers/netsuite.provider.ts` — CloudProvider + metadata methods
- `src/app/api/bifrost/netsuite/record-types/route.ts` — list record types
- `src/app/api/bifrost/netsuite/fields/route.ts` — get fields for record type
- `src/app/api/bifrost/netsuite/saved-searches/route.ts` — list saved searches
- `src/app/api/bifrost/netsuite/test/route.ts` — test connection
- `src/__tests__/bifrost/netsuite-provider.test.ts` — provider tests

### Modified Files
- `prisma/schema.prisma` — add NETSUITE to DataSourceType enum
- `src/lib/bifrost/providers/index.ts` — register NetSuiteProvider
- `src/lib/bifrost/types.ts` — extend SourceConfig for NetSuite
- `src/lib/validations/connections.ts` — add NETSUITE validation
- `src/components/connections/source-picker.tsx` — add NetSuite option
- `src/components/connections/connection-form.tsx` — add NetSuite credential fields
- `src/components/bifrost/route-editor.tsx` — NetSuite source UI (table browser, field picker)

## Architecture

NetSuiteProvider.extract() generates SuiteQL from structured config, paginates via offset,
yields chunks as AsyncGenerator. BifrostEngine handles everything else unchanged.

TBA auth signs each request with HMAC-SHA256 per OAuth 1.0a spec.
