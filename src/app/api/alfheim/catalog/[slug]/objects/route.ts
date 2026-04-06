import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

function extractSlug(url: string): string {
  return url.split("/catalog/")[1]?.split("/")[0]?.split("?")[0] ?? "";
}

// GET /api/alfheim/catalog/[slug]/objects — list objects for a connector
export const GET = withAuth(async (req) => {
  const slug = extractSlug(req.url);

  const connector = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!connector) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }

  const objects = await prisma.apiCatalogObject.findMany({
    where: { connectorId: connector.id },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ objects });
});
