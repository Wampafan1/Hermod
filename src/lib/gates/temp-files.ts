/**
 * Temp file management for Realm Gate uploads.
 *
 * Files are stored in os.tmpdir()/hermod-gates/ keyed by a random ID.
 * A cleanup function removes files older than 1 hour.
 */

import { randomBytes } from "crypto";
import { writeFile, readFile, unlink, readdir, stat, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const TEMP_DIR = join(tmpdir(), "hermod-gates");
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

async function ensureTempDir(): Promise<void> {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
  } catch {
    // Already exists
  }
}

export async function saveTempFile(buffer: Buffer, extension: string): Promise<string> {
  await ensureTempDir();
  const id = `tmp_${randomBytes(16).toString("hex")}`;
  const filePath = join(TEMP_DIR, `${id}${extension}`);
  await writeFile(filePath, buffer);
  return id;
}

export async function readTempFile(tempFileId: string): Promise<{ buffer: Buffer; extension: string } | null> {
  await ensureTempDir();
  const files = await readdir(TEMP_DIR);
  const match = files.find((f) => f.startsWith(tempFileId));
  if (!match) return null;
  const buffer = await readFile(join(TEMP_DIR, match));
  const extension = match.slice(tempFileId.length); // e.g. ".xlsx"
  return { buffer, extension };
}

export async function deleteTempFile(tempFileId: string): Promise<void> {
  try {
    const files = await readdir(TEMP_DIR);
    const match = files.find((f) => f.startsWith(tempFileId));
    if (match) {
      await unlink(join(TEMP_DIR, match));
    }
  } catch {
    // Best effort
  }
}

export async function cleanupOldTempFiles(): Promise<number> {
  await ensureTempDir();
  let cleaned = 0;
  const now = Date.now();
  const files = await readdir(TEMP_DIR);

  for (const file of files) {
    try {
      const filePath = join(TEMP_DIR, file);
      const info = await stat(filePath);
      if (now - info.mtimeMs > MAX_AGE_MS) {
        await unlink(filePath);
        cleaned++;
      }
    } catch {
      // Skip files we can't stat/delete
    }
  }

  return cleaned;
}
