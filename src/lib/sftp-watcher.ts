import fs from "fs";
import path from "path";
import { PrismaClient, SftpStatus } from "@prisma/client";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { BigQuery } from "@google-cloud/bigquery";
import { getInboundPath, getArchivePath } from "./sftp-utils";
import { sendNotificationEmail, toEmailConfig } from "./email";

const WATCH_INTERVAL = 30_000; // 30 seconds
const SUPPORTED_EXTENSIONS = new Set([".csv", ".tsv", ".xlsx"]);

let watcherTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the SFTP file watcher. Polls all active SFTP connections' inbound
 * folders for new files, processes them, and loads to BigQuery.
 */
export function startSftpWatcher(prisma: PrismaClient): void {
  if (watcherTimer) return;
  console.log("[SFTP Watcher] Starting file watcher...");

  async function tick() {
    try {
      const connections = await prisma.sftpConnection.findMany({
        where: { status: SftpStatus.ACTIVE },
      });

      for (const conn of connections) {
        await processConnection(prisma, conn);
      }
    } catch (error) {
      console.error("[SFTP Watcher] Tick error:", error);
    }
  }

  // Initial tick
  tick();

  // Poll every 30 seconds
  watcherTimer = setInterval(tick, WATCH_INTERVAL);
  console.log(`[SFTP Watcher] Polling every ${WATCH_INTERVAL / 1000}s`);
}

/**
 * Stop the SFTP file watcher.
 */
export function stopSftpWatcher(): void {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
    console.log("[SFTP Watcher] Stopped");
  }
}

interface SftpConnectionRow {
  id: string;
  userId: string;
  sftpUsername: string;
  fileFormat: string;
  bqDataset: string;
  bqTable: string;
  loadMode: string;
  notificationEmails: string[];
  name: string;
}

async function processConnection(
  prisma: PrismaClient,
  conn: SftpConnectionRow
): Promise<void> {
  const inboundDir = getInboundPath(conn.sftpUsername);
  const archiveDir = getArchivePath(conn.sftpUsername);

  if (!fs.existsSync(inboundDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(inboundDir).filter((f) => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXTENSIONS.has(ext);
    });
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = path.join(inboundDir, file);

    // Skip files still being written (modified in last 5 seconds)
    const stat = fs.statSync(filePath);
    if (Date.now() - stat.mtimeMs < 5_000) continue;

    console.log(`[SFTP Watcher] Processing: ${conn.name} / ${file}`);

    try {
      const rows = await parseFile(filePath, conn.fileFormat);
      if (rows.length === 0) {
        console.warn(`[SFTP Watcher] Empty file skipped: ${file}`);
        moveToArchive(filePath, archiveDir, file);
        continue;
      }

      await loadToBigQuery(rows, conn.bqDataset, conn.bqTable, conn.loadMode);

      // Move to archive
      moveToArchive(filePath, archiveDir, file);

      // Update connection stats
      await prisma.sftpConnection.update({
        where: { id: conn.id },
        data: {
          lastFileAt: new Date(),
          lastFileName: file,
          filesProcessed: { increment: 1 },
        },
      });

      console.log(`[SFTP Watcher] Loaded ${rows.length} rows from ${file} → ${conn.bqDataset}.${conn.bqTable}`);

      // Send notification
      if (conn.notificationEmails.length > 0) {
        const emailConn = await prisma.emailConnection.findFirst({
          where: { userId: conn.userId },
          orderBy: { createdAt: "asc" },
        });
        if (emailConn) {
          const emailConfig = toEmailConfig(emailConn);
          await sendNotificationEmail({
            connection: emailConfig,
            to: conn.notificationEmails,
            subject: `Hermod: File processed — ${conn.name}`,
            body: [
              `File "${file}" has been processed and loaded to BigQuery.`,
              ``,
              `Connection: ${conn.name}`,
              `Destination: ${conn.bqDataset}.${conn.bqTable}`,
              `Rows loaded: ${rows.length}`,
              `Mode: ${conn.loadMode === "REPLACE" ? "Replace" : "Append"}`,
              ``,
              `— Hermod`,
            ].join("\n"),
          }).catch((err) => {
            console.error(`[SFTP Watcher] Notification email failed:`, err);
          });
        } else {
          console.warn(`[SFTP Watcher] No email connection for user ${conn.userId}, skipping notification`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SFTP Watcher] Failed to process ${file}: ${message}`);

      // Mark connection as errored
      await prisma.sftpConnection.update({
        where: { id: conn.id },
        data: { status: SftpStatus.ERROR },
      }).catch(() => {});

      // Send error notification
      if (conn.notificationEmails.length > 0) {
        const emailConn = await prisma.emailConnection.findFirst({
          where: { userId: conn.userId },
          orderBy: { createdAt: "asc" },
        }).catch(() => null);
        if (emailConn) {
          const emailConfig = toEmailConfig(emailConn);
          await sendNotificationEmail({
            connection: emailConfig,
            to: conn.notificationEmails,
            subject: `Hermod: File processing failed — ${conn.name}`,
            body: [
              `An error occurred processing "${file}".`,
              ``,
              `Connection: ${conn.name}`,
              `Error: ${message}`,
              ``,
              `The file has been left in the inbound folder. Please check the file format and try again.`,
              ``,
              `— Hermod`,
            ].join("\n"),
          }).catch((err) => {
            console.error(`[SFTP Watcher] Error notification failed:`, err);
          });
        }
      }
    }
  }
}

/**
 * Parse a file into an array of row objects.
 */
async function parseFile(
  filePath: string,
  expectedFormat: string
): Promise<Record<string, unknown>[]> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv" || ext === ".tsv") {
    const content = fs.readFileSync(filePath, "utf-8");
    const delimiter = ext === ".tsv" || expectedFormat === "TSV" ? "\t" : ",";
    const records: Record<string, unknown>[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      delimiter,
      trim: true,
      relax_column_count: true,
    });
    return records;
  }

  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return [];

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber - 1] = String(cell.value ?? `col_${colNumber}`);
    });

    const rows: Record<string, unknown>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const obj: Record<string, unknown> = {};
      let hasValue = false;
      headers.forEach((header, idx) => {
        const cell = row.getCell(idx + 1);
        const val = cell.value;
        obj[header] = val instanceof Date ? val.toISOString() : val;
        if (val !== null && val !== undefined && val !== "") hasValue = true;
      });
      if (hasValue) rows.push(obj);
    }
    return rows;
  }

  throw new Error(`Unsupported file extension: ${ext}`);
}

/**
 * Load rows into BigQuery.
 */
async function loadToBigQuery(
  rows: Record<string, unknown>[],
  dataset: string,
  table: string,
  loadMode: string
): Promise<void> {
  const bq = new BigQuery();

  const datasetRef = bq.dataset(dataset);
  const tableRef = datasetRef.table(table);

  // Check if dataset exists, create if not
  const [datasetExists] = await datasetRef.exists();
  if (!datasetExists) {
    await datasetRef.create();
  }

  if (loadMode === "REPLACE") {
    // Drop existing table before loading
    const [tableExists] = await tableRef.exists();
    if (tableExists) {
      await tableRef.delete();
    }
  }

  // Auto-detect schema from data and insert
  const [tableExists] = await tableRef.exists();
  if (!tableExists) {
    // Infer schema from first row
    const schema = Object.entries(rows[0]).map(([name, value]) => ({
      name,
      type: inferBqType(value),
    }));
    await datasetRef.createTable(table, { schema });
  }

  // Insert rows in batches of 1000
  const BATCH_SIZE = 1000;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await tableRef.insert(batch, {
      skipInvalidRows: true,
      ignoreUnknownValues: true,
    });
  }
}

function inferBqType(value: unknown): string {
  if (value === null || value === undefined) return "STRING";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "FLOAT";
  }
  if (typeof value === "boolean") return "BOOLEAN";
  if (value instanceof Date) return "TIMESTAMP";
  // Check if string looks like a date
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.includes("T") ? "TIMESTAMP" : "DATE";
  }
  return "STRING";
}

function moveToArchive(filePath: string, archiveDir: string, filename: string): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const archiveName = `${base}_${timestamp}${ext}`;
  const dest = path.join(archiveDir, archiveName);

  fs.mkdirSync(archiveDir, { recursive: true });
  fs.renameSync(filePath, dest);
}
