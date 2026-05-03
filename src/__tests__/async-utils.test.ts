import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/lib/async-utils";

describe("mapWithConcurrency", () => {
  it("limits concurrent work", async () => {
    let active = 0;
    let maxActive = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("processes every item once", async () => {
    const seen: number[] = [];

    await mapWithConcurrency([1, 2, 3], 10, async (item) => {
      seen.push(item);
    });

    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("does not issue new work after the first failure", async () => {
    const started: number[] = [];

    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
        started.push(item);
        if (item === 1) {
          throw new Error("stop");
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      })
    ).rejects.toThrow("stop");

    expect(started).toEqual([1, 2]);
  });
});
