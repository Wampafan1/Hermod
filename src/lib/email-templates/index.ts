/**
 * Email template rendering engine for Hermod report delivery.
 *
 * Two templates:
 * - "admin"   — dark Norse aesthetic with technical metadata (SQL preview, duration, row count)
 * - "enduser" — light professional parchment for business recipients
 */
import { ADMIN_TEMPLATE } from "./admin";
import { ENDUSER_TEMPLATE, CUSTOM_MESSAGE_BLOCK } from "./enduser";

export type EmailTemplateName = "admin" | "enduser";

/** All data needed to render an email template. Admin-only fields are optional. */
export interface HermodEmailModel {
  // ── Shared fields (both templates) ────────────────────
  reportName: string;
  reportDate: string;        // e.g., "February 24, 2026"
  filename: string;          // e.g., "Sales_Report_2026-02-24.xlsx"
  fileSize: string;          // e.g., "142 KB"
  nextSchedule: string;      // e.g., "Tomorrow at 8:00 AM CST" or "N/A"
  recipientName: string;     // Per-recipient name or "Team"

  // ── Enduser-only fields ──────────────────────────────
  customMessage?: string;    // Optional note from sender

  // ── Admin-only fields ────────────────────────────────
  clientName?: string;       // Recipient/client name
  datasource?: string;       // Data source name
  executionDate?: string;    // e.g., "2026-02-24 08:00:12 CST"
  duration?: string;         // e.g., "2.3s"
  rowCount?: number;
  sheetCount?: number;
  sqlPreview?: string;       // Truncated SQL for "The Incantation" section
  version?: string;          // Hermod version string
  managedBy?: string;        // Admin/sender display name
}

const TEMPLATES: Record<EmailTemplateName, string> = {
  admin: ADMIN_TEMPLATE,
  enduser: ENDUSER_TEMPLATE,
};

/**
 * HTML-escape a string to prevent XSS in email templates.
 * Handles the five standard HTML entities.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Format a byte count into a human-readable file size string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Parse a SQL query into a short preview for the admin template's "Incantation" section.
 * Returns a formatted string with colorized SQL keywords via inline styles.
 */
export function parseSqlPreview(sql: string): string {
  // Normalize whitespace
  const cleaned = sql.replace(/\s+/g, " ").trim();

  // Truncate to first 200 chars of the cleaned SQL
  const truncated = cleaned.length > 200 ? cleaned.slice(0, 200) + " ..." : cleaned;

  // Colorize SQL keywords with inline styles for email compatibility
  const keywordColor = "rgba(124,160,214,0.6)";
  const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|AS|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|IN|NOT|NULL|IS|LIKE|BETWEEN|EXISTS)\b/gi;

  const highlighted = escapeHtml(truncated).replace(keywords, (match) =>
    `<span style="color:${keywordColor};">${match.toUpperCase()}</span>`
  );

  return highlighted;
}

/**
 * Render an email template with the given model data.
 * All user-provided values are HTML-escaped before substitution.
 */
export function renderEmailTemplate(
  templateName: EmailTemplateName,
  model: HermodEmailModel
): string {
  let html = TEMPLATES[templateName];
  if (!html) {
    throw new Error(`Unknown email template: ${templateName}`);
  }

  // Build variable map — escape all string values
  const vars: Record<string, string> = {
    REPORT_NAME: escapeHtml(model.reportName),
    REPORT_DATE: escapeHtml(model.reportDate),
    FILENAME: escapeHtml(model.filename),
    FILE_SIZE: escapeHtml(model.fileSize),
    NEXT_SCHEDULE: escapeHtml(model.nextSchedule),
    RECIPIENT_NAME: escapeHtml(model.recipientName),
    // Admin fields
    CLIENT_NAME: escapeHtml(model.clientName || model.recipientName),
    DATASOURCE: escapeHtml(model.datasource || ""),
    EXECUTION_DATE: escapeHtml(model.executionDate || model.reportDate),
    DURATION: escapeHtml(model.duration || ""),
    ROW_COUNT: String(model.rowCount ?? 0),
    SHEET_COUNT: String(model.sheetCount ?? 1),
    // SQL preview is pre-formatted HTML (already escaped internally)
    SQL_PREVIEW: model.sqlPreview ? parseSqlPreview(model.sqlPreview) : "",
    VERSION: escapeHtml(model.version || "0.1.0"),
    MANAGED_BY: escapeHtml(model.managedBy || "Hermod"),
  };

  // Handle conditional custom message block (enduser template)
  if (templateName === "enduser") {
    if (model.customMessage && model.customMessage.trim()) {
      const messageBlock = CUSTOM_MESSAGE_BLOCK.replace(
        "{{CUSTOM_MESSAGE}}",
        escapeHtml(model.customMessage)
      );
      html = html.replace("{{CUSTOM_MESSAGE_BLOCK}}", messageBlock);
    } else {
      html = html.replace("{{CUSTOM_MESSAGE_BLOCK}}", "");
    }
  }

  // Replace all {{VARIABLE}} placeholders
  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return html;
}

/**
 * Generate a plain-text fallback from the model (for email clients without HTML support).
 */
export function renderPlainText(model: HermodEmailModel): string {
  const lines = [
    `HERMOD - Report Delivery`,
    ``,
    `Report: ${model.reportName}`,
    `Date: ${model.reportDate}`,
    `Prepared for: ${model.recipientName}`,
    ``,
    `Attachment: ${model.filename} (${model.fileSize})`,
  ];

  if (model.rowCount !== undefined) {
    lines.push(`Rows: ${model.rowCount}`);
  }
  if (model.duration) {
    lines.push(`Duration: ${model.duration}`);
  }
  if (model.customMessage) {
    lines.push(``, `Note: ${model.customMessage}`);
  }
  if (model.nextSchedule && model.nextSchedule !== "N/A") {
    lines.push(``, `Next delivery: ${model.nextSchedule}`);
  }

  lines.push(``, `---`, `This report was automatically generated by Hermod.`);
  return lines.join("\n");
}

/**
 * Build the email subject line for a report delivery.
 */
export function buildSubject(reportName: string, reportDate: string, isTest = false): string {
  const prefix = isTest ? "[Test] " : "";
  return `${prefix}${reportName} \u2014 ${reportDate}`;
}
