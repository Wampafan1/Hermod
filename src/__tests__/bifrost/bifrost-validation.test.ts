import { describe, it, expect } from "vitest";
import {
  createRouteSchema,
  updateRouteSchema,
  fetchSchemaSchema,
} from "@/lib/validations/bifrost";

describe("Bifrost Zod validation", () => {
  describe("createRouteSchema", () => {
    const validInput = {
      name: "Test Route",
      sourceId: "src_1",
      sourceConfig: { query: "SELECT * FROM test" },
      destId: "dest_1",
      destConfig: {
        dataset: "dest_ds",
        table: "dest_tbl",
        writeDisposition: "WRITE_APPEND" as const,
        autoCreateTable: false,
      },
    };

    it("accepts valid input", () => {
      const result = createRouteSchema.parse(validInput);
      expect(result.name).toBe("Test Route");
      expect(result.timeHour).toBe(7); // default
    });

    it("rejects missing name", () => {
      expect(() =>
        createRouteSchema.parse({ ...validInput, name: "" })
      ).toThrow();
    });

    it("rejects missing source query", () => {
      expect(() =>
        createRouteSchema.parse({
          ...validInput,
          sourceConfig: { query: "" },
        })
      ).toThrow();
    });

    it("rejects missing destination dataset", () => {
      expect(() =>
        createRouteSchema.parse({
          ...validInput,
          destConfig: { ...validInput.destConfig, dataset: "" },
        })
      ).toThrow();
    });

    it("rejects invalid write disposition", () => {
      expect(() =>
        createRouteSchema.parse({
          ...validInput,
          destConfig: { ...validInput.destConfig, writeDisposition: "INVALID" },
        })
      ).toThrow();
    });

    it("accepts all valid write dispositions", () => {
      for (const wd of ["WRITE_APPEND", "WRITE_TRUNCATE", "WRITE_EMPTY"]) {
        const result = createRouteSchema.parse({
          ...validInput,
          destConfig: { ...validInput.destConfig, writeDisposition: wd },
        });
        expect(result.destConfig.writeDisposition).toBe(wd);
      }
    });

    it("accepts optional schedule fields", () => {
      const result = createRouteSchema.parse({
        ...validInput,
        frequency: "WEEKLY",
        daysOfWeek: [1, 3, 5],
        timeHour: 14,
        timeMinute: 30,
        timezone: "America/New_York",
      });

      expect(result.frequency).toBe("WEEKLY");
      expect(result.daysOfWeek).toEqual([1, 3, 5]);
    });

    it("rejects invalid day of week", () => {
      expect(() =>
        createRouteSchema.parse({
          ...validInput,
          daysOfWeek: [7], // max is 6
        })
      ).toThrow();
    });

    it("rejects invalid hour", () => {
      expect(() =>
        createRouteSchema.parse({ ...validInput, timeHour: 25 })
      ).toThrow();
    });

    it("accepts chunkSize in sourceConfig", () => {
      const result = createRouteSchema.parse({
        ...validInput,
        sourceConfig: { query: "SELECT 1", chunkSize: 5000 },
      });
      expect(result.sourceConfig.chunkSize).toBe(5000);
    });

    it("rejects chunkSize below minimum", () => {
      expect(() =>
        createRouteSchema.parse({
          ...validInput,
          sourceConfig: { query: "SELECT 1", chunkSize: 50 },
        })
      ).toThrow();
    });
  });

  describe("updateRouteSchema", () => {
    it("accepts partial update", () => {
      const result = updateRouteSchema.parse({ name: "Updated" });
      expect(result.name).toBe("Updated");
    });

    it("accepts empty object", () => {
      const result = updateRouteSchema.parse({});
      expect(result).toEqual({});
    });

    it("accepts enabled toggle", () => {
      const result = updateRouteSchema.parse({ enabled: false });
      expect(result.enabled).toBe(false);
    });
  });

  describe("fetchSchemaSchema", () => {
    it("accepts valid input", () => {
      const result = fetchSchemaSchema.parse({
        connectionId: "conn_1",
        dataset: "my_dataset",
        table: "my_table",
      });
      expect(result.connectionId).toBe("conn_1");
    });

    it("rejects missing fields", () => {
      expect(() =>
        fetchSchemaSchema.parse({ connectionId: "" })
      ).toThrow();
    });
  });
});
