import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { decrypt } from "@/lib/crypto";
import { isSharedSmtpConfigured, getSharedTransport, getSharedFromAddress } from "@/lib/shared-smtp";
import { getTierConfig } from "@/lib/tiers";

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

/**
 * Resolve the email transport and from address for a report delivery.
 * 1. If the user has their own EmailConnection, use it (all tiers).
 * 2. If no user config AND tier requires customSmtp (Odin), throw error.
 * 3. If no user config AND tier allows shared SMTP (Heimdall/Thor), use SES.
 */
export function resolveEmailTransport(
  userConfig: EmailConnectionConfig | null,
  tenantPlan: string
): { transporter: Transporter; fromAddress: string } {
  if (userConfig) {
    return {
      transporter: createTransport(userConfig),
      fromAddress: userConfig.fromAddress,
    };
  }

  const tier = getTierConfig(tenantPlan);
  if (tier.features.customSmtp) {
    throw new Error(
      `The ${tier.displayName} tier requires your own SMTP connection for email delivery. ` +
      `Configure one in Settings → Email Connections.`
    );
  }

  if (!isSharedSmtpConfigured()) {
    throw new Error(
      "Email delivery is not available. Shared SMTP is not configured. " +
      "Contact support or configure your own SMTP connection."
    );
  }

  return {
    transporter: getSharedTransport(),
    fromAddress: getSharedFromAddress(),
  };
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
