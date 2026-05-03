import { describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class {
    send() {
      return Promise.reject(new Error("No credentials"));
    }
  },
  GetCallerIdentityCommand: class {},
}));

describe("AWS runtime credential check", () => {
  it("returns unavailable gracefully when runtime credentials are missing", async () => {
    const { checkAwsRuntimeCredentials } = await import("@/lib/backups/provisioning/aws-provisioner");
    const result = await checkAwsRuntimeCredentials("us-east-1");

    expect(result.available).toBe(false);
    expect(result.message).toMatch(/runtime credentials/i);
  });
});
