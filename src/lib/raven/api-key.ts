import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const KEY_PREFIX = "hrv_";
const KEY_LENGTH = 32; // bytes → base62-encoded
const BCRYPT_COST = 12;

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Encode a byte array to a base62 string. */
function toBase62(buf: Uint8Array): string {
  let result = "";
  for (let i = 0; i < buf.length; i++) {
    result += BASE62[buf[i] % 62];
  }
  return result;
}

/**
 * Generate a new Raven API key.
 * Returns the full key (shown to user once), display prefix, and bcrypt hash (for storage).
 * Example key: "hrv_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"
 */
export async function generateRavenApiKey(): Promise<{
  fullKey: string;
  prefix: string;
  hash: string;
}> {
  const bytes = randomBytes(KEY_LENGTH);
  const encoded = toBase62(bytes);
  const fullKey = KEY_PREFIX + encoded;
  const prefix = extractPrefix(fullKey);
  const hash = await hashRavenApiKey(fullKey);
  return { fullKey, prefix, hash };
}

/** Bcrypt hash a full API key for storage. */
export async function hashRavenApiKey(fullKey: string): Promise<string> {
  return bcrypt.hash(fullKey, BCRYPT_COST);
}

/** Verify a full API key against its stored bcrypt hash. */
export async function verifyRavenApiKey(
  fullKey: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(fullKey, hash);
}

/** Extract display prefix from a full key. Returns first 8 chars: "hrv_a1B2" */
export function extractPrefix(fullKey: string): string {
  return fullKey.substring(0, KEY_PREFIX.length + 4);
}
