import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { access, mkdir, rm, utimes, writeFile } from "fs/promises";
import { join, sep } from "path";
import { tmpdir } from "os";
import {
  cleanupExpiredMjolnirTempFiles,
  cleanupMjolnirFile,
  cleanupUserTempFiles,
  getMjolnirTempRoot,
  getMjolnirUserTempDir,
  isSafeMjolnirTempPath,
} from "@/lib/mjolnir/cleanup";

const usersToClean = new Set<string>();
const outsidePathsToClean = new Set<string>();

afterEach(async () => {
  for (const userId of usersToClean) {
    await cleanupUserTempFiles(userId);
  }
  usersToClean.clear();

  for (const outsidePath of outsidePathsToClean) {
    await rm(outsidePath, { recursive: true, force: true });
  }
  outsidePathsToClean.clear();
});

describe("Mjolnir temp cleanup", () => {
  it("deletes expired temp files", async () => {
    const userId = testUserId();
    const filePath = await writeUserTempFile(userId, "old.xlsx");
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(filePath, oldDate, oldDate);

    const result = await cleanupExpiredMjolnirTempFiles({
      userId,
      ttlHours: 24,
      now: new Date(),
    });

    expect(result.deletedCount).toBeGreaterThanOrEqual(1);
    await expect(access(filePath)).rejects.toThrow();
  });

  it("preserves non-expired temp files", async () => {
    const userId = testUserId();
    const filePath = await writeUserTempFile(userId, "fresh.xlsx");

    const result = await cleanupExpiredMjolnirTempFiles({
      userId,
      ttlHours: 24,
      now: new Date(),
    });

    expect(result.deletedCount).toBe(0);
    await expect(access(filePath)).resolves.toBeUndefined();
  });

  it("never deletes outside tmpdir/hermod-mjolnir", async () => {
    const outsideDir = join(tmpdir(), `hermod-mjolnir-outside-${randomUUID()}`);
    const outsideFile = join(outsideDir, "outside.xlsx");
    outsidePathsToClean.add(outsideDir);
    await mkdir(outsideDir, { recursive: true });
    await writeFile(outsideFile, "outside");

    expect(isSafeMjolnirTempPath(outsideFile)).toBe(false);
    await expect(cleanupMjolnirFile(outsideFile)).resolves.toBe(0);
    await expect(access(outsideFile)).resolves.toBeUndefined();
  });

  it("per-user cleanup only deletes that user directory", async () => {
    const userA = testUserId();
    const userB = testUserId();
    const fileA = await writeUserTempFile(userA, "a.xlsx");
    const fileB = await writeUserTempFile(userB, "b.xlsx");

    await cleanupUserTempFiles(userA);

    await expect(access(fileA)).rejects.toThrow();
    await expect(access(fileB)).resolves.toBeUndefined();
  });

  it("ignores path traversal attempts", async () => {
    const traversalPath = join(getMjolnirTempRoot(), "..", `outside-${randomUUID()}`);
    const traversalUserId = `..${sep}outside-${randomUUID()}`;

    expect(isSafeMjolnirTempPath(traversalPath)).toBe(false);
    await expect(cleanupMjolnirFile(traversalPath)).resolves.toBe(0);

    const result = await cleanupExpiredMjolnirTempFiles({
      userId: traversalUserId,
      ttlHours: 0,
    });
    expect(result.deletedCount).toBe(0);
  });
});

function testUserId(): string {
  const userId = `test-${randomUUID()}`;
  usersToClean.add(userId);
  return userId;
}

async function writeUserTempFile(userId: string, filename: string): Promise<string> {
  const userDir = getMjolnirUserTempDir(userId);
  const filePath = join(userDir, filename);
  await mkdir(userDir, { recursive: true });
  await writeFile(filePath, "sample");
  return filePath;
}
