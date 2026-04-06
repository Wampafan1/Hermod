import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { analyzeSchema } from "@/lib/validations/mjolnir";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseExcelBuffer } from "@/lib/mjolnir/file-parser";
import { computeStructuralDiff } from "@/lib/mjolnir/engine/structural-diff";
import { runAiInference } from "@/lib/mjolnir/engine/ai-inference";
import { extractStyleTemplate } from "@/lib/mjolnir/engine/style-extractor";

// POST /api/mjolnir/analyze — run structural diff + AI inference
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = analyzeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const { beforeFileId, afterFileId, description } = parsed.data;
  const userDir = join(tmpdir(), "hermod-mjolnir", session.user.id);

  // Load uploaded files from temp storage
  let beforeBuffer: Buffer, afterBuffer: Buffer;
  try {
    beforeBuffer = await readFile(join(userDir, `${beforeFileId}.xlsx`));
    afterBuffer = await readFile(join(userDir, `${afterFileId}.xlsx`));
  } catch {
    return NextResponse.json(
      { error: "Uploaded files not found. Please re-upload." },
      { status: 404 }
    );
  }

  let before, after;
  try {
    before = await parseExcelBuffer(beforeBuffer, "before.xlsx", beforeFileId);
    after = await parseExcelBuffer(afterBuffer, "after.xlsx", afterFileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to parse uploaded file";
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  console.log("[MJOLNIR-DIAG] BEFORE parsed:", { columns: before.columns, columnCount: before.columns.length, rowCount: before.rowCount, headerRowIndex: before.headerRowIndex, formulaCount: before.formulas?.length ?? 0, columnGroups: before.columnGroups?.length ?? 0 });
  console.log("[MJOLNIR-DIAG] AFTER parsed:", { columns: after.columns, columnCount: after.columns.length, rowCount: after.rowCount, headerRowIndex: after.headerRowIndex, formulaCount: after.formulas?.length ?? 0, columnGroups: after.columnGroups?.length ?? 0 });

  // Phase 1: Structural diff
  const diff = computeStructuralDiff(before, after);

  console.log("[MJOLNIR-DIAG] Structural diff result:", { matchedColumns: diff.matchedColumns.length, removedColumns: diff.removedColumns, addedColumns: diff.addedColumns, deterministicStepCount: diff.deterministicSteps.length, deterministicStepTypes: diff.deterministicSteps.map(s => s.type), ambiguousCaseCount: diff.ambiguousCases.length, ambiguousCaseTypes: diff.ambiguousCases.map(c => c.type), formatChanges: diff.formatChanges.length, sortDetected: diff.sortDetected ?? null, reorderDetected: diff.reorderDetected });

  // Phase 2: AI inference (only if there are ambiguous cases)
  const aiResult = await runAiInference(diff, before, after, description);

  console.log("[MJOLNIR-DIAG] AI inference result:", { stepCount: aiResult.steps.length, stepTypes: aiResult.steps.map(s => `${s.type}(order:${s.order}, conf:${s.confidence})`), warnings: aiResult.warnings });

  const allSteps = [...diff.deterministicSteps, ...aiResult.steps]
    .sort((a, b) => a.order - b.order);

  // Post-process: replace pre-rename column names in AI-generated formulas.
  // The AI sees BEFORE column names in sample data but rename steps run first,
  // so calculate steps must reference post-rename (AFTER) names.
  const renameStep = diff.deterministicSteps.find(s => s.type === "rename_columns");
  if (renameStep) {
    const mapping = renameStep.config.mapping as Record<string, string>;
    for (const s of allSteps) {
      if (s.type === "calculate") {
        let formula = s.config.formula as string;
        const sourceColumns = s.config.sourceColumns as string[] | undefined;

        for (const [beforeName, afterName] of Object.entries(mapping)) {
          formula = formula.replace(
            new RegExp(`\\{${beforeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g"),
            `{${afterName}}`
          );
        }
        s.config.formula = formula;

        if (sourceColumns) {
          s.config.sourceColumns = sourceColumns.map(sc => mapping[sc] ?? sc);
        }
      }
    }
  }

  console.log("[MJOLNIR-DIAG] Final merged steps:", JSON.stringify(allSteps, null, 2));

  // Phase 3: Extract AFTER workbook formatting for pixel-perfect mirror
  let afterFormatting = null;
  try {
    afterFormatting = await extractStyleTemplate(
      afterBuffer,
      after.headerRowIndex,
      after.columns,
      after.columnIndices
    );
  } catch (err) {
    console.error("Style extraction failed:", err);
    // Non-fatal — blueprint still works, just without formatting mirror
  }

  return NextResponse.json({
    steps: allSteps,
    diff: {
      matchedColumns: diff.matchedColumns,
      removedColumns: diff.removedColumns,
      addedColumns: diff.addedColumns,
      beforeRowCount: diff.beforeRowCount,
      afterRowCount: diff.afterRowCount,
      sortDetected: diff.sortDetected,
      formatChanges: diff.formatChanges,
      reorderDetected: diff.reorderDetected,
      ambiguousCases: diff.ambiguousCases,
    },
    afterFormatting,
    warnings: aiResult.warnings,
  });
});
