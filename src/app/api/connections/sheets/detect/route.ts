import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  extractSpreadsheetId,
  fetchSheetMetadata,
  fetchSampleRows,
} from "@/lib/providers/google-sheets.provider";
import type { ColumnMapping } from "@/lib/alfheim/types";

type DataType = ColumnMapping["dataType"];

function inferColumnType(values: unknown[]): { type: DataType; nullable: boolean } {
  const nonNull = values.filter(
    (v) => v !== null && v !== undefined && v !== ""
  );
  const nullable = nonNull.length < values.length;
  if (nonNull.length === 0) return { type: "STRING", nullable: true };

  let allNumbers = true;
  let hasDecimal = false;
  let allBooleans = true;

  for (const v of nonNull) {
    if (typeof v === "boolean") {
      allNumbers = false;
      continue;
    }
    allBooleans = false;

    if (typeof v === "number") {
      if (!Number.isInteger(v)) hasDecimal = true;
      continue;
    }
    allNumbers = false;
  }

  if (allBooleans) return { type: "BOOLEAN", nullable };
  if (allNumbers) return { type: hasDecimal ? "FLOAT" : "INTEGER", nullable };
  return { type: "STRING", nullable };
}

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const { spreadsheetUrl, sheetName } = body;

  if (!spreadsheetUrl) {
    return NextResponse.json(
      { error: "spreadsheetUrl is required" },
      { status: 400 }
    );
  }

  const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "Invalid Google Sheets URL" },
      { status: 400 }
    );
  }

  // Get the user's Google OAuth token from the Account model
  const account = await prisma.account.findFirst({
    where: { userId: session.user.id, provider: "google" },
    select: { id: true, access_token: true, refresh_token: true, expires_at: true },
  });

  if (!account?.access_token) {
    return NextResponse.json(
      { error: "No Google account connected. Please sign in with Google." },
      { status: 401 }
    );
  }

  // Refresh token if expired (expires_at is in seconds since epoch)
  let accessToken = account.access_token;
  const now = Math.floor(Date.now() / 1000);
  if (account.expires_at && account.expires_at < now + 60) {
    if (!account.refresh_token) {
      return NextResponse.json(
        { error: "Google token expired and no refresh token available. Please sign out and sign in again." },
        { status: 401 }
      );
    }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.json(
        { error: "Failed to refresh Google token. Please sign out and sign in again." },
        { status: 401 }
      );
    }

    const tokenData = await tokenRes.json();
    accessToken = tokenData.access_token;

    // Persist the refreshed token
    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: accessToken,
        expires_at: Math.floor(Date.now() / 1000) + tokenData.expires_in,
      },
    });
  }

  // Fetch sheet metadata
  const metadata = await fetchSheetMetadata(spreadsheetId, accessToken);
  const targetSheet = sheetName ?? metadata.sheets[0] ?? "Sheet1";

  // Fetch sample rows for schema detection
  const sampleValues = await fetchSampleRows(spreadsheetId, targetSheet, accessToken);

  if (sampleValues.length === 0) {
    return NextResponse.json({
      spreadsheetId,
      spreadsheetName: metadata.title,
      availableSheets: metadata.sheets,
      sheetName: targetSheet,
      rowCount: 0,
      sampleRows: [],
      schema: { columns: [] },
    });
  }

  // First row = headers
  const headers = (sampleValues[0] ?? []).map((v, i) =>
    v ? String(v).trim() : `column_${i + 1}`
  );

  const dataRows = sampleValues.slice(1, 101);

  const columns: ColumnMapping[] = headers.map((name, colIdx) => {
    const colValues = dataRows.map((row) => (row as unknown[])[colIdx]);
    const { type, nullable } = inferColumnType(colValues);
    return {
      jsonPath: name,
      columnName: name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      dataType: type,
      nullable,
    };
  });

  const sampleRows = dataRows.slice(0, 5).map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = (row as unknown[])[i] ?? null;
    });
    return obj;
  });

  return NextResponse.json({
    spreadsheetId,
    spreadsheetName: metadata.title,
    availableSheets: metadata.sheets,
    sheetName: targetSheet,
    rowCount: sampleValues.length - 1,
    sampleRows,
    schema: { columns },
  });
});
