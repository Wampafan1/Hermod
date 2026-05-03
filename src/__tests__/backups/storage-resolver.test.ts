import { describe, expect, it } from "vitest";
import { encrypt } from "@/lib/crypto";
import { getBackupStorageProvider } from "@/lib/backups/storage";

describe("backup storage provider resolver", () => {
  it("resolves AWS S3 targets without exposing credentials", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

    const provider = getBackupStorageProvider({
      provider: "AWS_S3",
      config: { bucket: "backups", region: "us-east-1" },
      credentials: encrypt(JSON.stringify({
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "secret",
      })),
    });

    expect(provider).toHaveProperty("uploadFile");
    expect(provider).toHaveProperty("test");
  });

  it("resolves role-based storage targets without stored credentials", () => {
    const awsProvider = getBackupStorageProvider({
      provider: "AWS_S3",
      accessMode: "AWS_RUNTIME_ROLE",
      config: { bucket: "backups", region: "us-east-1" },
      credentials: null,
    });
    const gcpProvider = getBackupStorageProvider({
      provider: "GCP_GCS",
      accessMode: "GCP_APPLICATION_DEFAULT",
      config: { bucket: "backups", projectId: "project-1" },
      credentials: null,
    });

    expect(awsProvider).toHaveProperty("uploadFile");
    expect(gcpProvider).toHaveProperty("uploadFile");
  });

  it("rejects unsupported storage providers", () => {
    expect(() => getBackupStorageProvider({
      provider: "NOT_A_PROVIDER",
      config: {},
      credentials: null,
    })).toThrow(/Unsupported backup storage provider/);
  });
});
