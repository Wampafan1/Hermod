import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requireTierFeature } from "@/lib/tier-gate";
import { validateSchema } from "@/lib/validations/mjolnir";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { parseExcelBuffer } from "@/lib/mjolnir/file-parser";
import { validateBlueprint } from "@/lib/mjolnir/engine/validation";

// POST /api/mjolnir/validate — validate a blueprint against BEFORE/AFTER data
export const POST = withAuth(async (req, session) => {
  const denied = await requireTierFeature(session.tenantId, "mjolnirAiForge", "Mjölnir AI Forge");
  if (denied) return denied;

  const body = await req.json();
  const parsed = validateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0].message },
      { status: 400 }
    );
  }

  const { steps, beforeFileId, afterFileId, mode } = parsed.data;
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

  // Run validation
  const result = validateBlueprint(steps, before, after, mode);

  return NextResponse.json(result);
});
