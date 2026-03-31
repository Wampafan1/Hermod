"use client";

import type {
  ValidationResult,
  ColumnValidation,
  Mismatch,
  PatternCheck,
} from "@/lib/mjolnir/engine/validation";

interface ValidationReportProps {
  result: ValidationResult;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(null)";
  if (typeof value === "string") return value || "(empty)";
  return String(value);
}

const STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  pass: { icon: "✓", color: "text-gold" },
  warn: { icon: "⚠", color: "text-frost" },
  fail: { icon: "✗", color: "text-ember" },
};

const CATEGORY_LABELS: Record<string, string> = {
  column_structure: "Column Structure",
  formula: "Formula",
  format: "Format",
  rename: "Renames",
  row_count: "Row Count",
};

function PatternCheckRow({ check }: { check: PatternCheck }) {
  const style = STATUS_STYLES[check.status] ?? STATUS_STYLES.fail;
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border/30">
      <span className={`${style.color} text-xs w-4 flex-shrink-0 mt-0.5`}>
        {style.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-dim text-[0.625rem] tracking-wider uppercase">
            {CATEGORY_LABELS[check.category] ?? check.category}
          </span>
        </div>
        <p className="text-text text-xs tracking-wide mt-0.5">
          {check.description}
        </p>
        {check.details && (
          <p className="text-text-dim/80 text-[0.625rem] tracking-wide mt-0.5">
            {check.details}
          </p>
        )}
      </div>
    </div>
  );
}

export function ValidationReport({ result }: ValidationReportProps) {
  const pct = Math.round(result.overallMatchRate * 100);
  const isPass = result.passed;
  const isPatternMode = result.rowMatchMode === "pattern";

  // Sort columns by match rate ascending (worst first)
  const sortedColumns = [...result.columnValidations].sort(
    (a, b) => a.matchRate - b.matchRate
  );

  // Cap displayed mismatches at 50
  const displayedMismatches = result.mismatches.slice(0, 50);

  return (
    <div className="space-y-6">
      {/* Overall score */}
      <div className="flex items-center gap-6">
        <div>
          <span
            className={`text-4xl font-cinzel tracking-wider ${
              isPass ? "text-gold-bright" : "text-ember"
            }`}
          >
            {pct}%
          </span>
          <span className="text-text-dim text-xs tracking-wide ml-2">
            {isPatternMode ? "pattern score" : "match rate"}
          </span>
        </div>
        <span className={isPass ? "badge-success" : "badge-error"}>
          {isPass ? "Passed" : "Failed"}
        </span>
      </div>

      {/* Summary line */}
      <p className="text-text-dim text-xs tracking-wide">
        {isPatternMode ? (
          <>
            Pattern validation — {result.patternChecks?.filter((c) => c.status === "pass").length ?? 0} of{" "}
            {result.patternChecks?.length ?? 0} checks passed
            across {result.columnValidations.length} columns.
          </>
        ) : (
          <>
            {result.matchedCells.toLocaleString()} of{" "}
            {result.totalCells.toLocaleString()} cells matched across{" "}
            {result.columnValidations.length} columns.
            {result.rowMatchMode === "key" && result.keyColumn && (
              <span className="text-frost ml-1">
                (rows matched by "{result.keyColumn}")
              </span>
            )}
          </>
        )}
      </p>

      {/* Pattern checks (pattern mode only) */}
      {isPatternMode && result.patternChecks && result.patternChecks.length > 0 && (
        <div className="space-y-2">
          <p className="label-norse">Pattern Checks</p>
          <div className="space-y-0">
            {result.patternChecks.map((check: PatternCheck, i: number) => (
              <PatternCheckRow key={`${check.category}-${i}`} check={check} />
            ))}
          </div>
        </div>
      )}

      {/* Per-column bars */}
      {sortedColumns.length > 0 && (
        <div className="space-y-2">
          <p className="label-norse">
            {isPatternMode ? "Column Coverage" : "Column Match Rates"}
          </p>
          <div className="space-y-1">
            {sortedColumns.map((col: ColumnValidation) => {
              const colPct = Math.round(col.matchRate * 100);
              return (
                <div key={col.column} className="flex items-center gap-3">
                  <span className="text-text-dim text-xs tracking-wide w-36 truncate flex-shrink-0">
                    {col.column}
                  </span>
                  <div className="flex-1 h-1.5 bg-void/50 border border-border overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        col.matchRate >= 0.95 ? "bg-gold" : "bg-ember"
                      }`}
                      style={{ width: `${colPct}%` }}
                    />
                  </div>
                  <span
                    className={`text-xs tracking-wide w-10 text-right flex-shrink-0 ${
                      col.matchRate >= 0.95 ? "text-gold" : "text-ember"
                    }`}
                  >
                    {colPct}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unmatched row info (strict mode with key matching) */}
      {!isPatternMode && result.rowMatchMode === "key" && (
        (result.unmatchedAfterRows > 0 || result.unmatchedExecutedRows > 0) && (
          <p className="text-text-dim/80 text-[0.625rem] tracking-wider">
            {result.unmatchedAfterRows > 0 &&
              `${result.unmatchedAfterRows} AFTER row(s) had no match in executed output. `}
            {result.unmatchedExecutedRows > 0 &&
              `${result.unmatchedExecutedRows} executed row(s) had no match in AFTER.`}
          </p>
        )
      )}

      {/* Unsupported steps warning */}
      {result.unsupportedSteps.length > 0 && (
        <div className="space-y-1">
          <p className="text-ember text-xs tracking-wide">
            {result.unsupportedSteps.length} unsupported step(s) — these were skipped:
          </p>
          <ul className="text-text-dim/80 text-[0.625rem] tracking-wide list-disc list-inside">
            {result.unsupportedSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Mismatch table (strict mode only) */}
      {!isPatternMode && displayedMismatches.length > 0 && (
        <div className="space-y-2">
          <p className="label-norse">Mismatches</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="text-left py-2 px-3 text-text-dim tracking-wide uppercase font-normal text-[0.625rem]">
                    Row
                  </th>
                  <th scope="col" className="text-left py-2 px-3 text-text-dim tracking-wide uppercase font-normal text-[0.625rem]">
                    Column
                  </th>
                  <th scope="col" className="text-left py-2 px-3 text-text-dim tracking-wide uppercase font-normal text-[0.625rem]">
                    Expected
                  </th>
                  <th scope="col" className="text-left py-2 px-3 text-text-dim tracking-wide uppercase font-normal text-[0.625rem]">
                    Actual
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedMismatches.map((m: Mismatch, i: number) => (
                  <tr
                    key={`${m.row}-${m.column}-${i}`}
                    className="border-b border-border/50"
                  >
                    <td className="py-1.5 px-3 text-text-dim">{m.row}</td>
                    <td className="py-1.5 px-3 text-text">{m.column}</td>
                    <td className="py-1.5 px-3 text-text-dim">
                      {formatValue(m.expected)}
                    </td>
                    <td className="py-1.5 px-3 text-ember">
                      {formatValue(m.actual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.mismatches.length > 50 && (
            <p className="text-text-dim/80 text-[0.625rem] tracking-wider">
              Showing 50 of {result.mismatches.length} mismatches.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
