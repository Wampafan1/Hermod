import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { decrypt } from "@/lib/crypto";

export type EmailAuthType = "NONE" | "PLAIN" | "OAUTH2";

export interface EmailConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  authType: EmailAuthType;
  username?: string | null;
  password?: string | null;
  fromAddress: string;
}

/**
 * Convert a Prisma EmailConnection row to an EmailConnectionConfig,
 * decrypting the password if present.
 */
export function toEmailConfig(dbRow: {
  host: string;
  port: number;
  secure: boolean;
  authType: EmailAuthType;
  username: string | null;
  password: string | null;
  fromAddress: string;
}): EmailConnectionConfig {
  return {
    host: dbRow.host,
    port: dbRow.port,
    secure: dbRow.secure,
    authType: dbRow.authType,
    username: dbRow.username,
    password: dbRow.password ? decrypt(dbRow.password) : null,
    fromAddress: dbRow.fromAddress,
  };
}

function createTransport(connection: EmailConnectionConfig): Transporter {
  const options: nodemailer.TransportOptions & {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  } = {
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
  };

  if (connection.authType !== "NONE" && connection.username && connection.password) {
    options.auth = {
      user: connection.username,
      pass: connection.password,
    };
  }

  return nodemailer.createTransport(options);
}

interface SendReportEmailOptions {
  connection: EmailConnectionConfig;
  to: string[];
  subject: string;
  body: string;
  attachment: Buffer;
  filename: string;
}

export async function sendReportEmail({
  connection,
  to,
  subject,
  body,
  attachment,
  filename,
}: SendReportEmailOptions): Promise<void> {
  const transporter = createTransport(connection);

  await transporter.sendMail({
    from: connection.fromAddress,
    to: to.join(", "),
    subject,
    text: body,
    attachments: [
      {
        filename,
        content: attachment,
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    ],
  });
}

interface SendNotificationEmailOptions {
  connection: EmailConnectionConfig;
  to: string[];
  subject: string;
  body: string;
}

export async function sendNotificationEmail({
  connection,
  to,
  subject,
  body,
}: SendNotificationEmailOptions): Promise<void> {
  if (to.length === 0) return;

  const transporter = createTransport(connection);

  await transporter.sendMail({
    from: connection.fromAddress,
    to: to.join(", "),
    subject,
    text: body,
  });
}

/**
 * Test an SMTP connection by calling transporter.verify().
 * Returns { success: true } or { success: false, error: string }.
 */
export async function testEmailConnection(
  connection: EmailConnectionConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransport(connection);
    await transporter.verify();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Replace template variables in a string.
 */
export function replaceTemplateVars(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}
