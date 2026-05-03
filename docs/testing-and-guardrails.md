# Hermod Testing and Guardrails

Hermod's regression guardrails are meant to fail fast when auth, tenant isolation, credentials, provider behavior, Bifrost routes, backups, restores, worker scheduling, or API contracts drift.

## Commands

Run the main checks locally:

```bash
npx prisma validate
npx prisma generate
npm run test
npm run check:secrets
npm run build
npm run lint
```

`npm run lint` is included in CI as a non-blocking job until the current lint baseline is confirmed clean.

## Test Categories

- `src/__tests__/validations/`: Zod schemas and update-schema compatibility.
- `src/__tests__/security/`: auth, tenant isolation, credential encryption, redaction, and response safety.
- `src/__tests__/contracts/`: API response shapes used by UI code.
- `src/__tests__/backups/`: storage layout, storage targets, coverage, restore validation, and backup engines.
- `src/__tests__/worker/`: singleton keys, due filters, stale-running thresholds, safe worker errors, and shutdown behavior.
- `src/__tests__/providers/`: provider scope behavior, discovery SQL, SQL quoting, and pool-key stability.

## Helpers

Use these lightweight helpers for new tests:

- `src/__tests__/helpers/mock-auth.ts` for deterministic session/auth context objects.
- `src/__tests__/helpers/mock-prisma.ts` for Prisma model mocks.
- `src/__tests__/helpers/factories.ts` for minimal valid Hermod objects.
- `src/__tests__/helpers/api-test.ts` for JSON requests, response parsing, credential-key assertions, and JSON-serialization checks.

## Adding API Contract Tests

Define a small Zod schema for the response shape the UI depends on, then validate a mocked API output or serializer output. Include checks that:

- Required UI fields are present.
- Credentials and secret-like fields are absent.
- BigInt fields are converted to strings before JSON responses.
- Dates are consistently accepted as serializable strings or Date objects.

## Adding Validation Tests

Use real schemas from `src/lib/validations`. Test both create and update schemas. Update schemas should not require unrelated fields and should not erase credentials unless a credential field is explicitly provided.

## Testing Credentials Safely

Use fake credential values only. Do not snapshot decrypted values. Prefer assertions like "encrypted value was passed to Prisma" or "response does not contain sensitive keys" instead of storing large credential fixtures.

Never use real:

- Database passwords
- AWS access keys
- GCP service account JSON
- OAuth refresh tokens
- Customer credentials

## Mocking Prisma and Auth

API unit tests should mock Prisma and auth. Do not connect to live Postgres, MSSQL, MySQL, BigQuery, AWS, or GCP services in unit tests. Use `createMockPrisma()` and route-local `withAuth` mocks when testing route scoping.

For direct auth behavior, mock `next-auth`'s `getServerSession` and import `withAuth` from `src/lib/api.ts`.

## CI Checks

`.github/workflows/ci.yml` runs on Node 20:

- `npm ci`
- `npx prisma validate`
- `npx prisma generate`
- `npm run test`
- `npm run check:secrets`
- `npm run build`
- non-blocking `npm run lint`

## Static Credential Scan

`npm run check:secrets` runs `scripts/check-no-credential-responses.ts`. It searches API route files for strong credential leak patterns such as raw `NextResponse.json(connection)` responses and console output containing credential-like names without redaction.

This scan is intentionally lightweight. It complements tests; it is not a substitute for response serializers and route-level credential tests.

## What Not To Do

- Do not snapshot secrets.
- Do not call live cloud services.
- Do not use real customer credentials.
- Do not remove guardrail tests to make builds pass.
- Do not weaken validation to satisfy a test.
- Do not broaden route access without an auth/tenant isolation test.
