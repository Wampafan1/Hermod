import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { generateChangeSummary } from "@/lib/mjolnir/blueprint-versioning";
import type { ForgeStep } from "@/lib/mjolnir/types";

// GET /api/blueprints/[routeId]/diff/[fromVersion]/[toVersion]
export const GET = withAuth(async (req, session) => {
  const afterBlueprints = req.url.split("/blueprints/")[1];
  const parts = afterBlueprints?.split("/");
  // parts: [routeId, "diff", fromVersion, toVersion, ...]
  const routeId = parts?.[0];
  const fromNum = parseInt(parts?.[2] ?? "", 10);
  const toNum = parseInt(parts?.[3]?.split("?")[0] ?? "", 10);

  if (!routeId || isNaN(fromNum) || isNaN(toNum)) {
    return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
  }

  const blueprint = await prisma.forgeBlueprint.findFirst({
    where: { routeId, route: { userId: session.user.id } },
  });

  if (!blueprint) {
    return NextResponse.json({ error: "Blueprint not found" }, { status: 404 });
  }

  const [fromVersion, toVersion] = await Promise.all([
    prisma.forgeBlueprintVersion.findUnique({
      where: { blueprintId_version: { blueprintId: blueprint.id, version: fromNum } },
    }),
    prisma.forgeBlueprintVersion.findUnique({
      where: { blueprintId_version: { blueprintId: blueprint.id, version: toNum } },
    }),
  ]);

  if (!fromVersion || !toVersion) {
    return NextResponse.json({ error: "One or both versions not found" }, { status: 404 });
  }

  const oldSteps = fromVersion.steps as unknown as ForgeStep[];
  const newSteps = toVersion.steps as unknown as ForgeStep[];
  const changeSummary = generateChangeSummary(oldSteps, newSteps);

  // Build step-by-step diff
  const oldMap = new Map(oldSteps.map((s) => [s.stepId, s]));
  const newMap = new Map(newSteps.map((s) => [s.stepId, s]));
  const allStepIds = new Set([...oldMap.keys(), ...newMap.keys()]);

  const stepByStepDiff = Array.from(allStepIds).map((stepId) => {
    const oldStep = oldMap.get(stepId);
    const newStep = newMap.get(stepId);

    if (!oldStep) {
      return { stepId, status: "added" as const, newStep };
    }
    if (!newStep) {
      return { stepId, status: "removed" as const, oldStep };
    }

    // Check if modified
    const oldNorm = JSON.stringify(sortKeysDeep(oldStep.config));
    const newNorm = JSON.stringify(sortKeysDeep(newStep.config));
    if (oldNorm !== newNorm || oldStep.order !== newStep.order) {
      return {
        stepId,
        status: "modified" as const,
        oldStep,
        newStep,
        changes: diffFields(oldStep, newStep),
      };
    }

    return { stepId, status: "unchanged" as const, oldStep, newStep };
  });

  return NextResponse.json({
    from: fromNum,
    to: toNum,
    changeSummary,
    stepByStepDiff,
  });
});

function sortKeysDeep(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortKeysDeep);
  return Object.keys(obj as Record<string, unknown>)
    .sort()
    .reduce((acc: Record<string, unknown>, key) => {
      acc[key] = sortKeysDeep((obj as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function diffFields(oldStep: ForgeStep, newStep: ForgeStep) {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if (oldStep.order !== newStep.order) {
    changes.push({ field: "order", from: oldStep.order, to: newStep.order });
  }
  const allKeys = new Set([...Object.keys(oldStep.config), ...Object.keys(newStep.config)]);
  for (const key of allKeys) {
    const ov = JSON.stringify(oldStep.config[key]);
    const nv = JSON.stringify(newStep.config[key]);
    if (ov !== nv) {
      changes.push({ field: `config.${key}`, from: oldStep.config[key], to: newStep.config[key] });
    }
  }
  return changes;
}
