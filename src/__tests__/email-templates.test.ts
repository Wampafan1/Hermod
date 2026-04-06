import { describe, it, expect } from "vitest";
import {
  renderEmailTemplate,
  renderPlainText,
  buildSubject,
  escapeHtml,
  formatFileSize,
  parseSqlPreview,
  type HermodEmailModel,
} from "@/lib/email-templates";

const baseModel: HermodEmailModel = {
  reportName: "Monthly Sales",
  reportDate: "February 24, 2026",
  filename: "Monthly_Sales_2026-02-24.xlsx",
  fileSize: "142.3 KB",
  nextSchedule: "Monday, March 2 at 8:00 AM",
  recipientName: "Finance Team",
};

const adminModel: HermodEmailModel = {
  ...baseModel,
  clientName: "Acme Corp",
  datasource: "prod-postgres",
  executionDate: "2026-02-24 08:00:12",
  duration: "2.3s",
  rowCount: 1547,
  sheetCount: 1,
  sqlPreview: "SELECT name, amount, date FROM orders WHERE date > '2026-01-01' ORDER BY date DESC",
  version: "0.1.0",
  managedBy: "JDelg",
};

describe("escapeHtml", () => {
  it("escapes all five HTML entities", () => {
    expect(escapeHtml('Hello <script>alert("xss")</script> & \'world\'')).toBe(
      "Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;world&#39;"
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });
});

describe("formatFileSize", () => {
  it("formats bytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatFileSize(145678)).toBe("142.3 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("formats exactly 1 KB boundary", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });
});

describe("parseSqlPreview", () => {
  it("highlights SQL keywords", () => {
    const result = parseSqlPreview("SELECT name FROM users WHERE active = 1");
    expect(result).toContain("SELECT");
    expect(result).toContain("FROM");
    expect(result).toContain("WHERE");
    expect(result).toContain("color:rgba(124,160,214,0.6)");
  });

  it("escapes HTML in SQL", () => {
    const result = parseSqlPreview("SELECT * FROM users WHERE name = '<script>'");
    expect(result).toContain("&lt;script&gt;");
    expect(result).not.toContain("<script>");
  });

  it("truncates long SQL at 200 chars", () => {
    const longSql = "SELECT " + "a".repeat(250) + " FROM table1";
    const result = parseSqlPreview(longSql);
    expect(result).toContain("...");
  });

  it("normalizes whitespace", () => {
    const result = parseSqlPreview("SELECT\n  name,\n  email\nFROM\n  users");
    // Whitespace should be collapsed
    expect(result).not.toContain("\n");
  });
});

describe("renderEmailTemplate — enduser", () => {
  it("renders enduser template with all shared placeholders", () => {
    const html = renderEmailTemplate("enduser", baseModel);

    expect(html).toContain("Monthly Sales");
    expect(html).toContain("February 24, 2026");
    expect(html).toContain("Monthly_Sales_2026-02-24.xlsx");
    expect(html).toContain("142.3 KB");
    expect(html).toContain("Monday, March 2 at 8:00 AM");
    expect(html).toContain("Finance Team");
  });

  it("does not include custom message block when no message", () => {
    const html = renderEmailTemplate("enduser", baseModel);
    expect(html).not.toContain("{{CUSTOM_MESSAGE_BLOCK}}");
    expect(html).not.toContain("Note</p>");
  });

  it("includes custom message block when provided", () => {
    const html = renderEmailTemplate("enduser", {
      ...baseModel,
      customMessage: "Please review the attached figures.",
    });
    expect(html).toContain("Please review the attached figures.");
    expect(html).toContain("Note</p>");
  });

  it("escapes HTML in custom message", () => {
    const html = renderEmailTemplate("enduser", {
      ...baseModel,
      customMessage: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("produces valid HTML structure", () => {
    const html = renderEmailTemplate("enduser", baseModel);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("YOUR REPORT");
  });

  it("has no unreplaced placeholders", () => {
    const html = renderEmailTemplate("enduser", baseModel);
    // Check no {{...}} remain (except CSS that might use {{ }})
    const remaining = html.match(/\{\{[A-Z_]+\}\}/g);
    expect(remaining).toBeNull();
  });
});

describe("renderEmailTemplate — admin", () => {
  it("renders admin template with technical metadata", () => {
    const html = renderEmailTemplate("admin", adminModel);

    expect(html).toContain("Monthly Sales");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("prod-postgres");
    expect(html).toContain("2026-02-24 08:00:12");
    expect(html).toContain("2.3s");
    expect(html).toContain("1547");
    expect(html).toContain("Monthly_Sales_2026-02-24.xlsx");
    expect(html).toContain("JDelg");
  });

  it("renders SQL preview in admin template", () => {
    const html = renderEmailTemplate("admin", adminModel);
    // SQL keywords should be highlighted
    expect(html).toContain("SELECT");
    expect(html).toContain("THE INCANTATION");
  });

  it("escapes report name containing HTML", () => {
    const html = renderEmailTemplate("admin", {
      ...adminModel,
      reportName: '<script>alert("xss")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has no unreplaced admin placeholders", () => {
    const html = renderEmailTemplate("admin", adminModel);
    const remaining = html.match(/\{\{[A-Z_]+\}\}/g);
    expect(remaining).toBeNull();
  });

  it("produces valid dark theme HTML", () => {
    const html = renderEmailTemplate("admin", adminModel);
    expect(html).toContain("background-color:#0a0b0f");
    expect(html).toContain("DELIVERY COMPLETE");
  });
});

describe("renderEmailTemplate — errors", () => {
  it("throws on unknown template name", () => {
    expect(() =>
      renderEmailTemplate("unknown" as "admin", baseModel)
    ).toThrow("Unknown email template: unknown");
  });
});

describe("renderPlainText", () => {
  it("generates plain text with report details", () => {
    const text = renderPlainText(baseModel);
    expect(text).toContain("Report: Monthly Sales");
    expect(text).toContain("Date: February 24, 2026");
    expect(text).toContain("Prepared for: Finance Team");
    expect(text).toContain("Attachment: Monthly_Sales_2026-02-24.xlsx");
  });

  it("includes row count and duration for admin model", () => {
    const text = renderPlainText(adminModel);
    expect(text).toContain("Rows: 1547");
    expect(text).toContain("Duration: 2.3s");
  });

  it("includes custom message", () => {
    const text = renderPlainText({
      ...baseModel,
      customMessage: "Urgent review needed",
    });
    expect(text).toContain("Note: Urgent review needed");
  });

  it("includes next schedule", () => {
    const text = renderPlainText(baseModel);
    expect(text).toContain("Next delivery: Monday, March 2 at 8:00 AM");
  });

  it("omits next delivery when N/A", () => {
    const text = renderPlainText({ ...baseModel, nextSchedule: "N/A" });
    expect(text).not.toContain("Next delivery:");
  });
});

describe("buildSubject", () => {
  it("builds standard subject line", () => {
    expect(buildSubject("Sales Report", "February 24, 2026")).toBe(
      "Sales Report \u2014 February 24, 2026"
    );
  });

  it("builds test subject with prefix", () => {
    expect(buildSubject("Sales Report", "February 24, 2026", true)).toBe(
      "[Test] Sales Report \u2014 February 24, 2026"
    );
  });
});
