import { describe, it, expect, vi, beforeEach } from "vitest";
import { PoolManager } from "@/lib/providers/pool-manager";

describe("PoolManager", () => {
  let destroyed: string[];
  let manager: PoolManager<{ id: string }>;

  beforeEach(() => {
    destroyed = [];
    manager = new PoolManager(async (pool) => {
      destroyed.push(pool.id);
    });
  });

  it("creates a pool on first getOrCreate", async () => {
    const pool = await manager.getOrCreate("key1", async () => ({ id: "pool1" }));
    expect(pool.id).toBe("pool1");
    expect(manager.size).toBe(1);
  });

  it("returns cached pool on second getOrCreate with same key", async () => {
    const factory = vi.fn(async () => ({ id: "pool1" }));
    const pool1 = await manager.getOrCreate("key1", factory);
    const pool2 = await manager.getOrCreate("key1", factory);

    expect(pool1).toBe(pool2);
    expect(factory).toHaveBeenCalledTimes(1); // factory only called once
  });

  it("creates separate pools for different keys", async () => {
    const pool1 = await manager.getOrCreate("key1", async () => ({ id: "pool1" }));
    const pool2 = await manager.getOrCreate("key2", async () => ({ id: "pool2" }));

    expect(pool1.id).toBe("pool1");
    expect(pool2.id).toBe("pool2");
    expect(manager.size).toBe(2);
  });

  it("evict() removes and destroys a pool", async () => {
    await manager.getOrCreate("key1", async () => ({ id: "pool1" }));
    expect(manager.size).toBe(1);

    await manager.evict("key1");
    expect(manager.size).toBe(0);
    expect(destroyed).toEqual(["pool1"]);
  });

  it("evict() is a no-op for unknown key", async () => {
    await manager.evict("nonexistent");
    expect(destroyed).toEqual([]);
  });

  it("closeAll() destroys all pools", async () => {
    await manager.getOrCreate("key1", async () => ({ id: "pool1" }));
    await manager.getOrCreate("key2", async () => ({ id: "pool2" }));
    expect(manager.size).toBe(2);

    await manager.closeAll();
    expect(manager.size).toBe(0);
    expect(destroyed).toContain("pool1");
    expect(destroyed).toContain("pool2");
  });

  it("buildKey produces consistent hash for same input", () => {
    const key1 = PoolManager.buildKey({ host: "localhost", port: 5432 });
    const key2 = PoolManager.buildKey({ host: "localhost", port: 5432 });
    expect(key1).toBe(key2);
  });

  it("buildKey produces different hash for different input", () => {
    const key1 = PoolManager.buildKey({ host: "localhost", port: 5432 });
    const key2 = PoolManager.buildKey({ host: "localhost", port: 3306 });
    expect(key1).not.toBe(key2);
  });

  it("buildKey is order-independent", () => {
    const key1 = PoolManager.buildKey({ port: 5432, host: "localhost" });
    const key2 = PoolManager.buildKey({ host: "localhost", port: 5432 });
    expect(key1).toBe(key2);
  });

  it("re-creates pool after eviction", async () => {
    const pool1 = await manager.getOrCreate("key1", async () => ({ id: "pool1" }));
    await manager.evict("key1");

    const pool2 = await manager.getOrCreate("key1", async () => ({ id: "pool1-v2" }));
    expect(pool2.id).toBe("pool1-v2");
    expect(pool1).not.toBe(pool2);
  });
});
