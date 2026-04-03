/**
 * Blueprint Version Control — Immutable, append-only versioning for Mjölnir blueprints.
 *
 * Every blueprint change creates a new version. Versions are never mutated or deleted
 * (except by the retention policy for old unused versions).
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import type { ForgeStep } from "./types";
import type {
  ForgeBlueprint,
  ForgeBlueprintVersion,
  ForgeBlueprintExecution,
  VersionSource,
} from "@prisma/client";

// ─── Types ──────────────────────────────────────────

export interface ChangeSummary {
  added: { stepIndex: number; type: string; description: string }[];
  removed: { stepIndex: number; type: string; description: string }[];
  modified: { stepIndex: number; type: string; field: string; from: unknown; to: unknown }[];
  reordered: boolean;
  totalChanges: number;
}

interface CreateVersionInput {
  blueprintId: string;
  steps: ForgeStep[];
  source: VersionSource;
  beforeFileHash?: string;
  afterFileHash?: string;
  aiModelUsed?: string;
  aiConfidence?: number;
  changeReason?: string;
  userId?: string;
}

interface ConfigDiff {
  field: string;
  from: unknown;
  to: unknown;
}

// ─── Step Identity ──────────────────────────────────

export function generateStepId(step: ForgeStep): string {
  const identity = `${step.type}:${getStepIdentity(step)}:${step.order}:${Date.now()}`;
  return createHash("sha256").update(identity).digest("hex").slice(0, 12);
}

function getStepIdentity(step: ForgeStep): string {
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

/** Ensure every step has a stepId. Assigns one if missing. */
export function ensureStepIds(steps: ForgeStep[]): ForgeStep[] {
  return steps.map((step) => ({
    ...step,
    stepId: step.stepId || generateStepId(step),
  }));
}

// ─── Hashing ────────────────────────────────────────

export function normalizeStepsForHash(steps: ForgeStep[]): unknown[] {
  return steps.map((s) => ({
    stepId: s.stepId,
    order: s.order,
    type: s.type,
    confidence: Math.round(s.confidence * 100) / 100,
    config: sortKeysDeep(s.config),
    // Intentionally exclude 'description' — AI prose varies without logic changes
  }));
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

export function computeStepsHash(steps: ForgeStep[]): string {
  const normalized = normalizeStepsForHash(steps);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function computeDataHash(rows: Record<string, unknown>[], sampleSize = 100): string {
  const sample = rows.slice(0, sampleSize).map((row) => {
    const keys = Object.keys(row).sort();
    const ordered: Record<string, unknown> = {};
    for (const k of keys) ordered[k] = row[k];
    return ordered;
  });
  return createHash("sha256").update(JSON.stringify(sample)).digest("hex");
}

// ─── Get or Create Parent Blueprint ─────────────────

export async function getOrCreateForgeBlueprint(
  routeId: string,
  name?: string,
  userId?: string
): Promise<ForgeBlueprint> {
  return prisma.forgeBlueprint.upsert({
    where: { routeId },
    update: {},
    create: {
      routeId,
      name: name ?? `Blueprint for route ${routeId}`,
      currentVersion: 0,
      createdBy: userId,
    },
  });
}

// ─── Create Version ─────────────────────────────────

export async function createBlueprintVersion(
  input: CreateVersionInput
): Promise<ForgeBlueprintVersion> {
  const stepsWithIds = ensureStepIds(input.steps);
  const stepsHash = computeStepsHash(stepsWithIds);

  const version = await prisma.$transaction(async (tx) => {
    // Lock parent row to prevent concurrent version creation
    await tx.$queryRaw`SELECT id FROM "ForgeBlueprint" WHERE id = ${input.blueprintId} FOR UPDATE`;

    const [{ nextVersion }] = await tx.$queryRaw<[{ nextVersion: number }]>`
      SELECT COALESCE(MAX(version), 0) + 1 as "nextVersion"
      FROM "ForgeBlueprintVersion"
      WHERE "blueprintId" = ${input.blueprintId}
    `;

    // Check if steps actually changed
    const latestVersion = await tx.forgeBlueprintVersion.findFirst({
      where: { blueprintId: input.blueprintId },
      orderBy: { version: "desc" },
    });

    if (latestVersion && latestVersion.stepsHash === stepsHash) {
      throw new Error("No changes detected — blueprint steps are identical to the current version.");
    }

    const changeSummary = latestVersion
      ? generateChangeSummary(latestVersion.steps as unknown as ForgeStep[], stepsWithIds)
      : null;

    const version = await tx.forgeBlueprintVersion.create({
      data: {
        blueprintId: input.blueprintId,
        version: nextVersion,
        steps: stepsWithIds as unknown as Record<string, unknown>[],
        stepsHash,
        source: input.source,
        beforeFileHash: input.beforeFileHash,
        afterFileHash: input.afterFileHash,
        aiModelUsed: input.aiModelUsed,
        aiConfidence: input.aiConfidence,
        changeReason:
          input.changeReason ?? autoGenerateChangeReason(input.source, changeSummary),
        changeSummary: changeSummary as unknown as Record<string, unknown>,
        createdBy: input.userId,
      },
    });

    await tx.forgeBlueprint.update({
      where: { id: input.blueprintId },
      data: { currentVersion: nextVersion },
    });

    return version;
  });

  // Auto-lock v1 immediately
  if (version.version === 1) {
    try {
      await maybeAutoLockVersion(version.id);
    } catch { /* non-critical */ }
  }

  // Enqueue background retention pruning (non-blocking)
  try {
    const { getBoss } = await import("@/lib/pg-boss");
    const boss = getBoss();
    await boss.send("prune-blueprint-versions", {
      blueprintId: input.blueprintId,
    }, {
      retryLimit: 1,
      retryDelay: 60,
    });
  } catch {
    // Retention will catch up on next version creation
  }

  return version;
}

// ─── Rollback ───────────────────────────────────────

export async function rollbackToVersion(
  blueprintId: string,
  targetVersion: number,
  userId: string,
  reason?: string
): Promise<ForgeBlueprintVersion> {
  const target = await prisma.forgeBlueprintVersion.findUniqueOrThrow({
    where: { blueprintId_version: { blueprintId, version: targetVersion } },
  });

  return createBlueprintVersion({
    blueprintId,
    steps: target.steps as unknown as ForgeStep[],
    source: "ROLLBACK",
    changeReason: reason ?? `Rolled back to version ${targetVersion}`,
    userId,
  });
}

// ─── Version Locking ────────────────────────────────

export async function lockVersion(versionId: string, userId: string): Promise<void> {
  await prisma.forgeBlueprintVersion.update({
    where: { id: versionId },
    data: { isLocked: true, lockedAt: new Date(), lockedBy: userId },
  });
}

export async function maybeAutoLockVersion(versionId: string): Promise<void> {
  const version = await prisma.forgeBlueprintVersion.findUnique({
    where: { id: versionId },
    include: {
      _count: { select: { executions: { where: { status: "SUCCESS" } } } },
    },
  });

  if (!version || version.isLocked) return;

  const shouldLock = version.version === 1 || version._count.executions >= 10;

  if (shouldLock) {
    await prisma.forgeBlueprintVersion.update({
      where: { id: versionId },
      data: { isLocked: true, lockedAt: new Date(), lockedBy: "SYSTEM_AUTO_LOCK" },
    });
  }
}

// ─── Execution Tracking ─────────────────────────────

export async function recordExecution(input: {
  blueprintId: string;
  versionId: string;
  versionNumber: number;
  jobId?: string;
  routeRunId?: string;
  inputRowCount?: number;
  inputHash?: string;
}): Promise<ForgeBlueprintExecution> {
  return prisma.forgeBlueprintExecution.create({
    data: {
      blueprintId: input.blueprintId,
      versionId: input.versionId,
      versionNumber: input.versionNumber,
      jobId: input.jobId,
      routeRunId: input.routeRunId,
      inputRowCount: input.inputRowCount,
      inputHash: input.inputHash,
      status: "RUNNING",
    },
  });
}

export async function completeExecution(
  executionId: string,
  result: {
    status: "SUCCESS" | "FAILED";
    outputRowCount?: number;
    inputRowCount?: number;
    outputHash?: string;
    inputHash?: string;
    errorMessage?: string;
    errorStep?: number;
  }
): Promise<void> {
  const execution = await prisma.forgeBlueprintExecution.findUniqueOrThrow({
    where: { id: executionId },
  });

  await prisma.forgeBlueprintExecution.update({
    where: { id: executionId },
    data: {
      status: result.status,
      outputRowCount: result.outputRowCount,
      inputRowCount: result.inputRowCount,
      outputHash: result.outputHash,
      inputHash: result.inputHash,
      errorMessage: result.errorMessage,
      errorStep: result.errorStep,
      completedAt: new Date(),
      durationMs: Date.now() - execution.startedAt.getTime(),
    },
  });

  // Auto-lock check after successful execution
  if (result.status === "SUCCESS" && execution.versionId) {
    await maybeAutoLockVersion(execution.versionId);
  }
}

// ─── Metadata Updates (no new version) ──────────────

export async function updateBlueprintMetadata(
  blueprintId: string,
  updates: { name?: string; description?: string }
): Promise<ForgeBlueprint> {
  return prisma.forgeBlueprint.update({
    where: { id: blueprintId },
    data: updates,
  });
}

// ─── Retention Policy ───────────────────────────────

export async function enforceRetentionPolicy(blueprintId: string): Promise<number> {
  const KEEP_RECENT = 50;

  const allVersions = await prisma.forgeBlueprintVersion.findMany({
    where: { blueprintId },
    orderBy: { version: "desc" },
    include: { _count: { select: { executions: true } } },
  });

  const toDelete: string[] = [];

  for (let i = 0; i < allVersions.length; i++) {
    const v = allVersions[i];
    if (i < KEEP_RECENT) continue;
    if (v.isLocked) continue;
    if (v._count.executions > 0) continue;
    toDelete.push(v.id);
  }

  if (toDelete.length > 0) {
    await prisma.forgeBlueprintVersion.deleteMany({
      where: { id: { in: toDelete } },
    });
  }

  return toDelete.length;
}

// ─── Change Summary Generation ──────────────────────

export function generateChangeSummary(
  oldSteps: ForgeStep[],
  newSteps: ForgeStep[]
): ChangeSummary {
  const summary: ChangeSummary = {
    added: [],
    removed: [],
    modified: [],
    reordered: false,
    totalChanges: 0,
  };

  const oldMap = new Map(oldSteps.map((s) => [s.stepId, s]));
  const newMap = new Map(newSteps.map((s) => [s.stepId, s]));

  for (const [stepId, step] of newMap) {
    if (!oldMap.has(stepId)) {
      summary.added.push({ stepIndex: step.order, type: step.type, description: step.description });
    }
  }

  for (const [stepId, step] of oldMap) {
    if (!newMap.has(stepId)) {
      summary.removed.push({ stepIndex: step.order, type: step.type, description: step.description });
    }
  }

  for (const [stepId, newStep] of newMap) {
    const oldStep = oldMap.get(stepId);
    if (oldStep) {
      const diffs = diffConfigs(oldStep.config, newStep.config);
      for (const diff of diffs) {
        summary.modified.push({
          stepIndex: newStep.order,
          type: newStep.type,
          field: diff.field,
          from: diff.from,
          to: diff.to,
        });
      }
    }
  }

  const oldOrder = oldSteps.map((s) => s.stepId);
  const newOrder = newSteps.map((s) => s.stepId);
  summary.reordered = JSON.stringify(oldOrder) !== JSON.stringify(newOrder);

  summary.totalChanges =
    summary.added.length + summary.removed.length + summary.modified.length + (summary.reordered ? 1 : 0);

  return summary;
}

// ─── Config Diffing ─────────────────────────────────

const DIFF_IGNORE = new Set(["description", "confidence", "stepId"]);

function diffConfigs(
  oldConfig: Record<string, unknown>,
  newConfig: Record<string, unknown>
): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

  for (const key of allKeys) {
    if (DIFF_IGNORE.has(key)) continue;
    const oldVal = JSON.stringify(oldConfig[key]);
    const newVal = JSON.stringify(newConfig[key]);
    if (oldVal !== newVal) {
      diffs.push({ field: key, from: oldConfig[key] ?? null, to: newConfig[key] ?? null });
    }
  }

  return diffs;
}

// ─── Auto-Generated Change Reasons ──────────────────

function autoGenerateChangeReason(source: VersionSource, changeSummary: ChangeSummary | null): string {
  if (!changeSummary) return "Initial blueprint created";

  const parts: string[] = [sourceLabel(source)];
  if (changeSummary.added.length > 0) parts.push(`added ${changeSummary.added.length} step(s)`);
  if (changeSummary.removed.length > 0) parts.push(`removed ${changeSummary.removed.length} step(s)`);
  if (changeSummary.modified.length > 0) parts.push(`modified ${changeSummary.modified.length} field(s)`);
  if (changeSummary.reordered) parts.push("reordered steps");

  return parts.join(" — ");
}

function sourceLabel(source: VersionSource): string {
  switch (source) {
    case "FORGE": return "Re-forged from updated files";
    case "MANUAL_EDIT": return "Manual edit";
    case "ROLLBACK": return "Rolled back";
    case "IMPORT": return "Imported";
    default: return "Updated";
  }
}
