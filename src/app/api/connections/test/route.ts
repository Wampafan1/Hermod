import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { getProvider } from "@/lib/providers";
import { createConnectionSchema } from "@/lib/validations/unified-connections";
import type { ConnectionLike } from "@/lib/providers/types";

// ─── POST /api/connections/test — test before saving ─────────
export const POST = withAuth(async (req, _session) => {
  const body = await req.json();
  const parsed = createConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { type, config, credentials } = parsed.data;

  const provider = getProvider(type);

  // For test: credentials are plaintext (not yet encrypted).
  // Construct a ConnectionLike directly from the validated input.
  const connectionLike: ConnectionLike = {
    type,
    config: config as Record<string, unknown>,
    credentials: credentials as Record<string, unknown>,
  };

  try {
    // Use extended test for NetSuite (richer response with account details)
    if (
      type === "NETSUITE" &&
      "testConnectionExtended" in provider
    ) {
      const result = await (
        provider as typeof provider & {
          testConnectionExtended(c: ConnectionLike): Promise<unknown>;
        }
      ).testConnectionExtended(connectionLike);
      return NextResponse.json(result);
    }

    const success = await provider.testConnection(connectionLike);
    return NextResponse.json({ success });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connection test failed";
    return NextResponse.json({ success: false, error: message });
  }
});
