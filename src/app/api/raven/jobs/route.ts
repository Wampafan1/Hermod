import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";
import { withAuth } from "@/lib/api";

// TODO: rate-limit the GET endpoint — Ravens poll every 30s for pending jobs

// ─── GET /api/raven/jobs — List pending jobs for a Raven (Raven auth) ───

export const GET = withRavenAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const ravenId = url.searchParams.get("ravenId");

  if (!ravenId) {
    return NextResponse.json(
      { error: "Missing ravenId query parameter" },
      { status: 400 }
    );
  }

  // Verify Raven belongs to this tenant
  const raven = await prisma.ravenSatellite.findFirst({
    where: { id: ravenId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!raven) {
    return NextResponse.json({ error: "Raven not found" }, { status: 404 });
  }

  const jobs = await prisma.ravenJob.findMany({
    where: { ravenId, status: "pending" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(jobs);
});

// ─── POST /api/raven/jobs — Create job from dashboard (NextAuth session) ───

const CreateJobSchema = z.object({
  ravenId: z.string().uuid(),
  connectionId: z.string().uuid(),
  query: z.string().min(1),
  queryParams: z.record(z.unknown()).optional(),
  destination: z.object({
    type: z.enum(["hermod_cloud", "direct_push"]),
    endpoint: z.string().optional(),
    table: z.string().optional(),
    mode: z.enum(["append", "replace"]).default("append"),
  }),
  timeout: z.number().int().min(1).max(3600).default(120),
  maxRows: z.number().int().min(1).optional(),
  priority: z.number().int().min(1).max(5).default(3),
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = CreateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId, connectionId, query, queryParams, destination, timeout, maxRows, priority } =
    parsed.data;

  // Verify Raven belongs to user's active tenant
  const raven = await prisma.ravenSatellite.findFirst({
    where: { id: ravenId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!raven) {
    return NextResponse.json({ error: "Raven not found" }, { status: 404 });
  }

  const job = await prisma.ravenJob.create({
    data: {
      ravenId,
      connectionId,
      query,
      queryParams: queryParams ?? undefined,
      destination: destination as Record<string, unknown>,
      timeout,
      maxRows,
      priority,
      status: "pending",
    },
  });

  return NextResponse.json(job, { status: 201 });
});
