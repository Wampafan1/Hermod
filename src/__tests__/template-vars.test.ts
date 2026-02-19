import { describe, it, expect } from "vitest";
import { replaceTemplateVars } from "@/lib/email";

describe("replaceTemplateVars", () => {
  it("replaces all template variables", () => {
    const result = replaceTemplateVars(
      "{report_name} — {date} ({day_of_week}) — {row_count} rows in {run_time} from {connection_name}",
      {
        report_name: "Sales Report",
        date: "2026-02-18",
        day_of_week: "Wednesday",
        row_count: "1500",
        run_time: "2.3s",
        connection_name: "Production DB",
      }
    );
    expect(result).toBe(
      "Sales Report — 2026-02-18 (Wednesday) — 1500 rows in 2.3s from Production DB"
    );
  });

  it("handles repeated variables", () => {
    const result = replaceTemplateVars("{date} and {date}", {
      date: "2026-02-18",
    });
    expect(result).toBe("2026-02-18 and 2026-02-18");
  });

  it("leaves unknown variables unchanged", () => {
    const result = replaceTemplateVars("Hello {unknown}", {});
    expect(result).toBe("Hello {unknown}");
  });

  it("handles empty template", () => {
    const result = replaceTemplateVars("", { foo: "bar" });
    expect(result).toBe("");
  });
});
