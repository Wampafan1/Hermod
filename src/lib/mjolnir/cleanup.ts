/**
 * Mjolnir temp file cleanup utilities.
 *
 * Uploaded BEFORE/AFTER workbooks live under:
 *   tmpdir()/hermod-mjolnir/{userId}/{fileId}.xlsx
 */

import { readdir, rm, rmdir, stat } from "fs/promises";
import { join, resolve, sep } from "path";
import { tmpdir } from "os";

const DEFAULT_TEMP_FILE_TTL_HOURS = 24;
const DEFAULT_MAX_CLEANUP_ENTRIES = 250;

export interface MjolnirCleanupResult {
  filesDeleted: number;
  dirsDeleted: number;
}

export interface ExpiredMjolnirTempCleanupOptions {
  ttlHours?: number;
  now?: Date;
  maxEntries?: number;
  userId?: string;
}

export function getMjolnirTempRoot(): string {
  return join(tmpdir(), "hermod-mjolnir");
}

export function isSafeMjolnirTempPath(filePath: string): boolean {
  const root = resolve(getMjolnirTempRoot());
  const target = resolve(filePath);
  const comparableRoot = normalizePathForCompare(root);
  const comparableTarget = normalizePathForCompare(target);

  return (
    comparableTarget === comparableRoot ||
    comparableTarget.startsWith(`${comparableRoot}${sep}`)
  );
}

export function getMjolnirUserTempDir(userId: string): string {
  return join(getMjolnirTempRoot(), sanitizeTempPathSegment(userId));
}

export async function cleanupMjolnirFile(filePath: string): Promise<MjolnirCleanupResult> {
  if (!isSafeMjolnirTempPath(filePath)) {
    return emptyCleanupResult();
  }

  const deleted = await countEntries(filePath);
  try {
    await rm(filePath, { recursive: true, force: true });
    return deleted;
  } catch (err) {
    logCleanupError("direct cleanup", err);
    return emptyCleanupResult();
  }
}

/**
 * Remove all temporary Mjolnir files for a given user.
 * Kept for existing call sites; errors are logged without sensitive filenames.
 */
export async function cleanupUserTempFiles(userId: string): Promise<void> {
  await cleanupMjolnirFile(getMjolnirUserTempDir(userId));
}

export async function cleanupUserExpiredTempFiles(
  userId: string,
  options: Omit<ExpiredMjolnirTempCleanupOptions, "userId"> = {}
): Promise<MjolnirCleanupResult> {
  return cleanupExpiredMjolnirTempFiles({ ...options, userId });
}

export async function cleanupExpiredMjolnirTempFiles(
  options: ExpiredMjolnirTempCleanupOptions = {}
): Promise<MjolnirCleanupResult> {
  const ttlHours = resolveTtlHours(options.ttlHours);
  const cutoffMs = (options.now ?? new Date()).getTime() - ttlHours * 60 * 60 * 1000;
  const maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_CLEANUP_ENTRIES);
  const startPath = options.userId
    ? getMjolnirUserTempDir(options.userId)
    : getMjolnirTempRoot();

  if (!isSafeMjolnirTempPath(startPath)) {
    return emptyCleanupResult();
  }

  const state = {
    visited: 0,
    filesDeleted: 0,
    dirsDeleted: 0,
    maxEntries,
    cutoffMs,
  };

  await cleanupExpiredUnder(startPath, state);
  return { filesDeleted: state.filesDeleted, dirsDeleted: state.dirsDeleted };
}

async function cleanupExpiredUnder(
  currentPath: string,
  state: {
    visited: number;
    filesDeleted: number;
    dirsDeleted: number;
    maxEntries: number;
    cutoffMs: number;
  }
): Promise<boolean> {
  if (state.visited >= state.maxEntries) return false;
  if (!isSafeMjolnirTempPath(currentPath)) return false;

  state.visited++;

  let currentStat;
  try {
    currentStat = await stat(currentPath);
  } catch {
    return false;
  }

  if (!currentStat.isDirectory()) {
    if (currentStat.mtimeMs < state.cutoffMs) {
      addCleanupResult(state, await cleanupMjolnirFile(currentPath));
      return true;
    }
    return false;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch (err) {
    logCleanupError("read directory", err);
    return false;
  }

  let hasRemainingEntries = false;
  for (const entry of entries) {
    if (state.visited >= state.maxEntries) {
      hasRemainingEntries = true;
      break;
    }

    const childPath = join(currentPath, entry.name);
    const deleted = await cleanupExpiredUnder(childPath, state);
    if (!deleted) hasRemainingEntries = true;
  }

  if (!hasRemainingEntries && currentPath !== getMjolnirTempRoot()) {
    try {
      await rmdir(currentPath);
      state.dirsDeleted++;
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

async function countEntries(filePath: string): Promise<MjolnirCleanupResult> {
  if (!isSafeMjolnirTempPath(filePath)) return emptyCleanupResult();

  let currentStat;
  try {
    currentStat = await stat(filePath);
  } catch {
    return emptyCleanupResult();
  }

  if (!currentStat.isDirectory()) return { filesDeleted: 1, dirsDeleted: 0 };

  const count = { filesDeleted: 0, dirsDeleted: 1 };
  try {
    const entries = await readdir(filePath);
    for (const entry of entries) {
      addCleanupResult(count, await countEntries(join(filePath, entry)));
    }
  } catch (err) {
    logCleanupError("count entries", err);
  }

  return count;
}

function emptyCleanupResult(): MjolnirCleanupResult {
  return { filesDeleted: 0, dirsDeleted: 0 };
}

function addCleanupResult(
  target: MjolnirCleanupResult,
  source: MjolnirCleanupResult
): void {
  target.filesDeleted += source.filesDeleted;
  target.dirsDeleted += source.dirsDeleted;
}

function resolveTtlHours(explicitTtlHours?: number): number {
  if (explicitTtlHours !== undefined && Number.isFinite(explicitTtlHours)) {
    return Math.max(0, explicitTtlHours);
  }

  const parsed = Number(process.env.MJOLNIR_TEMP_FILE_TTL_HOURS);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_TEMP_FILE_TTL_HOURS;
}

function normalizePathForCompare(filePath: string): string {
  const normalized = filePath.endsWith(sep) ? filePath.slice(0, -1) : filePath;
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sanitizeTempPathSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160) || "unknown";
}

function logCleanupError(action: string, err: unknown): void {
  const code = isErrorWithCode(err) ? err.code : undefined;
  const label = code ?? (err instanceof Error ? err.name : "unknown error");
  console.warn(`[Mjolnir] Temp cleanup ${action} failed (${label})`);
}

function isErrorWithCode(err: unknown): err is { code: string } {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string"
  );
}
