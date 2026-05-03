import { createHash } from "crypto";
import { createReadStream } from "fs";
import {
  buildBackupObjectKey,
  normalizeStoragePrefix as normalizeObjectStoragePrefix,
  timestampForFilename,
} from "@/lib/backups/storage/object-keys";

export function normalizeStoragePrefix(prefix: string | null | undefined): string {
  return normalizeObjectStoragePrefix(prefix) || "niflheim";
}

export function timestampForObjectKey(date: Date): string {
  return `${timestampForFilename(date).replace("_", "T")}Z`;
}

export function buildFullBackupObjectKey(input: {
  prefix?: string | null;
  policyId: string;
  runId?: string;
  serverSlug?: string;
  database: string;
  at: Date;
}): string {
  return buildBackupObjectKey({
    storagePrefix: input.prefix,
    engine: "postgres",
    serverSlug: input.serverSlug ?? "postgres",
    databaseName: input.database,
    backupType: "full-logical",
    timestamp: input.at,
    runId: input.runId ?? input.policyId,
    extension: "dump",
  });
}

export function buildWalObjectKey(input: {
  prefix?: string | null;
  policyId: string;
  runId?: string;
  serverSlug?: string;
  fileName: string;
  at: Date;
}): string {
  return buildBackupObjectKey({
    storagePrefix: input.prefix,
    engine: "postgres",
    serverSlug: input.serverSlug ?? "postgres",
    backupType: "wal",
    timestamp: input.at,
    runId: input.runId ?? input.policyId,
    walFileName: input.fileName,
  });
}

export async function calculateFileSha256(localPath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(localPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function combineChecksums(checksums: string[]): string | null {
  if (checksums.length === 0) return null;
  if (checksums.length === 1) return checksums[0];
  const hash = createHash("sha256");
  for (const checksum of [...checksums].sort()) {
    hash.update(checksum);
  }
  return hash.digest("hex");
}
