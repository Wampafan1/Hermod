import { describe, it, expect } from "vitest";
import { createConnectionSchema } from "@/lib/validations/connections";
import { createReportSchema, executeQuerySchema } from "@/lib/validations/reports";
import { createScheduleSchema } from "@/lib/validations/schedules";
import { createEmailConnectionSchema } from "@/lib/validations/email-connections";

describe("connection validation", () => {
  it("accepts valid postgres connection", () => {
    const result = createConnectionSchema.safeParse({
      name: "Test DB",
      type: "POSTGRES",
      host: "localhost",
      port: 5432,
      database: "mydb",
      username: "user",
      password: "pass",
    });
    expect(result.success).toBe(true);
  });

  it("auto-fills port from string", () => {
    const result = createConnectionSchema.safeParse({
      name: "Test",
      type: "MSSQL",
      host: "db.example.com",
      port: "1433",
      database: "master",
      username: "sa",
      password: "pass",
    });
    expect(result.success).toBe(true);
    if (result.success) expect((result.data as any).port).toBe(1433);
  });

  it("rejects connection without name", () => {
    const result = createConnectionSchema.safeParse({
      name: "",
      type: "POSTGRES",
      host: "localhost",
      port: 5432,
      database: "db",
      username: "user",
      password: "pass",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid bigquery connection", () => {
    const result = createConnectionSchema.safeParse({
      name: "BQ Prod",
      type: "BIGQUERY",
      extras: {
        type: "service_account",
        project_id: "my-project",
        private_key_id: "key-id",
        private_key: "-----BEGIN RSA PRIVATE KEY-----\n...",
        client_email: "sa@my-project.iam.gserviceaccount.com",
        client_id: "123456",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects bigquery with invalid service account type", () => {
    const result = createConnectionSchema.safeParse({
      name: "BQ Bad",
      type: "BIGQUERY",
      extras: {
        type: "authorized_user",
        project_id: "my-project",
        private_key_id: "key-id",
        private_key: "key",
        client_email: "sa@gsa.com",
        client_id: "123",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid port number", () => {
    const result = createConnectionSchema.safeParse({
      name: "Test",
      type: "MYSQL",
      host: "localhost",
      port: 99999,
      database: "db",
      username: "root",
      password: "pass",
    });
    expect(result.success).toBe(false);
  });
});

describe("report validation", () => {
  it("accepts valid report", () => {
    const result = createReportSchema.safeParse({
      name: "Sales Report",
      sqlQuery: "SELECT * FROM sales",
      dataSourceId: "cuid123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects report without SQL query", () => {
    const result = createReportSchema.safeParse({
      name: "Empty Query",
      sqlQuery: "",
      dataSourceId: "cuid123",
    });
    expect(result.success).toBe(false);
  });
});

describe("query execution validation", () => {
  it("accepts valid query", () => {
    const result = executeQuerySchema.safeParse({
      connectionId: "cuid123",
      sql: "SELECT 1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty SQL", () => {
    const result = executeQuerySchema.safeParse({
      connectionId: "cuid123",
      sql: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("schedule validation", () => {
  it("accepts valid weekly schedule", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "WEEKLY",
      daysOfWeek: [1, 3, 5],
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [{ email: "test@example.com" }],
      emailSubject: "{report_name} — {date}",
      emailConnectionId: "ec123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects weekly schedule without days", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "WEEKLY",
      daysOfWeek: [],
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [{ email: "test@example.com" }],
      emailSubject: "Report",
      emailConnectionId: "ec123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects monthly schedule without dayOfMonth", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "MONTHLY",
      daysOfWeek: [],
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [{ email: "test@example.com" }],
      emailSubject: "Report",
      emailConnectionId: "ec123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects schedule without recipients", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "DAILY",
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [],
      emailSubject: "Report",
      emailConnectionId: "ec123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid recipient email", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "DAILY",
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [{ email: "not-an-email" }],
      emailSubject: "Report",
      emailConnectionId: "ec123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects schedule without emailConnectionId", () => {
    const result = createScheduleSchema.safeParse({
      reportId: "rep123",
      frequency: "DAILY",
      timeHour: 8,
      timeMinute: 0,
      timezone: "America/Chicago",
      recipients: [{ email: "test@example.com" }],
      emailSubject: "Report",
    });
    expect(result.success).toBe(false);
  });
});

describe("email connection validation", () => {
  it("accepts valid PLAIN auth email connection", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Gmail SMTP",
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      authType: "PLAIN",
      username: "user@gmail.com",
      password: "app-password",
      fromAddress: "Hermod <reports@gmail.com>",
    });
    expect(result.success).toBe(true);
  });

  it("accepts NONE auth without credentials", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Internal Relay",
      host: "relay.company.com",
      port: 25,
      secure: false,
      authType: "NONE",
      fromAddress: "reports@company.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects PLAIN auth without username", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Bad Config",
      host: "smtp.example.com",
      port: 587,
      authType: "PLAIN",
      fromAddress: "test@test.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects PLAIN auth without password", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Bad Config",
      host: "smtp.example.com",
      port: 587,
      authType: "PLAIN",
      username: "user@test.com",
      fromAddress: "test@test.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "",
      host: "smtp.example.com",
      port: 587,
      authType: "NONE",
      fromAddress: "test@test.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty host", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Test",
      host: "",
      port: 587,
      authType: "NONE",
      fromAddress: "test@test.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty fromAddress", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Test",
      host: "smtp.example.com",
      port: 587,
      authType: "NONE",
      fromAddress: "",
    });
    expect(result.success).toBe(false);
  });

  it("defaults port to 587 and secure to false", () => {
    const result = createEmailConnectionSchema.safeParse({
      name: "Test",
      host: "smtp.example.com",
      authType: "NONE",
      fromAddress: "test@test.com",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.port).toBe(587);
      expect(result.data.secure).toBe(false);
    }
  });
});
