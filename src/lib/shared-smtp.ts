import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let sharedTransport: Transporter | null = null;

export function isSharedSmtpConfigured(): boolean {
  return !!(process.env.SES_SMTP_HOST && process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS);
}

export function getSharedTransport(): Transporter {
  if (!sharedTransport) {
    if (!isSharedSmtpConfigured()) {
      throw new Error("Shared SMTP is not configured. Set SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS.");
    }
    sharedTransport = nodemailer.createTransport({
      host: process.env.SES_SMTP_HOST,
      port: parseInt(process.env.SES_SMTP_PORT || "587", 10),
      secure: false,
      auth: { user: process.env.SES_SMTP_USER!, pass: process.env.SES_SMTP_PASS! },
    });
  }
  return sharedTransport;
}

export function getSharedFromAddress(): string {
  const name = process.env.SES_FROM_NAME || "Hermod Reports";
  const addr = process.env.SES_FROM_ADDRESS || "reports@hermodforge.com";
  return `"${name}" <${addr}>`;
}
