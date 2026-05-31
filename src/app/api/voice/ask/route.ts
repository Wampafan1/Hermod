import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api";
import { askHermod, AntonNotConfiguredError } from "@/lib/anton/voice-client";

// Reference surface (proof of life) for Hermod's VOICE (Anton-backed). This is
// NOT the full feature — user-facing surfaces are designed with Joe separately.

const askVoiceSchema = z.object({
  question: z.string().min(1).max(4000),
  sessionId: z.string().max(128).optional(),
});

// TIER: decided — the voice is available to ALL signed-in users, including free
// (Heimdall). It runs on the local GPU (near-zero marginal cost) and is a
// conversion driver for the free-tier email-branding funnel, so the voice itself
// stays ungated (plain withAuth, no minimumRole). A FUTURE data-reading voice
// (answering from the user's own Hermod records) would be a separate, Odin-gated
// capability with its own security review — that gate lives there, not here.
export const POST = withAuth(async (req) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = askVoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await askHermod({
      question: parsed.data.question,
      sessionId: parsed.data.sessionId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AntonNotConfiguredError) {
      // Voice tenant not provisioned — the UI should show static help instead.
      return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
    }
    // Any other failure (transport, timeout, Anton 5xx) becomes a safe 500 via withAuth.
    throw error;
  }
});
