# NetSuite Record Joins — Design

**Date:** 2026-04-17
**Status:** Draft — approved for implementation
**Scope:** Bifrost route builder, NetSuite provider

---

## Problem

In the Bifrost route builder, users selecting a NetSuite record type can only pick fields that live on that record. For transaction line data this is a dead end: users need custcol_* fields (line-level customs, on `transactionline`) alongside header context (trandate, entity, custbody_* — on `transaction`) and item context (itemid, custitem_* — on `item`). Today the UI forces one record type per route and offers no way to join. Output is either header-only or line-only, never useful together.

This is not a field-discovery bug. `getRecordFields` already returns custcol_* fields correctly when `recordType=transactionline`. The gap is that the builder cannot express a join.

## Decision

Add a **curated, hardcoded join system** to the route builder. After picking a primary record, users can add one or more related records as joins. Each join gets its own field picker. Output columns from joined records are alias-prefixed to avoid collisions.

**Non-goals for v1:**
- Per-field reference expansion (custcol pointing at another record → pull fields from that referenced record). The catalog has the metadata to support this; defer until the curated joins prove insufficient.
- Auto-discovered joins from reference fields. Hardcoded is simpler, predictable, reviewable.
- Multi-hop joins (transactionline → transaction → entity in one chain). Users can add both joins independently; the builder emits both `LEFT JOIN`s off the primary.

## Data Model

```ts
// sync-builder state
nsJoins: NsJoin[]

type NsJoin = {
  recordType: string;   // e.g. "transaction"
  alias: string;        // e.g. "tx"
  fields: string[];     // field names selected from the joined record
};
```

Alias is assigned from `NS_JOIN_KEYS` (not user-editable) so SQL is deterministic and testable.

## Curated Join Table

Lives in `src/lib/providers/netsuite.provider.ts`:

```ts
const NS_JOIN_KEYS = {
  "transactionline->transaction": { alias: "tx",   on: "transactionline.transaction = tx.id" },
  "transactionline->item":        { alias: "item", on: "transactionline.item = item.id" },
  "transaction->entity":          { alias: "ent",  on: "transaction.entity = ent.id" },
};
```

Expansion path: add more entries as user demand arises. No code changes required beyond the map.

## SuiteQL Emission

`buildSuiteQL` gains an optional `joins?: NsJoin[]` parameter.

Example output:

```sql
SELECT
  transactionline.id,
  transactionline.custcol_warehouse,
  tx.trandate AS tx_trandate,
  tx.entity   AS tx_entity,
  item.itemid AS item_itemid
FROM transactionline
LEFT JOIN transaction tx   ON transactionline.transaction = tx.id
LEFT JOIN item        item ON transactionline.item        = item.id
WHERE tx.trandate >= '2026-01-01'
ORDER BY transactionline.id ASC
```

Rules:
- When any join is present, primary record fields are prefixed with the primary table name (`transactionline.id`) to disambiguate.
- Joined fields always emit `alias.field AS alias_field`.
- `LEFT JOIN` — missing parents surface as nulls rather than silently dropping rows.
- `ORDER BY` unchanged (primary record's `id` when selected).
- `validateSuiteQLField` applies to joined fields identically.
- New `validateJoin(primary, joinRecordType)` rejects pairs absent from `NS_JOIN_KEYS`.

## UI Flow

Lives in `src/components/bifrost/sync-builder.tsx`, immediately below the primary field picker.

```
RECORD TYPE:  [transactionline ▾]

FIELDS FROM TRANSACTIONLINE
  [✓] id
  [✓] item
  [✓] custcol_warehouse
  ...

──── ᚱ ────

+ ADD FIELDS FROM RELATED RECORD  [▾]
    ├ transaction (header)
    └ item
```

Selecting a join:
1. Adds an entry to `nsJoins` with the alias from `NS_JOIN_KEYS`.
2. Fetches fields via existing `/api/bifrost/netsuite/fields?recordType=<joined>`.
3. Renders a second field-picker block, visually indented, labeled with the alias.
4. Users can × remove the whole join or check/uncheck fields individually.

Behavior:
- Changing `nsRecordType` resets `nsJoins` to `[]`.
- No nested search within joined field lists for v1 — primary record's search box is sufficient for now.
- `hasValidSource` is unchanged; joins are optional enrichment, primary record fields still gate "can run."

## Field Mapping

`derivedFieldMappings` (currently at `sync-builder.tsx:225`) flattens primary + joined fields:

```ts
const allFieldNames = [
  ...nsFields,
  ...nsJoins.flatMap(j => j.fields.map(f => `${j.alias}_${f}`)),
];
```

Destination column names use the alias prefix (`tx_trandate`) so Heimdall and downstream consumers see unambiguous columns.

## Tests

New file: `src/lib/providers/__tests__/netsuite-joins.test.ts`.

1. `buildSuiteQL` with no joins produces current output (regression guard).
2. One join → correct LEFT JOIN, aliased columns, primary fields prefixed.
3. Two joins on same primary → both emitted cleanly.
4. Invalid join pair rejected by `validateJoin`.
5. Injection attempt in joined field name rejected by `validateSuiteQLField`.
6. `getAvailableJoins("transactionline")` → `[transaction, item]`; `getAvailableJoins("customer")` → `[]`.
7. Filter clause referencing a joined alias passes through unchanged.

Sync-builder state tests (light, match existing patterns):

8. Changing `nsRecordType` clears `nsJoins`.
9. Removing a join clears its entries from `joinFieldLists` and `derivedFieldMappings`.

## Edge Cases

- **Alias collision** with a literal field named `tx_trandate` on `transaction`: won't happen in practice; add a TODO comment, don't solve.
- **Filter references a joined alias, then user removes the join**: query fails at NetSuite with a clear error; user edits filter. No cross-validation layer for v1.
- **Primary records with no joins configured** (e.g., `customer`, `vendor`): "+ Add fields from related record" affordance hidden.

## Implementation Sequence

1. Provider: `NS_JOIN_KEYS`, `getAvailableJoins`, `validateJoin`, extended `buildSuiteQL`.
2. Provider tests (items 1–7).
3. Sync-builder state: `nsJoins`, `joinFieldLists`, reset-on-record-type-change.
4. Sync-builder UI: "+ Add fields from related record" block + joined field pickers.
5. `derivedFieldMappings` flatten.
6. Sync-builder tests (items 8–9).
7. Manual verification: build a `transactionline + transaction` route end-to-end, run it, confirm output columns.

## Open Questions

None at time of writing. Revisit after v1 ships to decide whether reference-field expansion is needed.
