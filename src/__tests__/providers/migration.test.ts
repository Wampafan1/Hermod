import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock crypto (hoisted) ────────────────────────────────
const mockDecrypt = vi.hoisted(() => vi.fn((s: string) => s));
const mockEncrypt = vi.hoisted(() => vi.fn((s: string) => `enc:${s}`));

vi.mock("@/lib/crypto", () => ({
  decrypt: mockDecrypt,
  encrypt: mockEncrypt,
}));

// ─── Imports ──────────────────────────────────────────────
import {
  transformDataSource,
  transformSftpConnection,
  tryDecrypt,
} from "@/lib/providers/migrate-connections";

// ─── Fixtures ─────────────────────────────────────────────

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    id: "ds-1",
    name: "My DB",
    type: "POSTGRES" as const,
    host: "db.example.com",
    port: 5432,
    database: "mydb",
    username: "admin",
    password: "encrypted-pw",
    extras: null as unknown,
    userId: "user-1",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    ...overrides,
  };
}

function makeSftpConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "sftp-1",
    name: "ADP Upload",
    description: "ADP payroll feed",
    sourceType: "ADP" as const,
    sftpHost: "sftp.example.com",
    sftpPort: 2222,
    sftpUsername: "adp-user",
    sftpPassword: "encrypted-sftp-pw",
    fileFormat: "CSV" as const,
    bqDataset: "payroll",
    bqTable: "adp_raw",
    loadMode: "REPLACE" as const,
    notificationEmails: ["ops@example.com"],
    status: "ACTIVE" as const,
    lastFileAt: null,
    lastFileName: null,
    filesProcessed: 0,
    userId: "user-1",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-06-01"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────

describe("tryDecrypt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns decrypted value when decrypt succeeds", () => {
    mockDecrypt.mockReturnValueOnce("plain-text");
    expect(tryDecrypt("some-encrypted")).toBe("plain-text");
    expect(mockDecrypt).toHaveBeenCalledWith("some-encrypted");
  });

  it("returns raw value when decrypt throws", () => {
    mockDecrypt.mockImplementationOnce(() => {
      throw new Error("Invalid encrypted format");
    });
    expect(tryDecrypt("already-plain")).toBe("already-plain");
  });

  it("returns empty string for null/undefined", () => {
    expect(tryDecrypt(null)).toBe("");
    expect(tryDecrypt(undefined)).toBe("");
  });
});

describe("transformDataSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default passthrough behavior
    mockDecrypt.mockImplementation((s: string) => s);
    mockEncrypt.mockImplementation((s: string) => `enc:${s}`);
  });

  it("transforms POSTGRES DataSource correctly", () => {
    const ds = makeDataSource({
      type: "POSTGRES",
      host: "pg.example.com",
      port: 5432,
      database: "analytics",
      username: "reader",
      password: "enc-pw-123",
    });

    const result = transformDataSource(ds);

    expect(result.oldId).toBe("ds-1");
    expect(result.name).toBe("My DB");
    expect(result.type).toBe("POSTGRES");
    expect(result.userId).toBe("user-1");
    expect(result.status).toBe("ACTIVE");
    expect(result.config).toEqual({
      host: "pg.example.com",
      port: 5432,
      database: "analytics",
      username: "reader",
      ssl: false,
    });
    // decrypt is called on ds.password, result is wrapped in JSON and encrypted
    expect(mockDecrypt).toHaveBeenCalledWith("enc-pw-123");
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({ password: "enc-pw-123" }); // passthrough mock: decrypt returns input
  });

  it("transforms MSSQL DataSource with correct default port", () => {
    const ds = makeDataSource({
      type: "MSSQL",
      host: "sql.example.com",
      port: 1433,
      database: "erp",
      username: "sa",
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("MSSQL");
    expect(result.config).toEqual({
      host: "sql.example.com",
      port: 1433,
      database: "erp",
      username: "sa",
      ssl: false,
    });
  });

  it("transforms MYSQL DataSource with correct default port", () => {
    const ds = makeDataSource({
      type: "MYSQL",
      host: "mysql.example.com",
      port: 3306,
      database: "app",
      username: "root",
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("MYSQL");
    expect(result.config).toEqual({
      host: "mysql.example.com",
      port: 3306,
      database: "app",
      username: "root",
      ssl: false,
    });
  });

  it("transforms BIGQUERY DataSource: projectId extracted from extras, serviceAccountKey wraps extras", () => {
    const serviceAccount = {
      type: "service_account",
      project_id: "my-gcp-project",
      private_key_id: "key-123",
      private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
      client_email: "svc@my-gcp-project.iam.gserviceaccount.com",
    };

    const ds = makeDataSource({
      type: "BIGQUERY",
      host: null,
      port: null,
      database: null,
      username: null,
      password: null,
      extras: serviceAccount,
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("BIGQUERY");
    expect(result.config).toEqual({
      projectId: "my-gcp-project",
      location: "US",
    });
    // credentials should wrap the full service account JSON
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({ serviceAccountKey: serviceAccount });
  });

  it("transforms BIGQUERY with projectId key variant", () => {
    const ds = makeDataSource({
      type: "BIGQUERY",
      extras: { projectId: "alt-project", client_email: "x@y.com" },
    });

    const result = transformDataSource(ds);

    expect(result.config).toEqual({
      projectId: "alt-project",
      location: "US",
    });
  });

  it("transforms NETSUITE DataSource: accountId in config, secrets in credentials, tryDecrypt on secrets", () => {
    const extras = {
      accountId: "12345_SB1",
      consumerKey: "ck-plain",
      consumerSecret: "enc-cs-value",
      tokenId: "tk-plain",
      tokenSecret: "enc-ts-value",
    };

    const ds = makeDataSource({
      type: "NETSUITE",
      host: null,
      port: null,
      database: null,
      username: null,
      password: null,
      extras,
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("NETSUITE");
    expect(result.config).toEqual({
      accountId: "12345_SB1",
    });

    // tryDecrypt is called on consumerSecret and tokenSecret
    // With passthrough mock, decrypt returns the input value
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({
      consumerKey: "ck-plain",
      consumerSecret: "enc-cs-value", // passthrough mock: decrypt returns input
      tokenId: "tk-plain",
      tokenSecret: "enc-ts-value",
    });
  });

  it("handles null/undefined extras gracefully for BIGQUERY", () => {
    const ds = makeDataSource({
      type: "BIGQUERY",
      extras: null,
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("BIGQUERY");
    expect(result.config).toEqual({
      projectId: undefined,
      location: "US",
    });
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({ serviceAccountKey: null });
  });

  it("handles null/undefined extras gracefully for NETSUITE", () => {
    const ds = makeDataSource({
      type: "NETSUITE",
      extras: null,
    });

    const result = transformDataSource(ds);

    expect(result.type).toBe("NETSUITE");
    expect(result.config).toEqual({
      accountId: undefined,
    });
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({
      consumerKey: undefined,
      consumerSecret: "",
      tokenId: undefined,
      tokenSecret: "",
    });
  });

  it("handles null password for SQL types", () => {
    const ds = makeDataSource({
      type: "POSTGRES",
      password: null,
    });

    const result = transformDataSource(ds);

    // Should not call decrypt for null password
    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({ password: "" });
  });
});

describe("transformSftpConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecrypt.mockImplementation((s: string) => s);
    mockEncrypt.mockImplementation((s: string) => `enc:${s}`);
  });

  it("transforms SFTP connection correctly", () => {
    const sftp = makeSftpConnection();

    const result = transformSftpConnection(sftp);

    expect(result.oldId).toBe("sftp-1");
    expect(result.name).toBe("ADP Upload");
    expect(result.type).toBe("SFTP");
    expect(result.userId).toBe("user-1");
    expect(result.status).toBe("ACTIVE");
    expect(result.config).toEqual({
      host: "sftp.example.com",
      port: 2222,
      username: "adp-user",
      fileFormat: "CSV",
      sourceType: "ADP",
    });

    const credJson = JSON.parse(
      result.credentials.replace(/^enc:/, "")
    );
    expect(credJson).toEqual({
      password: "encrypted-sftp-pw", // passthrough mock
    });
  });

  it("preserves DISABLED status", () => {
    const sftp = makeSftpConnection({ status: "DISABLED" });

    const result = transformSftpConnection(sftp);

    expect(result.status).toBe("DISABLED");
  });

  it("preserves ERROR status", () => {
    const sftp = makeSftpConnection({ status: "ERROR" });

    const result = transformSftpConnection(sftp);

    expect(result.status).toBe("ERROR");
  });

  it("defaults status to ACTIVE when not provided", () => {
    const sftp = makeSftpConnection();
    // Simulate a record that somehow lacks status
    delete (sftp as Record<string, unknown>).status;

    const result = transformSftpConnection(sftp);

    expect(result.status).toBe("ACTIVE");
  });
});
