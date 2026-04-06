import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { updateCatalogConnectorSchema } from "@/lib/validations/alfheim";

function extractSlug(url: string): string {
  return url.split("/catalog/")[1]?.split("/")[0]?.split("?")[0] ?? "";
}

// GET /api/alfheim/catalog/[slug] — single connector with objects
export const GET = withAuth(async (req) => {
  const slug = extractSlug(req.url);

  const connector = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
    include: { objects: true },
  });

  if (!connector) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }

  return NextResponse.json(connector);
});

// PUT /api/alfheim/catalog/[slug] — update connector
export const PUT = withAuth(async (req) => {
  const slug = extractSlug(req.url);

  const existing = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = updateCatalogConnectorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  const connector = await prisma.apiCatalogConnector.update({
    where: { slug },
    data: {
      ...data,
      ...(data.authConfig !== undefined && {
        authConfig: data.authConfig as Prisma.InputJsonValue,
      }),
      ...(data.pagination !== undefined && {
        pagination: data.pagination as Prisma.InputJsonValue,
      }),
      ...(data.rateLimiting !== undefined && {
        rateLimiting: data.rateLimiting as Prisma.InputJsonValue | undefined,
      }),
    },
  });

  return NextResponse.json(connector);
});

// DELETE /api/alfheim/catalog/[slug] — hard delete (removes connector and its objects)
export const DELETE = withAuth(async (req) => {
  const slug = extractSlug(req.url);

  const existing = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
  });
  if (!existing) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }

  await prisma.apiCatalogConnector.delete({ where: { slug } });

  return NextResponse.json({ success: true });
});
