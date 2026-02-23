import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";

const SFTP_DATA_ROOT = path.resolve(process.cwd(), "sftp-data");

/**
 * Generate a secure random password (24+ characters, URL-safe base64).
 */
export function generateSftpPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Slugify a connection name into a valid SFTP username.
 * Lowercase, alphanumeric + hyphens only, max 32 chars.
 */
export function slugifyUsername(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Create the SFTP folder structure for a user.
 * sftp-data/{username}/inbound
 * sftp-data/{username}/outbound
 * sftp-data/{username}/archive
 */
export function createSftpFolders(username: string): void {
  const userDir = path.join(SFTP_DATA_ROOT, username);
  for (const sub of ["inbound", "outbound", "archive"]) {
    fs.mkdirSync(path.join(userDir, sub), { recursive: true });
  }
}

/**
 * Get the inbound folder path for a given SFTP username.
 */
export function getInboundPath(username: string): string {
  return path.join(SFTP_DATA_ROOT, username, "inbound");
}

/**
 * Get the archive folder path for a given SFTP username.
 */
export function getArchivePath(username: string): string {
  return path.join(SFTP_DATA_ROOT, username, "archive");
}

/**
 * Append a user entry to the sftp-data/users.conf file.
 * Format: username:password:uid:gid:inbound
 * Uses uid/gid 1001 for all SFTP users.
 */
export function appendSftpUser(username: string, password: string): void {
  const confPath = path.join(SFTP_DATA_ROOT, "users.conf");
  fs.mkdirSync(SFTP_DATA_ROOT, { recursive: true });
  const line = `${username}:${password}:1001:1001:inbound\n`;

  // Read existing to avoid duplicates
  let existing = "";
  try {
    existing = fs.readFileSync(confPath, "utf-8");
  } catch {
    // File doesn't exist yet
  }

  if (!existing.includes(`${username}:`)) {
    fs.appendFileSync(confPath, line);
  }
}

/**
 * Remove a user entry from users.conf.
 */
export function removeSftpUser(username: string): void {
  const confPath = path.join(SFTP_DATA_ROOT, "users.conf");
  try {
    const existing = fs.readFileSync(confPath, "utf-8");
    const filtered = existing
      .split("\n")
      .filter((line) => !line.startsWith(`${username}:`))
      .join("\n");
    fs.writeFileSync(confPath, filtered);
  } catch {
    // File doesn't exist, nothing to remove
  }
}

/**
 * Check if SFTP folders exist and are accessible for a given username.
 */
export function testSftpFolders(username: string): { success: boolean; error?: string } {
  const userDir = path.join(SFTP_DATA_ROOT, username);
  for (const sub of ["inbound", "outbound", "archive"]) {
    const dir = path.join(userDir, sub);
    if (!fs.existsSync(dir)) {
      return { success: false, error: `Folder not found: ${sub}` };
    }
  }
  return { success: true };
}
