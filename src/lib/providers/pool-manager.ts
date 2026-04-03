/**
 * PoolManager — Connection pool cache for SQL providers.
 *
 * Pools are keyed by a hash of connection config (host+port+db+user).
 * Idle pools are reaped after POOL_IDLE_TIMEOUT_MS.
 *
 * Each provider type (POSTGRES, MYSQL, MSSQL) uses its own PoolManager instance.
 */

import { createHash } from "crypto";

const POOL_IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const POOL_MAX_CONNECTIONS = 5;
const REAP_INTERVAL_MS = 60_000; // check every 60s

export interface ManagedPool<T> {
  pool: T;
  lastUsed: number;
  key: string;
}

export class PoolManager<T> {
  private pools = new Map<string, ManagedPool<T>>();
  private reapTimer: ReturnType<typeof setInterval> | null = null;
  private destroyer: (pool: T) => Promise<void>;

  constructor(destroyer: (pool: T) => Promise<void>) {
    this.destroyer = destroyer;
  }

  /** Build a stable cache key from connection config. */
  static buildKey(parts: Record<string, unknown>): string {
    const sorted = JSON.stringify(parts, Object.keys(parts).sort());
    return createHash("sha256").update(sorted).digest("hex").slice(0, 16);
  }

  /** Get an existing pool or create a new one. */
  async getOrCreate(
    key: string,
    factory: () => Promise<T>
  ): Promise<T> {
    const existing = this.pools.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.pool;
    }

    const pool = await factory();
    this.pools.set(key, { pool, lastUsed: Date.now(), key });
    this.ensureReaper();
    return pool;
  }

  /** Close a specific pool (e.g., on auth error). */
  async evict(key: string): Promise<void> {
    const entry = this.pools.get(key);
    if (entry) {
      this.pools.delete(key);
      try {
        await this.destroyer(entry.pool);
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Close all pools (for graceful shutdown). */
  async closeAll(): Promise<void> {
    if (this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
    const entries = [...this.pools.values()];
    this.pools.clear();
    await Promise.allSettled(entries.map((e) => this.destroyer(e.pool)));
  }

  get size(): number {
    return this.pools.size;
  }

  private ensureReaper(): void {
    if (this.reapTimer) return;
    this.reapTimer = setInterval(() => this.reap(), REAP_INTERVAL_MS);
    // Don't prevent process exit
    if (this.reapTimer.unref) this.reapTimer.unref();
  }

  private async reap(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.pools) {
      if (now - entry.lastUsed > POOL_IDLE_TIMEOUT_MS) {
        this.pools.delete(key);
        try {
          await this.destroyer(entry.pool);
        } catch {
          // best-effort cleanup
        }
      }
    }
    if (this.pools.size === 0 && this.reapTimer) {
      clearInterval(this.reapTimer);
      this.reapTimer = null;
    }
  }
}

export { POOL_MAX_CONNECTIONS };
