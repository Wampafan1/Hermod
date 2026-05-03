import { expect } from "vitest";

export const SENSITIVE_RESPONSE_KEYS = [
  "password",
  "secretAccessKey",
  "accessKeyId",
  "serviceAccountKey",
  "private_key",
  "client_email",
  "tokenSecret",
  "consumerSecret",
  "refresh_token",
  "PGPASSWORD",
  "credentials",
];

export function jsonRequest(
  url: string,
  body?: unknown,
  init: Omit<RequestInit, "body"> = {}
): Request {
  return new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function readJson(response: Response) {
  return response.json();
}

function collectSensitivePaths(value: unknown, path: string[] = []): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitivePaths(item, [...path, String(index)]));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const keyPath = [...path, key];
    const current = SENSITIVE_RESPONSE_KEYS.some((sensitive) => sensitive.toLowerCase() === key.toLowerCase())
      ? [keyPath.join(".")]
      : [];
    return [...current, ...collectSensitivePaths(nested, keyPath)];
  });
}

export function expectNoSensitiveKeys(value: unknown): void {
  expect(collectSensitivePaths(value)).toEqual([]);
}

export function expectSerializableJson(value: unknown): void {
  expect(() => JSON.stringify(value)).not.toThrow();
}
