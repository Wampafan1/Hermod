import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSendMail, mockVerify } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
  mockVerify: vi.fn().mockResolvedValue(true),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: mockSendMail,
      verify: mockVerify,
    })),
  },
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));

import {
  sendReportEmail,
  sendNotificationEmail,
  testEmailConnection,
  toEmailConfig,
  replaceTemplateVars,
} from "@/lib/email";
import type { EmailConnectionConfig } from "@/lib/email";

const plainConnection: EmailConnectionConfig = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  authType: "PLAIN",
  username: "user@example.com",
  password: "secret",
  fromAddress: "Hermod <reports@example.com>",
};

const noAuthConnection: EmailConnectionConfig = {
  host: "relay.internal.com",
  port: 25,
  secure: false,
  authType: "NONE",
  username: null,
  password: null,
  fromAddress: "reports@company.com",
};

describe("sendReportEmail", () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it("sends email with attachment via PLAIN auth", async () => {
    await sendReportEmail({
      connection: plainConnection,
      to: ["alice@example.com"],
      subject: "Daily Report",
      body: "Report attached.",
      attachment: Buffer.from("xlsx-bytes"),
      filename: "report.xlsx",
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe("Hermod <reports@example.com>");
    expect(call.to).toBe("alice@example.com");
    expect(call.subject).toBe("Daily Report");
    expect(call.text).toBe("Report attached.");
    expect(call.attachments).toHaveLength(1);
    expect(call.attachments[0].filename).toBe("report.xlsx");
  });

  it("joins multiple recipients", async () => {
    await sendReportEmail({
      connection: plainConnection,
      to: ["alice@example.com", "bob@example.com"],
      subject: "Report",
      body: "Body",
      attachment: Buffer.from("data"),
      filename: "file.xlsx",
    });

    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe("alice@example.com, bob@example.com");
  });

  it("works with NONE auth connection", async () => {
    await sendReportEmail({
      connection: noAuthConnection,
      to: ["test@example.com"],
      subject: "Test",
      body: "Body",
      attachment: Buffer.from("data"),
      filename: "file.xlsx",
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.from).toBe("reports@company.com");
  });
});

describe("sendNotificationEmail", () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it("sends plain text email without attachment", async () => {
    await sendNotificationEmail({
      connection: plainConnection,
      to: ["admin@example.com"],
      subject: "Alert",
      body: "Something happened",
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    const call = mockSendMail.mock.calls[0][0];
    expect(call.text).toBe("Something happened");
    expect(call.attachments).toBeUndefined();
  });

  it("skips sending when recipients list is empty", async () => {
    await sendNotificationEmail({
      connection: plainConnection,
      to: [],
      subject: "Alert",
      body: "Body",
    });

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("testEmailConnection", () => {
  beforeEach(() => {
    mockVerify.mockClear();
  });

  it("returns success when verify passes", async () => {
    mockVerify.mockResolvedValueOnce(true);
    const result = await testEmailConnection(plainConnection);
    expect(result).toEqual({ success: true });
  });

  it("returns error when verify fails", async () => {
    mockVerify.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await testEmailConnection(plainConnection);
    expect(result).toEqual({ success: false, error: "ECONNREFUSED" });
  });
});

describe("toEmailConfig", () => {
  it("decrypts password from database row", () => {
    const config = toEmailConfig({
      host: "smtp.test.com",
      port: 465,
      secure: true,
      authType: "PLAIN",
      username: "user",
      password: "encrypted:value",
      fromAddress: "test@test.com",
    });

    expect(config.password).toBe("decrypted:encrypted:value");
    expect(config.host).toBe("smtp.test.com");
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
  });

  it("returns null password when no password in row", () => {
    const config = toEmailConfig({
      host: "relay.test.com",
      port: 25,
      secure: false,
      authType: "NONE",
      username: null,
      password: null,
      fromAddress: "noreply@test.com",
    });

    expect(config.password).toBeNull();
    expect(config.authType).toBe("NONE");
  });
});

describe("replaceTemplateVars", () => {
  it("replaces all template variables", () => {
    const result = replaceTemplateVars(
      "Report: {report_name} on {date}",
      { report_name: "Sales", date: "2024-01-15" }
    );
    expect(result).toBe("Report: Sales on 2024-01-15");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = replaceTemplateVars(
      "{name} - {name}",
      { name: "Test" }
    );
    expect(result).toBe("Test - Test");
  });

  it("leaves unmatched variables unchanged", () => {
    const result = replaceTemplateVars(
      "{known} {unknown}",
      { known: "yes" }
    );
    expect(result).toBe("yes {unknown}");
  });
});
