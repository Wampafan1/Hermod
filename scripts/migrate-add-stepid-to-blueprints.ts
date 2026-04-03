/**
 * One-time migration: backfill stepId on existing blueprint versions.
 * Run with: npx tsx scripts/migrate-add-stepid-to-blueprints.ts
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

interface LegacyStep {
  stepId?: string;
  order: number;
  type: string;
  confidence: number;
  config: Record<string, unknown>;
  description: string;
}

function generateStepId(step: LegacyStep): string {
  const identity = `${step.type}:${getStepIdentity(step)}:${step.order}:${Date.now()}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

function getStepIdentity(step: LegacyStep): string {
  switch (step.type) {
    case "rename_columns":
      return Object.keys((step.config.mapping as Record<string, string>) ?? {})[0] ?? "unknown";
    case "remove_columns":
      return ((step.config.columns as string[]) ?? []).sort().join(",");
    case "filter_rows":
      return `${step.config.column}:${step.config.operator}`;
    case "calculate":
      return (step.config.column as string) ?? "unknown";
    case "reorder_columns":
      return "reorder";
    default:
      return String(step.order);
  }
}

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

function computeStepsHash(steps: LegacyStep[]): string {
  const normalized = steps.map((s) => ({
    stepId: s.stepId,
    order: s.order,
    type: s.type,
    confidence: Math.round(s.confidence * 100) / 100,
    config: sortKeysDeep(s.config),
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function backfillStepIds() {
  console.log("Starting stepId backfill...");

  const versions = await prisma.forgeBlueprintVersion.findMany({
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;

  for (const version of versions) {
    const steps = version.steps as unknown as LegacyStep[];
    if (!Array.isArray(steps)) continue;

    let changed = false;
    const patchedSteps = steps.map((step) => {
      if (!step.stepId) {
        changed = true;
        return { ...step, stepId: generateStepId(step) };
      }
      return step;
    });

    if (changed) {
      const stepsHash = computeStepsHash(patchedSteps);
      await prisma.forgeBlueprintVersion.update({
        where: { id: version.id },
        data: {
          steps: patchedSteps as unknown as Record<string, unknown>[],
          stepsHash,
        },
      });
      updated++;
      console.log(`  Backfilled: blueprint ${version.blueprintId} v${version.version}`);
    }
  }

  console.log(`Done. Updated ${updated} of ${versions.length} version(s).`);
}

backfillStepIds()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
