/**
 * Google Sheets Provider — Alfheim realm
 *
 * Reads Google Sheets as a data source via Sheets API v4 (raw fetch).
 */

import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection } from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

interface SheetsConfig {
  spreadsheetId: string;
  spreadsheetUrl: string;
  spreadsheetName: string;
  sheetName: string;
  availableSheets: string[];
  headerRow: number;
  dataStartRow: number;
  range?: string;
  pkColumns?: string[];
}

interface SheetsCredentials {
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
}

class SheetsConnection implements ProviderConnection {
  constructor(
    public config: SheetsConfig,
    public credentials: SheetsCredentials
  ) {}
  async close() {
    // No persistent connection
  }
}

async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

async function getValidToken(creds: SheetsCredentials): Promise<string> {
  if (new Date(creds.tokenExpiry) > new Date(Date.now() + 60_000)) {
    return creds.accessToken;
  }
  const refreshed = await refreshAccessToken(creds.refreshToken);
  return refreshed.accessToken;
}

export function extractSpreadsheetId(url: string): string | null {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export class GoogleSheetsProvider implements ConnectionProvider {
  readonly type = "GOOGLE_SHEETS";

  async connect(connection: ConnectionLike): Promise<SheetsConnection> {
    const config = connection.config as unknown as SheetsConfig;
    const creds = connection.credentials as unknown as SheetsCredentials;
    return new SheetsConnection(config, creds);
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    const config = connection.config as unknown as SheetsConfig;
    const creds = connection.credentials as unknown as SheetsCredentials;

    try {
      const token = await getValidToken(creds);
      const res = await fetch(`${SHEETS_API}/${config.spreadsheetId}?fields=sheets.properties.title`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const sheetsConn = conn as SheetsConnection;
    const { spreadsheetId, sheetName, range, pkColumns } = sheetsConn.config;
    const chunkSize = config.chunkSize ?? 10_000;
    const injectPk = pkColumns && pkColumns.length > 1;

    const token = await getValidToken(sheetsConn.credentials);
    const queryRange = range || `${sheetName}`;

    const res = await fetch(
      `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(queryRange)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Sheets API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const values: unknown[][] = data.values ?? [];

    if (values.length === 0) return;

    // First row = headers
    const headerRowIdx = (sheetsConn.config.headerRow ?? 1) - 1;
    const dataStartIdx = (sheetsConn.config.dataStartRow ?? 2) - 1;

    const headers = (values[headerRowIdx] ?? []).map((v, i) =>
      v ? String(v).trim() : `column_${i + 1}`
    );

    let chunk: Record<string, unknown>[] = [];

    for (let i = dataStartIdx; i < values.length; i++) {
      const row = values[i];
      if (!row || row.every((v) => v === null || v === undefined || v === "")) continue;

      const record: Record<string, unknown> = {};
      headers.forEach((h, idx) => {
        record[h] = row[idx] ?? null;
      });

      if (injectPk) {
        record.__hermod_pk = pkColumns!.map((c) => String(record[c] ?? "")).join("_");
      }
      chunk.push(record);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }

    if (chunk.length > 0) {
      yield chunk;
    }
  }
}

/** Fetch sheet names and metadata from a spreadsheet. */
export async function fetchSheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<{ title: string; sheets: string[] }> {
  const res = await fetch(
    `${SHEETS_API}/${spreadsheetId}?fields=properties.title,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch sheet metadata: ${res.status}`);
  }

  const data = await res.json();
  return {
    title: data.properties?.title ?? "Untitled",
    sheets: (data.sheets ?? []).map(
      (s: { properties?: { title?: string } }) => s.properties?.title ?? "Sheet1"
    ),
  };
}

/** Fetch first N rows for schema detection. */
export async function fetchSampleRows(
  spreadsheetId: string,
  sheetName: string,
  accessToken: string,
  maxRows = 101
): Promise<unknown[][]> {
  const range = `${sheetName}!1:${maxRows}`;
  const res = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch sample rows: ${res.status}`);
  }

  const data = await res.json();
  return data.values ?? [];
}
