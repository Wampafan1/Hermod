import { createHash } from "crypto";
import { createReadStream } from "fs";
import path from "path";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "postgres";
}

export function normalizeStoragePrefix(prefix: string | null | undefined): string {
  if (!prefix) return "niflheim";
  return prefix
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizeSegment(part))
    .join("/") || "niflheim";
}

export function timestampForObjectKey(date: Date): string {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

function datePath(date: Date): string {
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
}

export function buildFullBackupObjectKey(input: {
  prefix?: string | null;
  policyId: string;
  database: string;
  at: Date;
}): string {
  const prefix = normalizeStoragePrefix(input.prefix);
  const database = sanitizeSegment(input.database);
  const stamp = timestampForObjectKey(input.at);
  return `${prefix}/${input.policyId}/full-logical/${database}/${datePath(input.at)}/${database}-${stamp}.dump`;
}

export function buildWalObjectKey(input: {
  prefix?: string | null;
  policyId: string;
  fileName: string;
  at: Date;
}): string {
  const prefix = normalizeStoragePrefix(input.prefix);
  const fileName = sanitizeSegment(path.basename(input.fileName));
  return `${prefix}/${input.policyId}/wal/${datePath(input.at)}/${fileName}`;
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
