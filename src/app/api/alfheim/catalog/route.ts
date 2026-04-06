import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  catalogSearchSchema,
  createCatalogConnectorSchema,
} from "@/lib/validations/alfheim";

// GET /api/alfheim/catalog — list + search catalog connectors
export const GET = withAuth(async (req) => {
  const url = new URL(req.url);
  const parsed = catalogSearchSchema.safeParse({
    search: url.searchParams.get("search") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { search, category, page, limit } = parsed.data;
  const showAll = url.searchParams.get("all") === "true";

  const where: Prisma.ApiCatalogConnectorWhereInput = showAll ? {} : { enabled: true };

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { category: { contains: search, mode: "insensitive" } },
    ];
  }

  if (category) {
    where.category = category;
  }

  const [connectors, total, categoryGroups] = await Promise.all([
    prisma.apiCatalogConnector.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ popularity: "desc" }, { name: "asc" }],
      include: { _count: { select: { objects: true } } },
    }),
    prisma.apiCatalogConnector.count({ where }),
    prisma.apiCatalogConnector.groupBy({
      by: ["category"],
      where: { enabled: true },
      _count: { id: true },
      orderBy: { category: "asc" },
    }),
  ]);

  return NextResponse.json({
    connectors,
    total,
    categories: categoryGroups.map((c) => ({
      name: c.category,
      count: c._count.id,
    })),
  });
});

// POST /api/alfheim/catalog — create a new catalog connector
export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = createCatalogConnectorSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const connector = await prisma.apiCatalogConnector.create({
    data: {
      ...parsed.data,
      authConfig: parsed.data.authConfig as Prisma.InputJsonValue,
      pagination: parsed.data.pagination as Prisma.InputJsonValue,
      rateLimiting: parsed.data.rateLimiting as Prisma.InputJsonValue | undefined,
      createdBy: session.user.id,
    },
  });

  return NextResponse.json(connector, { status: 201 });
});
