import { decrypt } from "@/lib/crypto";
import type { ConnectionLike, ConnectionType } from "./types";

/**
 * Convert a Prisma Connection row to a ConnectionLike (decrypts credentials).
 * Use this before passing to any provider method.
 */
export function toConnectionLike(connection: {
  type: string;
  config: unknown;
  credentials: string | null;
}): ConnectionLike {
  let creds: Record<string, unknown> = {};
  if (connection.credentials) {
    try {
      const decrypted = decrypt(connection.credentials);
      creds = JSON.parse(decrypted);
    } catch {
      // May already be plaintext JSON (test connections before save)
      try {
        creds = JSON.parse(connection.credentials);
      } catch {
        /* credentials are neither encrypted nor valid JSON — leave empty */
      }
    }
  }
  return {
    type: connection.type as ConnectionType,
    config: (connection.config ?? {}) as Record<string, unknown>,
    credentials: creds,
  };
}
