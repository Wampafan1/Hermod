import { describe, expect, it } from "vitest";
import { resolveQueryParams } from "@/lib/providers/helpers";

describe("resolveQueryParams", () => {
  it("escapes scalar parameter values for fallback interpolation", () => {
    const sql = resolveQueryParams({
      query: "select * from users where name = @name and status = @status",
      params: {
        name: "O'Hara",
        status: "active",
      },
    });

    expect(sql).toBe("select * from users where name = 'O''Hara' and status = 'active'");
  });

  it("rejects invalid parameter names before building a regex", () => {
    expect(() => resolveQueryParams({
      query: "select * from users where name = @name",
      params: {
        "name|.*": "x",
      },
    })).toThrow("Invalid query parameter name");
  });

  it("rejects non-scalar fallback parameter values", () => {
    expect(() => resolveQueryParams({
      query: "select * from users where metadata = @metadata",
      params: {
        metadata: { unsafe: true },
      },
    })).toThrow("Query parameter values must be scalar");
  });

  it("renders null as SQL NULL", () => {
    const sql = resolveQueryParams({
      query: "select * from users where deleted_at is @deletedAt",
      params: { deletedAt: null },
    });

    expect(sql).toBe("select * from users where deleted_at is NULL");
  });
});
