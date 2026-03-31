import { escapeHtml } from "@/lib/email-templates";

interface FailureNotificationInput {
  reportName: string;
  errorMessage: string;
  timestamp: string;
}

interface FailureNotificationOutput {
  subject: string;
  text: string;
  html: string;
}

export function buildFailureNotificationEmail(
  input: FailureNotificationInput
): FailureNotificationOutput {
  const subject = `[Failed] ${input.reportName} \u2014 ${input.timestamp}`;

  const text = [
    "HERMOD \u2014 Report Failure",
    "",
    `Report: ${input.reportName}`,
    `Time: ${input.timestamp}`,
    "",
    "Error:",
    input.errorMessage,
    "",
    "---",
    "Check the Run History page for details.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#04060f;font-family:monospace;color:#d4c4a0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="border-bottom:1px solid rgba(201,147,58,0.3);padding-bottom:16px;margin-bottom:24px;">
      <h1 style="font-family:serif;font-size:18px;color:#e85d20;letter-spacing:0.15em;text-transform:uppercase;margin:0;">Report Failed</h1>
    </div>
    <table style="width:100%;font-size:13px;line-height:2;">
      <tr>
        <td style="color:rgba(212,196,160,0.7);padding-right:16px;white-space:nowrap;">Report</td>
        <td style="color:#d4c4a0;">${escapeHtml(input.reportName)}</td>
      </tr>
      <tr>
        <td style="color:rgba(212,196,160,0.7);padding-right:16px;white-space:nowrap;">Time</td>
        <td style="color:#d4c4a0;">${escapeHtml(input.timestamp)}</td>
      </tr>
    </table>
    <div style="margin-top:24px;padding:16px;background:#080c1a;border:1px solid rgba(201,147,58,0.1);">
      <p style="font-size:11px;color:rgba(212,196,160,0.7);text-transform:uppercase;letter-spacing:0.3em;margin:0 0 8px 0;">Error</p>
      <pre style="font-size:12px;color:#e85d20;white-space:pre-wrap;word-break:break-word;margin:0;">${escapeHtml(input.errorMessage)}</pre>
    </div>
    <p style="font-size:11px;color:rgba(212,196,160,0.5);margin-top:24px;">Check the Run History page for full details.</p>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
