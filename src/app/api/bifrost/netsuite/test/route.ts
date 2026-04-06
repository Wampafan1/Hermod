import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { NetSuiteProvider } from "@/lib/providers/netsuite.provider";
import type { ConnectionLike } from "@/lib/providers/types";

// POST /api/bifrost/netsuite/test — test a NetSuite connection without saving
export const POST = withAuth(async (req) => {
  const body = await req.json();
  const { accountId, consumerKey, consumerSecret, tokenId, tokenSecret } = body;

  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
    return NextResponse.json(
      { error: "All TBA credentials are required" },
      { status: 400 }
    );
  }

  const provider = new NetSuiteProvider();

  // Build a synthetic ConnectionLike (not saved, no encryption)
  const connectionLike: ConnectionLike = {
    type: "NETSUITE",
    config: { accountId },
    credentials: { consumerKey, consumerSecret, tokenId, tokenSecret },
  };

  const result = await provider.testConnectionExtended(connectionLike);

  return NextResponse.json(result, {
    status: result.success ? 200 : 400,
  });
});
