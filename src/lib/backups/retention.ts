import { prisma } from "@/lib/db";
import { getBackupStorageProvider } from "./storage";
import { normalizeStoragePrefix } from "./postgres/artifacts";

function objectKeySetFromRun(run: { objectKeys: unknown }): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(run.objectKeys)) return keys;
  for (const item of run.objectKeys) {
    if (typeof item === "string") {
      keys.add(item);
    } else if (item && typeof item === "object" && "key" in item) {
      const key = (item as { key?: unknown }).key;
      if (typeof key === "string") keys.add(key);
    }
  }
  return keys;
}

export async function enforceBackupRetention(policyId: string): Promise<string[]> {
  const policy = await prisma.postgresBackupPolicy.findUnique({
    where: { id: policyId },
    include: {
      storageTarget: {
        select: { provider: true, accessMode: true, config: true, credentials: true },
      },
      runs: {
        where: { type: "FULL_LOGICAL", status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
        select: { id: true, objectKeys: true },
      },
    },
  });

  if (!policy || policy.retentionDays <= 0) return [];

  const latestFullKeys = policy.runs[0] ? objectKeySetFromRun(policy.runs[0]) : new Set<string>();
  const storage = getBackupStorageProvider(policy.storageTarget);
  const prefix = `${normalizeStoragePrefix(policy.storagePrefix)}/${policy.id}/`;
  const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60_000;
  const errors: string[] = [];
  let objects;
  try {
    objects = await storage.list(prefix);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    await prisma.postgresBackupPolicy.update({
      where: { id: policy.id },
      data: {
        lastError: `Retention cleanup warning: ${errors[0]}`,
      },
    });
    return errors;
  }

  for (const object of objects) {
    if (latestFullKeys.has(object.key)) continue;
    if (!object.lastModified || object.lastModified.getTime() >= cutoff) continue;
    try {
      await storage.delete(object.key);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) {
    await prisma.postgresBackupPolicy.update({
      where: { id: policy.id },
      data: {
        lastError: `Retention cleanup warning: ${errors.slice(0, 3).join("; ")}`,
      },
    });
  }

  return errors;
}
