import { describe, it, expect } from "vitest";
import {
  createConnectionSchema,
  connectionConfigSchemas,
  connectionCredentialsSchemas,
} from "@/lib/validations/unified-connections";

describe("unified connection validation", () => {
  describe("POSTGRES", () => {
    it("accepts valid postgres connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { host: "localhost", port: 5432, database: "mydb", username: "user", ssl: false },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects postgres without host", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { port: 5432, database: "mydb", username: "user" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(false);
    });

    it("defaults port to 5432", () => {
      const result = createConnectionSchema.safeParse({
        name: "My PG",
        type: "POSTGRES",
        config: { host: "localhost", database: "mydb", username: "user" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(5432);
      }
    });
  });

  describe("MSSQL", () => {
    it("accepts valid mssql connection with default port", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SQL Server",
        type: "MSSQL",
        config: { host: "sqlserver.example.com", database: "mydb", username: "sa" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(1433);
      }
    });
  });

  describe("MYSQL", () => {
    it("accepts valid mysql connection with default port", () => {
      const result = createConnectionSchema.safeParse({
        name: "My MySQL",
        type: "MYSQL",
        config: { host: "mysql.example.com", database: "mydb", username: "root" },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(3306);
      }
    });
  });

  describe("BIGQUERY", () => {
    it("accepts valid bigquery connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My BQ",
        type: "BIGQUERY",
        config: { projectId: "my-project", location: "US" },
        credentials: { serviceAccountKey: { type: "service_account", project_id: "p" } },
      });
      expect(result.success).toBe(true);
    });

    it("rejects bigquery without projectId", () => {
      const result = createConnectionSchema.safeParse({
        name: "My BQ",
        type: "BIGQUERY",
        config: { location: "US" },
        credentials: { serviceAccountKey: {} },
      });
      expect(result.success).toBe(false);
    });

    it("defaults location to US", () => {
      const result = createConnectionSchema.safeParse({
        name: "My BQ",
        type: "BIGQUERY",
        config: { projectId: "proj" },
        credentials: { serviceAccountKey: { type: "service_account" } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.location).toBe("US");
      }
    });
  });

  describe("NETSUITE", () => {
    it("accepts valid netsuite connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My NS",
        type: "NETSUITE",
        config: { accountId: "12345_SB1" },
        credentials: {
          consumerKey: "ck", consumerSecret: "cs",
          tokenId: "ti", tokenSecret: "ts",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects netsuite without tokenId", () => {
      const result = createConnectionSchema.safeParse({
        name: "My NS",
        type: "NETSUITE",
        config: { accountId: "12345" },
        credentials: { consumerKey: "ck", consumerSecret: "cs", tokenSecret: "ts" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SFTP", () => {
    it("accepts valid sftp connection", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: {
          host: "sftp.example.com", port: 22, username: "user",
          fileFormat: "CSV", sourceType: "GENERIC_FILE",
        },
        credentials: { password: "secret" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown sourceType", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: { host: "h", port: 22, username: "u", fileFormat: "CSV", sourceType: "UNKNOWN" },
        credentials: { password: "s" },
      });
      expect(result.success).toBe(false);
    });

    it("defaults port to 2222", () => {
      const result = createConnectionSchema.safeParse({
        name: "My SFTP",
        type: "SFTP",
        config: { host: "h", username: "u", fileFormat: "CSV", sourceType: "ADP" },
        credentials: { password: "s" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.config.port).toBe(2222);
      }
    });
  });

  describe("cross-type", () => {
    it("rejects empty name", () => {
      const result = createConnectionSchema.safeParse({
        name: "",
        type: "POSTGRES",
        config: { host: "h", port: 5432, database: "d", username: "u" },
        credentials: { password: "p" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown type", () => {
      const result = createConnectionSchema.safeParse({
        name: "X",
        type: "UNKNOWN",
        config: {},
        credentials: {},
      });
      expect(result.success).toBe(false);
    });
  });

  describe("config/credentials schema maps", () => {
    it("has a config schema for each supported type", () => {
      for (const t of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]) {
        expect(connectionConfigSchemas[t]).toBeDefined();
      }
    });

    it("has a credentials schema for each supported type", () => {
      for (const t of ["POSTGRES", "MSSQL", "MYSQL", "BIGQUERY", "NETSUITE", "SFTP"]) {
        expect(connectionCredentialsSchemas[t]).toBeDefined();
      }
    });
  });
});
