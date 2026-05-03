import { decrypt } from "@/lib/crypto";
import type { ConnectionLike, ConnectionType } from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";

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
      if (!allowPlaintextCredentialFallback()) {
        throw new Error(`Credentials for ${connection.type} connection could not be decrypted`);
      }
      // May already be plaintext JSON (test connections before save)
      try {
        creds = JSON.parse(connection.credentials);
        console.warn(`[toConnectionLike] Credentials for ${connection.type} connection were not encrypted — using plaintext fallback`);
      } catch {
        console.error(`[toConnectionLike] Credentials for ${connection.type} connection are neither encrypted nor valid JSON`);
        throw new Error(`Credentials for ${connection.type} connection are neither encrypted nor valid JSON`);
      }
    }
  }
  return {
    type: connection.type as ConnectionType,
    config: (connection.config ?? {}) as Record<string, unknown>,
    credentials: creds,
  };
}

function allowPlaintextCredentialFallback(): boolean {
  return process.env.HERMOD_ALLOW_PLAINTEXT_CREDENTIALS === "true" || process.env.NODE_ENV !== "production";
}

/**
 * Resolve @param placeholders in a query via string interpolation.
 * Used by SQL providers that don't support native parameterized streaming.
 * BigQuery uses its own native params — this is the fallback for others.
 */
export function resolveQueryParams(config: SourceConfig): string {
  let { query } = config;
  const params = config.params;
  if (!params) return query;

  for (const [key, value] of Object.entries(params)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid query parameter name: ${key}`);
    }
    query = query.replace(new RegExp(`@${key}\\b`, "g"), sqlLiteral(value));
  }
  return query;
}

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) {
    throw new Error("Query parameter values cannot be undefined");
  }
  if (value instanceof Date) return quoteSqlString(value.toISOString());
  if (Array.isArray(value) || typeof value === "object") {
    throw new Error("Query parameter values must be scalar");
  }
  return quoteSqlString(String(value));
}

function quoteSqlString(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Query parameter values cannot contain NUL bytes");
  }
  return `'${value.replace(/'/g, "''")}'`;
}
