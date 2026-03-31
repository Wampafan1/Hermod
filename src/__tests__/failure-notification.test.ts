import { describe, it, expect } from "vitest";
import { buildFailureNotificationEmail } from "@/lib/failure-notification";

describe("buildFailureNotificationEmail", () => {
  it("builds subject with report name and timestamp", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });
    expect(result.subject).toBe("[Failed] Daily Sales — 2026-03-31 08:00:00");
  });

  it("includes error message in plain text body", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });
    expect(result.text).toContain("Connection refused");
    expect(result.text).toContain("Daily Sales");
  });

  it("includes HTML body with escaped content", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Daily Sales",
      errorMessage: "Connection refused",
      timestamp: "2026-03-31 08:00:00",
    });
    expect(result.html).toContain("Connection refused");
    expect(result.html).toContain("Daily Sales");
  });

  it("escapes HTML in error message to prevent XSS", () => {
    const result = buildFailureNotificationEmail({
      reportName: "Test",
      errorMessage: '<script>alert("xss")</script>',
      timestamp: "2026-03-31 08:00:00",
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
});
