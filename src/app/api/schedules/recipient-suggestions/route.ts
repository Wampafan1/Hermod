import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";

const MAX_RECIPIENT_SUGGESTIONS = 100;

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_RECIPIENT_SUGGESTIONS).default(50),
});

// GET /api/schedules/recipient-suggestions — lightweight recipient autocomplete data
export const GET = withAuth(async (req, session) => {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const recipients = await prisma.recipient.findMany({
    where: { schedule: { report: { userId: session.user.id } } },
    select: { email: true },
    distinct: ["email"],
    orderBy: { email: "asc" },
    take: parsed.data.limit,
  });

  return NextResponse.json(recipients.map((recipient) => recipient.email));
});

