import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

function extractSlugs(url: string): { slug: string; objectSlug: string } {
  const afterCatalog = url.split("/catalog/")[1] ?? "";
  const parts = afterCatalog.split("/");
  return {
    slug: (parts[0] ?? "").split("?")[0],
    objectSlug: (parts[2] ?? "").split("?")[0], // parts: [slug, "objects", objectSlug]
  };
}

// GET /api/alfheim/catalog/[slug]/objects/[objectSlug] — single object with full schema
export const GET = withAuth(async (req) => {
  const { slug, objectSlug } = extractSlugs(req.url);

  const obj = await prisma.apiCatalogObject.findFirst({
    where: {
      slug: objectSlug,
      connector: { slug },
    },
  });

  if (!obj) {
    return NextResponse.json({ error: "Object not found" }, { status: 404 });
  }

  return NextResponse.json(obj);
});
