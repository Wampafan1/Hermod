import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRavenAuth } from "@/lib/raven/auth";
import { withAuth } from "@/lib/api";

// TODO: rate-limit the GET endpoint — Ravens poll every 30s for pending jobs
const DEFAULT_JOB_PAGE_SIZE = 25;
const MAX_JOB_PAGE_SIZE = 100;

const ListJobsQuerySchema = z.object({
  ravenId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(MAX_JOB_PAGE_SIZE).default(DEFAULT_JOB_PAGE_SIZE),
  cursor: z.string().min(1).optional(),
});

// ─── GET /api/raven/jobs — List pending jobs for a Raven (Raven auth) ───

export const GET = withRavenAuth(async (req, ctx) => {
  const url = new URL(req.url);
  const parsed = ListJobsQuerySchema.safeParse({
    ravenId: url.searchParams.get("ravenId"),
    limit: url.searchParams.get("limit") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { ravenId, limit, cursor } = parsed.data;

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
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : undefined,
    take: limit + 1,
    select: {
      id: true,
      ravenId: true,
      routeId: true,
      routeLogId: true,
      connectionId: true,
      timeout: true,
      maxRows: true,
      priority: true,
      status: true,
      claimedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const hasNextPage = jobs.length > limit;
  const page = hasNextPage ? jobs.slice(0, limit) : jobs;
  const response = NextResponse.json(page);
  response.headers.set("X-Page-Size", String(page.length));
  if (hasNextPage && page.length > 0) {
    response.headers.set("X-Next-Cursor", page[page.length - 1].id);
  }
  return response;
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
      queryParams: queryParams as Prisma.InputJsonValue | undefined,
      destination: destination as Prisma.InputJsonValue,
      timeout,
      maxRows,
      priority,
      status: "pending",
    },
  });

  return NextResponse.json(job, { status: 201 });
});
