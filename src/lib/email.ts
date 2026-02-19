import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

interface SendReportEmailOptions {
  to: string[];
  subject: string;
  body: string;
  attachment: Buffer;
  filename: string;
}

export async function sendReportEmail({
  to,
  subject,
  body,
  attachment,
  filename,
}: SendReportEmailOptions): Promise<void> {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || "Hermod <reports@hermod.app>",
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
