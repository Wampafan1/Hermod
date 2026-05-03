import { prisma } from "@/lib/db";
import { getBackupStorageProvider } from "./storage";
import {
  buildDatabaseBackupPrefix,
  buildPostgresWalPrefix,
  serverSlugFromConfig,
} from "./storage/object-keys";

function objectKeySetFromRun(run: { objectKeys: unknown }): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(run.objectKeys)) return keys;
  for (const item of run.objectKeys) {
    if (typeof item === "string") {
      keys.add(item);
    } else if (item && typeof item === "object" && "key" in item) {
      const key = (item as { key?: unknown }).key;
      if (typeof key === "string") keys.add(key);
      const manifestObjectKey = (item as { manifestObjectKey?: unknown }).manifestObjectKey;
      if (typeof manifestObjectKey === "string") keys.add(manifestObjectKey);
    }
  }
  return keys;
}

function storagePrefixFromPolicy(policy: {
  storagePrefix: string | null;
  storageTarget: { config: unknown };
}): string | null {
  if (policy.storagePrefix?.trim()) return policy.storagePrefix;
  const config = policy.storageTarget.config;
  if (config && typeof config === "object") {
    const prefix = (config as { prefix?: unknown }).prefix;
    if (typeof prefix === "string" && prefix.trim()) return prefix;
  }
  return null;
}

function storagePrefixFromTarget(target: { config: unknown }): string | null {
  const config = target.config;
  if (config && typeof config === "object") {
    const prefix = (config as { prefix?: unknown }).prefix;
    if (typeof prefix === "string" && prefix.trim()) return prefix;
  }
  return null;
}

function artifactKeySet(metadata: unknown): Set<string> {
  const keys = new Set<string>();
  if (!metadata || typeof metadata !== "object") return keys;
  const objectKey = (metadata as { objectKey?: unknown }).objectKey;
  const manifestObjectKey = (metadata as { manifestObjectKey?: unknown }).manifestObjectKey;
  if (typeof objectKey === "string" && !objectKey.includes("://")) keys.add(objectKey);
  if (typeof manifestObjectKey === "string" && !manifestObjectKey.includes("://")) keys.add(manifestObjectKey);
  return keys;
}

export async function enforceBackupRetention(policyId: string): Promise<string[]> {
  const policy = await prisma.postgresBackupPolicy.findUnique({
    where: { id: policyId },
    include: {
      sourceConnection: {
        select: { name: true, config: true },
      },
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
  const storagePrefix = storagePrefixFromPolicy(policy);
  const serverSlug = serverSlugFromConfig(policy.sourceConnection.config, policy.sourceConnection.name);
  const databasePrefixRoot = buildDatabaseBackupPrefix({
    storagePrefix,
    engine: "postgres",
    serverSlug,
    databaseName: "retention-placeholder",
  }).replace(/\/retention-placeholder$/, "");
  const walPrefix = buildPostgresWalPrefix({ storagePrefix, serverSlug });
  const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60_000;
  const errors: string[] = [];
  let objects: Array<{ key: string; lastModified?: Date }>;
  try {
    const databaseObjects = await storage.list(databasePrefixRoot);
    let walObjects: typeof databaseObjects = [];
    try {
      walObjects = await storage.list(walPrefix);
    } catch {
      walObjects = [];
    }
    objects = [...databaseObjects, ...walObjects];
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

export async function enforceMssqlBackupRetention(policyId: string): Promise<string[]> {
  const policy = await prisma.mssqlBackupPolicy.findUnique({
    where: { id: policyId },
    include: {
      sourceConnection: {
        select: { name: true, config: true },
      },
      storageTarget: {
        select: { provider: true, accessMode: true, config: true, credentials: true },
      },
      runs: {
        where: { status: "SUCCESS" },
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          type: true,
          databaseName: true,
          artifactMetadata: true,
          startedAt: true,
        },
      },
    },
  });

  if (!policy || !policy.storageTarget || policy.retentionDays <= 0) return [];

  const latestFullByDatabase = new Map<string, Date>();
  for (const run of policy.runs) {
    if (run.type !== "FULL" || !run.databaseName) continue;
    if (!latestFullByDatabase.has(run.databaseName)) {
      latestFullByDatabase.set(run.databaseName, run.startedAt);
    }
  }

  const protectedKeys = new Set<string>();
  const databases = new Set<string>();
  for (const run of policy.runs) {
    if (!run.databaseName) continue;
    databases.add(run.databaseName);
    const latestFullAt = latestFullByDatabase.get(run.databaseName);
    const keepRun = !latestFullAt || run.startedAt.getTime() >= latestFullAt.getTime();
    if (!keepRun) continue;
    for (const key of artifactKeySet(run.artifactMetadata)) {
      protectedKeys.add(key);
    }
  }

  if (databases.size === 0) return [];

  const storage = getBackupStorageProvider(policy.storageTarget);
  const storagePrefix = storagePrefixFromTarget(policy.storageTarget);
  const serverSlug = serverSlugFromConfig(policy.sourceConnection.config, policy.sourceConnection.name);
  const cutoff = Date.now() - policy.retentionDays * 24 * 60 * 60_000;
  const errors: string[] = [];

  for (const databaseName of databases) {
    const prefix = buildDatabaseBackupPrefix({
      storagePrefix,
      engine: "mssql",
      serverSlug,
      databaseName,
    });

    let objects: Array<{ key: string; lastModified?: Date }>;
    try {
      objects = await storage.list(prefix);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    for (const object of objects) {
      if (protectedKeys.has(object.key)) continue;
      if (!object.lastModified || object.lastModified.getTime() >= cutoff) continue;
      try {
        await storage.delete(object.key);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (errors.length > 0) {
    await prisma.mssqlBackupPolicy.update({
      where: { id: policy.id },
      data: {
        lastError: `Retention cleanup warning: ${errors.slice(0, 3).join("; ")}`,
      },
    });
  }

  return errors;
}
