# Excel Schema Inference

## Formula And Footer Contamination

ExcelJS can expose formula cells as objects. When those objects reached `loadRows()`, Hermod wrote them to NDJSON and DuckDB `read_json_auto()` correctly inferred object-contaminated columns as JSON. Footer rows such as `Grand Total :` made this worse because summary formulas appeared in otherwise numeric columns.

## What Changed

- `excelCellToValue()` now returns only scalar values: string, number, boolean, Date, or null.
- Formula cells use cached `result` values when present.
- Formula cells without cached results return null instead of raw formula objects.
- Rich text and hyperlinks become display strings.
- Excel error cells and unknown object shapes become null.
- `loadExcel()` normalizes every Excel value before row assignment, so plain objects never reach DuckDB row JSON.
- `loadExcel()` stops at clear `Grand Total` footer rows and ignores rows after that footer.
- Date-like Excel headers such as `ETD` normalize Excel serial date numbers to ISO dates before DuckDB infers types.
- Schema drift tolerates old Excel serial-date snapshots stored as BIGINT when the new column is clearly date-like.
- Blank-header data columns keep their stable internal names, such as `column_20`, while Gate drift messaging displays them as `column_20 (blank header)`.

## Tests Added

- `src/__tests__/duckdb/excel-cell-normalization.test.ts`
- `src/__tests__/gates/schema-drift-excel.test.ts`

## Validation Results

- `npx prisma validate` passed.
- `npx prisma generate` initially hit the documented Windows Prisma locked-DLL `EPERM`; it passed after moving `node_modules/.prisma` aside and regenerating.
- Focused regression run passed: `npm run test -- excel-cell-normalization schema-drift-excel excel-layout` passed 3 files, 13 tests.
- `npm run test` passed: 132 files, 1526 tests.
- `npm run build` passed with existing Next/React lint warnings.
- `npm run lint` passed with existing warnings.

## Remaining Follow-Up

- If more report-specific footer labels appear, add them to the conservative footer detector only after seeing real examples.
