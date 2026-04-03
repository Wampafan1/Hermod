/**
 * Mjolnir — Temp file cleanup utility.
 *
 * Removes the per-user temporary directory used for uploaded
 * BEFORE/AFTER Excel files during the forge workflow.
 */

import { rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Remove all temporary Mjolnir files for a given user.
 * Silently ignores errors (files may already be gone or locked).
 */
export async function cleanupUserTempFiles(userId: string): Promise<void> {
  const userDir = join(tmpdir(), "hermod-mjolnir", userId);
  try {
    await rm(userDir, { recursive: true, force: true });
  } catch (err) {
    // Issue #18: Log errors instead of silently swallowing (Windows locked files can accumulate)
    console.error(`[Mjolnir] Cleanup failed for ${userDir}:`, err instanceof Error ? err.message : err);
  }
}
