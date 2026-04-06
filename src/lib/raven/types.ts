// ─── Raven Type Definitions ─────────────────────────
// Shared types for Raven API routes and dashboard code.
// These mirror the Raven agent's types for API contract alignment.

// RavenHeartbeat — payload sent by Raven agent
export interface RavenHeartbeat {
  ravenId: string;
  version: string;
  uptime: number; // seconds
  platform: string; // "win32"
  connections: RavenConnectionStatus[];
  activeJobs: number;
  lastJobAt?: string; // ISO datetime
  memoryUsage: number; // bytes
  cpuUsage: number; // percentage 0-100
}

export interface RavenConnectionStatus {
  id: string;
  name: string;
  driver: "mssql" | "postgres" | "mysql";
  status: "connected" | "error" | "untested";
  lastTestedAt?: string;
}

// RavenRegistration — payload sent on first connect
export interface RavenRegistration {
  ravenName: string;
  platform: string;
  version: string;
  hostname: string;
  connections: {
    id: string;
    name: string;
    driver: string;
    database: string;
  }[];
}

export interface RavenRegistrationResponse {
  ravenId: string;
  tenantId: string;
  tenantName: string;
  status: "active";
}

// Job types
export interface RavenJobDestination {
  type: "hermod_cloud" | "direct_push";
  endpoint?: string;
  table?: string;
  mode: "append" | "replace";
}

export interface RavenJobResult {
  rowCount: number;
  byteSize: number;
  durationMs: number;
  error?: string;
  chunks: number;
}

// Ingest chunk payload
export interface RavenIngestPayload {
  ravenId: string;
  chunk: number;
  totalChunks: number;
  rows: Record<string, unknown>[];
}

// Heartbeat response with optional config overrides
export interface HeartbeatResponse {
  status: "ok";
  config?: {
    pollIntervalSeconds?: number;
    maxConcurrentJobs?: number;
  };
}

// Dashboard display types
export type RavenStatusDisplay =
  | "active"
  | "stale"
  | "disconnected"
  | "revoked"
  | "pending";

export function computeRavenStatus(
  dbStatus: string,
  lastHeartbeatAt: Date | null,
  heartbeatIntervalSeconds: number = 60
): RavenStatusDisplay {
  if (dbStatus === "revoked") return "revoked";
  if (!lastHeartbeatAt) return "pending";

  const now = Date.now();
  const lastBeat = lastHeartbeatAt.getTime();
  const elapsed = (now - lastBeat) / 1000;

  if (elapsed <= heartbeatIntervalSeconds * 2) return "active";
  if (elapsed <= heartbeatIntervalSeconds * 5) return "stale";
  return "disconnected";
}
