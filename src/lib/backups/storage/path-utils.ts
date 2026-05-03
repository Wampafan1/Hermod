function smallHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6) || "empty";
}

export function sanitizeObjectKeySegment(value: string | null | undefined, fallback = "item"): string {
  const raw = typeof value === "string" ? value : "";
  const joined = raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("_");

  const sanitized = joined
    .replace(/\0/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (sanitized) return sanitized;
  return `${fallback}_${smallHash(raw || fallback)}`;
}

export function normalizeStoragePrefix(prefix: string | null | undefined): string {
  if (!prefix) return "";
  return prefix
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => sanitizeObjectKeySegment(part, "folder"))
    .filter(Boolean)
    .join("/");
}

export function joinObjectKeySegments(...segments: Array<string | null | undefined>): string {
  return segments
    .flatMap((segment) => (segment ?? "").split("/"))
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

export function datePath(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function timestampForFilename(date: Date): string {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}_${hour}${minute}${second}`;
}

export function serverSlugFromConfig(config: unknown, fallback?: string | null): string {
  if (config && typeof config === "object") {
    const host = (config as { host?: unknown }).host;
    if (typeof host === "string" && host.trim()) {
      return sanitizeObjectKeySegment(host, "server");
    }
  }
  return sanitizeObjectKeySegment(fallback ?? "server", "server");
}
