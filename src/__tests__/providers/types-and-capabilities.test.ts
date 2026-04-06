import { describe, it, expect } from "vitest";
import {
  ConnectionType,
  PROVIDER_CAPABILITIES,
  getCapabilities,
  canBeSource,
  canBeDestination,
  canQuery,
} from "@/lib/providers/capabilities";

describe("PROVIDER_CAPABILITIES", () => {
  it("has an entry for every ConnectionType", () => {
    const types: ConnectionType[] = [
      "POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP",
    ];
    for (const t of types) {
      expect(PROVIDER_CAPABILITIES[t]).toBeDefined();
    }
  });

  it("BIGQUERY can be both source and destination", () => {
    const caps = getCapabilities("BIGQUERY");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(true);
    expect(caps.canQuery).toBe(true);
    expect(caps.canBulkLoad).toBe(true);
  });

  it("NETSUITE is source-only and queryable", () => {
    const caps = getCapabilities("NETSUITE");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(false);
    expect(caps.canQuery).toBe(true);
  });

  it("SFTP can be source and destination but not queryable", () => {
    const caps = getCapabilities("SFTP");
    expect(caps.canBeSource).toBe(true);
    expect(caps.canBeDestination).toBe(true);
    expect(caps.canQuery).toBe(false);
    expect(caps.fileFormats).toContain("CSV");
  });

  it("SQL databases are source and destination, queryable", () => {
    for (const t of ["POSTGRES", "MSSQL", "MYSQL"] as ConnectionType[]) {
      const caps = getCapabilities(t);
      expect(caps.canBeSource).toBe(true);
      expect(caps.canBeDestination).toBe(true);
      expect(caps.canQuery).toBe(true);
      expect(caps.canBulkLoad).toBe(true);
    }
  });

  it("helper functions filter correctly", () => {
    expect(canBeSource("POSTGRES")).toBe(true);
    expect(canBeDestination("POSTGRES")).toBe(true);
    expect(canQuery("SFTP")).toBe(false);
    expect(canBeDestination("BIGQUERY")).toBe(true);
  });

  it("throws for unknown type", () => {
    expect(() => getCapabilities("UNKNOWN" as ConnectionType)).toThrow();
  });
});
