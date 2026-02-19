import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { testConnectionSchema } from "@/lib/validations/connections";
import { getConnectorRaw } from "@/lib/connectors";

// POST /api/connections/test — test a connection without saving
export const POST = withAuth(async (req, _session) => {
  const body = await req.json();
  const parsed = testConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const isBigQuery = data.type === "BIGQUERY";

  try {
    const connector = getConnectorRaw({
      type: data.type,
      host: isBigQuery ? null : (data as any).host,
      port: isBigQuery ? null : (data as any).port,
      database: isBigQuery ? null : (data as any).database,
      username: isBigQuery ? null : (data as any).username,
      password: isBigQuery ? null : (data as any).password,
      extras: isBigQuery ? (data as any).extras : null,
    });

    const success = await connector.testConnection();
    return NextResponse.json({ success });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connection failed";
    return NextResponse.json({ success: false, error: message });
  }
});
