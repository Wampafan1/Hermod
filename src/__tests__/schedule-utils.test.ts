import { describe, it, expect } from "vitest";
import { calculateNextRun, advanceNextRun } from "@/lib/schedule-utils";
import { describeSchedule } from "@/lib/schedule-describe";

describe("calculateNextRun", () => {
  const baseDate = new Date("2026-02-18T12:00:00Z"); // Wednesday noon UTC

  describe("DAILY", () => {
    it("returns today if time has not passed", () => {
      const after = new Date("2026-02-18T06:00:00Z"); // 6am UTC = midnight CT
      const result = calculateNextRun(
        {
          frequency: "DAILY",
          daysOfWeek: [],
          dayOfMonth: null,
          timeHour: 8,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      // 8:00 AM CT = 14:00 UTC
      expect(result.getUTCHours()).toBe(14);
      expect(result.getUTCDate()).toBe(18);
    });

    it("returns tomorrow if time has passed", () => {
      const after = new Date("2026-02-18T20:00:00Z"); // 2pm CT, after 8am
      const result = calculateNextRun(
        {
          frequency: "DAILY",
          daysOfWeek: [],
          dayOfMonth: null,
          timeHour: 8,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCDate()).toBe(19);
    });
  });

  describe("WEEKLY", () => {
    it("returns the next matching day", () => {
      // After is Wednesday 2026-02-18, schedule is Mon and Fri
      const result = calculateNextRun(
        {
          frequency: "WEEKLY",
          daysOfWeek: [1, 5], // Mon, Fri
          dayOfMonth: null,
          timeHour: 9,
          timeMinute: 30,
          timezone: "America/Chicago",
        },
        baseDate
      );
      // Next Friday is Feb 20
      expect(result.getUTCDate()).toBe(20);
    });

    it("returns today if today is a scheduled day and time has not passed", () => {
      const after = new Date("2026-02-18T06:00:00Z"); // Wednesday early
      const result = calculateNextRun(
        {
          frequency: "WEEKLY",
          daysOfWeek: [3], // Wednesday
          dayOfMonth: null,
          timeHour: 8,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCDate()).toBe(18);
    });
  });

  describe("MONTHLY", () => {
    it("returns current month if day has not passed", () => {
      const after = new Date("2026-02-15T12:00:00Z");
      const result = calculateNextRun(
        {
          frequency: "MONTHLY",
          daysOfWeek: [],
          dayOfMonth: 20,
          timeHour: 10,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCDate()).toBe(20);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("returns next month if day has passed", () => {
      const after = new Date("2026-02-25T12:00:00Z");
      const result = calculateNextRun(
        {
          frequency: "MONTHLY",
          daysOfWeek: [],
          dayOfMonth: 20,
          timeHour: 10,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCMonth()).toBe(2); // March
    });

    it("handles day > days in month (falls back to last day)", () => {
      // February has 28 days in 2026, requesting day 31
      const after = new Date("2026-02-01T12:00:00Z");
      const result = calculateNextRun(
        {
          frequency: "MONTHLY",
          daysOfWeek: [],
          dayOfMonth: 31,
          timeHour: 10,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCDate()).toBe(28); // Feb 28
    });
  });

  describe("QUARTERLY", () => {
    it("returns next qualifying month", () => {
      // After is Feb 18, quarterly months are Jan, Apr, Jul, Oct
      const result = calculateNextRun(
        {
          frequency: "QUARTERLY",
          daysOfWeek: [],
          dayOfMonth: 15,
          monthsOfYear: [1, 4, 7, 10],
          timeHour: 8,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        baseDate
      );
      expect(result.getUTCMonth()).toBe(3); // April
      expect(result.getUTCDate()).toBe(15);
    });

    it("wraps to next year if all months have passed", () => {
      const after = new Date("2026-11-15T12:00:00Z");
      const result = calculateNextRun(
        {
          frequency: "QUARTERLY",
          daysOfWeek: [],
          dayOfMonth: 1,
          monthsOfYear: [1, 4, 7, 10],
          timeHour: 8,
          timeMinute: 0,
          timezone: "America/Chicago",
        },
        after
      );
      expect(result.getUTCFullYear()).toBe(2027);
      expect(result.getUTCMonth()).toBe(0); // January
    });
  });
});

describe("advanceNextRun", () => {
  it("advances biweekly by 2 weeks", () => {
    const lastRun = new Date("2026-02-18T14:00:00Z"); // 8am CT Wednesday
    const result = advanceNextRun(
      {
        frequency: "BIWEEKLY",
        daysOfWeek: [3], // Wednesday
        dayOfMonth: null,
        timeHour: 8,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      lastRun
    );
    // Should be ~2 weeks later
    const diffDays = (result.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(14, 0);
  });

  it("advances daily to next day", () => {
    const lastRun = new Date("2026-02-18T14:00:00Z");
    const result = advanceNextRun(
      {
        frequency: "DAILY",
        daysOfWeek: [],
        dayOfMonth: null,
        timeHour: 8,
        timeMinute: 0,
        timezone: "America/Chicago",
      },
      lastRun
    );
    expect(result.getUTCDate()).toBe(19);
  });
});

describe("describeSchedule", () => {
  it("describes daily schedule", () => {
    const desc = describeSchedule({
      frequency: "DAILY",
      daysOfWeek: [],
      dayOfMonth: null,
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
    });
    expect(desc).toContain("Every day");
    expect(desc).toContain("8:00 AM");
  });

  it("describes weekly schedule with multiple days", () => {
    const desc = describeSchedule({
      frequency: "WEEKLY",
      daysOfWeek: [1, 3, 5],
      dayOfMonth: null,
      timeHour: 14,
      timeMinute: 30,
      timezone: "America/Chicago",
    });
    expect(desc).toContain("Mon");
    expect(desc).toContain("Wed");
    expect(desc).toContain("Fri");
    expect(desc).toContain("2:30 PM");
  });

  it("describes monthly schedule", () => {
    const desc = describeSchedule({
      frequency: "MONTHLY",
      daysOfWeek: [],
      dayOfMonth: 15,
      timeHour: 9,
      timeMinute: 0,
      timezone: "America/New_York",
    });
    expect(desc).toContain("Monthly");
    expect(desc).toContain("15th");
    expect(desc).toContain("9:00 AM");
  });
});
