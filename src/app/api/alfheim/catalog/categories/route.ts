import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

// GET /api/alfheim/catalog/categories — all categories with counts
export const GET = withAuth(async () => {
  const categories = await prisma.apiCatalogConnector.groupBy({
    by: ["category"],
    where: { enabled: true },
    _count: { id: true },
    orderBy: { category: "asc" },
  });

  return NextResponse.json({
    categories: categories.map((c) => ({
      name: c.category,
      count: c._count.id,
    })),
  });
});
