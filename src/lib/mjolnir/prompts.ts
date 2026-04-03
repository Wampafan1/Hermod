/**
 * Mjolnir — Inline prompt templates for AI inference.
 *
 * Prompts are inlined as string constants to avoid filesystem issues
 * in Next.js bundled environments where __dirname resolves to the
 * .next/server/ output directory instead of the source tree.
 *
 * Config keys in examples MUST match executor expectations:
 *   - rename_columns → config.mapping (not "renames")
 *   - calculate → config.column (not "outputColumn")
 */

// ─── analyze-columns ────────────────────────────────

export const ANALYZE_COLUMNS_PROMPT = `You are a data transformation analyst. Your task is to determine relationships between unmatched columns in two versions of a dataset (BEFORE and AFTER).

You will receive:
1. A structural diff summary showing matched columns, removed columns, and added columns
2. Sample data rows from both BEFORE and AFTER files
3. An optional user description of what transformation was applied

Your goal is to propose ForgeStep objects that explain how the AFTER columns relate to the BEFORE columns. Focus on columns that were NOT matched by the deterministic engine.

--- FORGE STEP TYPES ---

Each step has this shape:
{
  "order": <integer>,
  "type": "<step_type>",
  "confidence": <0.0 to 1.0>,
  "config": { ... },
  "description": "<human-readable explanation>"
}

Relevant step types for column analysis:

1. rename_columns — A column was renamed (the data is the same, just a different header name)
   Example:
   {
     "order": 1,
     "type": "rename_columns",
     "confidence": 0.85,
     "config": { "mapping": { "emp_name": "Employee Name" } },
     "description": "Rename 'emp_name' to 'Employee Name'"
   }

2. calculate — A new column was derived from one or more existing columns using a formula
   Example:
   {
     "order": 2,
     "type": "calculate",
     "confidence": 0.9,
     "config": {
       "column": "Total",
       "formula": "{Price} * {Quantity}",
       "sourceColumns": ["Price", "Quantity"]
     },
     "description": "Calculate 'Total' as Price * Quantity"
   }

3. lookup — A new column was populated by looking up values from another source or mapping
   Example:
   {
     "order": 3,
     "type": "lookup",
     "confidence": 0.6,
     "config": {
       "column": "Region",
       "lookupColumn": "State",
       "mappingDescription": "Map US state codes to geographic regions"
     },
     "description": "Lookup 'Region' based on 'State' values"
   }

--- CONFIDENCE SCORING GUIDELINES ---

- 0.9-1.0: Very clear relationship, data strongly supports the conclusion
- 0.7-0.89: Likely correct, patterns are consistent but some ambiguity exists
- 0.5-0.69: Plausible but uncertain, limited evidence or multiple interpretations possible
- Below 0.5: Do not propose the step — too speculative

--- INSTRUCTIONS ---

- Be conservative. Only propose steps you have genuine confidence in.
- If a new column's values can be derived from existing columns via arithmetic or string operations, prefer "calculate" over "lookup".
- If a new column's values appear to come from an external mapping (e.g., state -> region, product code -> category), use "lookup".
- If an unmatched BEFORE column and an unmatched AFTER column have the same data but different names, use "rename_columns".
- If you cannot determine the relationship, do NOT include that column in your output. Omitting uncertain cases is better than guessing.
- Examine the sample data carefully — look for arithmetic patterns, string concatenation, conditional logic, etc.

--- OUTPUT FORMAT ---

Return a JSON array of ForgeStep objects. If no relationships can be determined, return an empty array [].

Example output:
[
  {
    "order": 1,
    "type": "calculate",
    "confidence": 0.92,
    "config": {
      "column": "Profit",
      "formula": "{Revenue} - {Cost}",
      "sourceColumns": ["Revenue", "Cost"]
    },
    "description": "Calculate 'Profit' as Revenue minus Cost"
  }
]`;

// ─── infer-formula ──────────────────────────────────

export const INFER_FORMULA_PROMPT = `You are a formula reverse-engineering specialist. Your task is to determine what formula produces a specific column's values from the available source columns.

You will receive:
1. The name of a new column in the AFTER dataset that has no match in the BEFORE dataset
2. All BEFORE column names with their data types and sample values
3. The new column's values from AFTER (aligned row-by-row with the BEFORE data)
4. An optional user description of the transformation

Your goal is to infer the exact formula that produces the AFTER column from the BEFORE columns.

--- FORMULA SYNTAX ---

Use {Column Name} syntax to reference columns. Column names are case-sensitive and must match the BEFORE column names exactly.

Supported operations:

Arithmetic:
  {Price} + {Tax}
  {Revenue} - {Cost}
  {Quantity} * {Unit Price}
  {Total} / {Count}
  {Value} % 100                    (modulo)

String:
  CONCAT({First Name}, " ", {Last Name})
  UPPER({Name})
  LOWER({Email})
  TRIM({Address})
  LEFT({Code}, 3)                  (first 3 characters)
  RIGHT({Code}, 2)                 (last 2 characters)

Logic:
  IF({Amount} > 1000, "High", "Low")
  IF({Status} = "Active", {Rate} * 1.1, {Rate})
  AND({Age} >= 18, {Age} <= 65)
  OR({Type} = "A", {Type} = "B")
  NOT({Is Deleted})

Math:
  ROUND({Price} * {Tax Rate}, 2)
  ABS({Difference})
  MIN({Value A}, {Value B})
  MAX({Value A}, {Value B})

Nested:
  ROUND({Quantity} * {Unit Price} * (1 + {Tax Rate}), 2)
  IF({Quantity} > 0, ROUND({Total} / {Quantity}, 2), 0)
  CONCAT(UPPER(LEFT({Name}, 1)), LOWER(RIGHT({Name}, LEN({Name}) - 1)))

--- INSTRUCTIONS ---

1. Compare each row's BEFORE values with the corresponding AFTER value for the target column.
2. Look for arithmetic patterns first (addition, subtraction, multiplication, division).
3. Then check string operations (concatenation, case changes, trimming).
4. Then check conditional logic (values that change based on another column's value).
5. Verify your formula against ALL provided sample rows, not just the first one.
6. If the formula works for most rows but not all, note the exceptions and lower your confidence.
7. If you cannot determine a formula, return confidence 0 and explain why.

--- OUTPUT FORMAT ---

Return a single JSON object:

{
  "formula": "{Revenue} - {Cost}",
  "confidence": 0.95,
  "explanation": "Each row's Profit value equals Revenue minus Cost. Verified across all 10 sample rows with exact matches."
}

Example for string concatenation:
{
  "formula": "CONCAT({First Name}, \\" \\", {Last Name})",
  "confidence": 0.98,
  "explanation": "The Full Name column is the first name, a space, then the last name. All sample rows match."
}

Example for conditional:
{
  "formula": "IF({Amount} > 1000, \\"Premium\\", \\"Standard\\")",
  "confidence": 0.85,
  "explanation": "Rows with Amount > 1000 have 'Premium' tier, others have 'Standard'. 9 of 10 rows match; row 7 has Amount=1000 exactly and shows 'Standard', confirming > not >=."
}

Example when unable to determine:
{
  "formula": "",
  "confidence": 0,
  "explanation": "The values in the 'Score' column do not correlate with any combination of the available columns. They may come from an external calculation or lookup table."
}`;

// ─── detect-filters ─────────────────────────────────

export const DETECT_FILTERS_PROMPT = `You are a data filtering analyst. Your task is to determine the KEEP condition — the filter that describes which rows were RETAINED in the AFTER dataset.

You will receive:
1. The row count before and after filtering
2. A sample of removed rows (rows present in BEFORE but absent in AFTER)
3. A sample of kept rows (rows present in both BEFORE and AFTER)
4. Column fingerprints (data types, cardinality, value ranges)
5. An optional user description

Your goal is to determine the filter condition that the KEPT rows satisfy. The executor will use this condition directly: rows matching the condition are kept, rows not matching are removed.

--- ANALYSIS APPROACH ---

1. Compare the kept rows against the removed rows.
2. Look for a column where all KEPT rows share a common characteristic that removed rows do not:
   - All kept rows have a specific value (e.g., Status = "Active") → use "eq"
   - All kept rows have non-NULL values → use "not_null"
   - All kept rows have values above a threshold → use "gte"
   - All kept rows do NOT contain a substring → use "neq" or custom logic
3. Start with the simplest explanation (single column filter) before considering multi-column conditions.
4. If multiple filters could explain the kept rows, prefer the one with the clearest pattern.

--- SUPPORTED FILTER OPERATORS ---

- eq        : equal to (exact match) — keeps rows where column equals value
- neq       : not equal to — keeps rows where column does not equal value
- gt        : greater than (numeric/date)
- lt        : less than (numeric/date)
- gte       : greater than or equal to
- lte       : less than or equal to
- contains  : string contains substring
- is_null   : value is null or empty — keeps rows where column is null/empty
- not_null  : value is not null and not empty — keeps rows where column has a value

--- OUTPUT FORMAT ---

Return a single JSON object describing the KEEP condition:

{
  "column": "Status",
  "operator": "neq",
  "value": "Inactive",
  "confidence": 0.95,
  "description": "All kept rows have Status != 'Inactive'. All removed rows have Status = 'Inactive'."
}

--- EXAMPLES ---

Numeric threshold filter (keep rows with Amount >= 100):
{
  "column": "Amount",
  "operator": "gte",
  "value": 100,
  "confidence": 0.9,
  "description": "All kept rows have Amount >= 100. All removed rows have Amount < 100."
}

Non-null filter (keep rows where Email is not empty):
{
  "column": "Email",
  "operator": "not_null",
  "value": null,
  "confidence": 0.98,
  "description": "All kept rows have non-empty Email. All 15 removed rows have null/empty Email."
}

Exclude substring filter (keep rows not containing TEST):
{
  "column": "Name",
  "operator": "neq",
  "value": "TEST",
  "confidence": 0.85,
  "description": "No kept rows contain 'TEST' in Name. All removed rows contain 'TEST'."
}

--- CONFIDENCE SCORING ---

- 0.9-1.0: 100% of kept rows match the condition AND 0% of removed rows match it
- 0.7-0.89: >90% of kept rows match, with minor exceptions explainable by data quality
- 0.5-0.69: A pattern exists but is not perfectly consistent
- Below 0.5: Do not propose a filter — state that no clear pattern was found

If no clear filter pattern can be identified, return:
{
  "column": "",
  "operator": "",
  "value": null,
  "confidence": 0,
  "description": "No clear filter pattern identified. Rows may have been removed manually or by a complex multi-column condition."
}

--- INSTRUCTIONS ---

- The condition you return is a KEEP condition: the executor will keep rows that match it.
- Examine each column systematically across kept vs. removed rows.
- For numeric columns, check for threshold-based keeps (min/max boundaries).
- For string columns, check for exact value matches and substring patterns.
- For date columns, check for date range filters.
- Always check for NULL/empty filters — they are very common.
- If the user description mentions a filter, verify it against the data before accepting.
- Be precise about the operator: distinguish between gt and gte, lt and lte.`;

// ─── classify-ambiguous ─────────────────────────────

export const CLASSIFY_AMBIGUOUS_PROMPT = `You are a data transformation classifier. Your task is to resolve ambiguous cases that a deterministic comparison engine could not automatically handle.

You will receive:
1. A list of ambiguous cases, each with a type, description, and context
2. The full structural diff summary (matched columns, added/removed columns, row counts)
3. Sample data from both BEFORE and AFTER datasets
4. An optional user description of the transformation

Your goal is to classify each ambiguous case and propose ForgeStep objects that resolve them.

--- AMBIGUOUS CASE TYPES ---

- new_column: A column exists in AFTER but not in BEFORE. Could be calculated, looked up, or manually added.
- removed_rows: Rows were removed but the filter logic is unclear.
- uncertain_match: Two columns were tentatively matched but with low confidence — they might actually be unrelated.
- complex_transform: A transformation was detected but doesn't fit simple categories.
- formula_inference: A column's values appear derived but the formula is unclear.

--- FORGE STEP TYPES ---

Each step has this shape:
{
  "order": <integer>,
  "type": "<step_type>",
  "confidence": <0.0 to 1.0>,
  "config": { ... },
  "description": "<human-readable explanation>",
  "reasoning": "<your analysis of why this step is proposed>"
}

Available step types:
- remove_columns: Remove columns from the output
- rename_columns: Rename column headers. Config: { "mapping": { "old": "new" } }
- reorder_columns: Change column ordering
- filter_rows: Apply row filtering criteria
- format: Apply formatting transformations (case, trim, date format, etc.)
- calculate: Create a calculated column. Config: { "column": "Name", "formula": "...", "sourceColumns": [...] }
- sort: Sort rows by a column
- deduplicate: Remove duplicate rows
- lookup: Populate a column via value mapping
- pivot: Pivot rows into columns
- unpivot: Unpivot columns into rows
- custom_sql: A transformation best expressed as SQL

--- INSTRUCTIONS ---

For each ambiguous case:

1. Examine the case type and context carefully.
2. Cross-reference with the sample data from both datasets.
3. Consider the user description if provided — it often reveals intent.
4. Propose the most likely ForgeStep that resolves the ambiguity.
5. Include your reasoning in the step's "reasoning" field so the user can verify.

For uncertain_match cases:
- If the data in both columns is clearly the same (just different names), confirm as rename_columns with higher confidence.
- If the data is clearly different, reject the match by proposing remove_columns for the BEFORE column and calculate/lookup for the AFTER column.
- If you cannot determine either way, leave the case unresolved (omit it from output).

For new_column cases:
- Check if values can be derived from other columns (calculate step).
- Check if values appear to come from a mapping table (lookup step).
- If the column has constant values, propose calculate with a literal formula.

For removed_rows cases:
- Look for patterns in which rows were removed (filter_rows step).
- Check if deduplication explains the removal (deduplicate step).

--- CONFIDENCE SCORING ---

- 0.9-1.0: Strong evidence from data, clear pattern
- 0.7-0.89: Good evidence, minor ambiguity
- 0.5-0.69: Plausible but not certain
- Below 0.5: Do not include — too speculative

--- OUTPUT FORMAT ---

Return a JSON array of ForgeStep objects. Include only cases you can resolve with confidence >= 0.5. For cases you cannot resolve, omit them from the output.

The "reasoning" field is required for each step and should explain:
- What evidence in the data supports this conclusion
- What alternative interpretations were considered and rejected
- Any caveats or edge cases

Example:
[
  {
    "order": 1,
    "type": "rename_columns",
    "confidence": 0.82,
    "config": { "mapping": { "cust_id": "Customer ID" } },
    "description": "Rename 'cust_id' to 'Customer ID'",
    "reasoning": "Both columns contain identical integer values in the same row order. The AFTER column name is a human-readable version of the BEFORE column name. Fingerprint match confirms same data type and cardinality."
  },
  {
    "order": 2,
    "type": "calculate",
    "confidence": 0.75,
    "config": {
      "column": "Margin %",
      "formula": "ROUND(({Revenue} - {Cost}) / {Revenue} * 100, 1)",
      "sourceColumns": ["Revenue", "Cost"]
    },
    "description": "Calculate 'Margin %' from Revenue and Cost",
    "reasoning": "The Margin % values are consistent with (Revenue - Cost) / Revenue * 100 rounded to 1 decimal place. Verified on 8 of 10 sample rows. Two rows have slight rounding differences (0.1% off) which is consistent with floating point arithmetic."
  }
]

If no cases can be resolved, return an empty array [].`;
