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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    // On non-SSL ports (587), require STARTTLS upgrade
    requireTLS: !connection.secure && connection.port !== 25,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    tls: {
      // Allow self-signed certs in dev; Gmail/Outlook have valid certs anyway
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    // Use from-address domain as EHLO hostname (Windows os.hostname() returns
    // a bare machine name like "DESKTOP-XXX" which some SMTP servers reject)
    name: extractDomain(connection.fromAddress) || connection.host,
  };

  if (connection.authType !== "NONE" && connection.username && connection.password) {
    options.auth = {
      user: connection.username,
      pass: connection.password,
    };
  }

  return nodemailer.createTransport(options);
}

/** Extract domain from email/display-name string, e.g. "Hermod <a@b.com>" → "b.com" */
function extractDomain(from: string): string | null {
  const match = from.match(/@([^>\s]+)/);
  return match ? match[1] : null;
}

interface SendReportEmailOptions {
  connection: EmailConnectionConfig;
  to: string[];
  subject: string;
  /** Plain-text fallback body */
  text: string;
  /** HTML body (optional — if provided, sent as the primary content) */
  html?: string;
  attachment: Buffer;
  filename: string;
}

export async function sendReportEmail({
  connection,
  to,
  subject,
  text,
  html,
  attachment,
  filename,
}: SendReportEmailOptions): Promise<void> {
  const transporter = createTransport(connection);

  await transporter.sendMail({
    from: connection.fromAddress,
    to: to.join(", "),
    subject,
    text,
    html,
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
