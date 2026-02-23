import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { testEmailConnection } from "@/lib/email";
import type { EmailConnectionConfig } from "@/lib/email";

// POST /api/email-connections/test — test SMTP connection without saving
export const POST = withAuth(async (req) => {
  const body = await req.json();

  const { host, port, secure, authType, username, password, fromAddress } = body;

  if (!host || !fromAddress) {
    return NextResponse.json(
      { error: "Host and from address are required" },
      { status: 400 }
    );
  }

  const config: EmailConnectionConfig = {
    host,
    port: port ?? 587,
    secure: secure ?? false,
    authType: authType ?? "PLAIN",
    username: username ?? null,
    password: password ?? null,
    fromAddress,
  };

  const result = await testEmailConnection(config);
  return NextResponse.json(result);
});
