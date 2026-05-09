import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { MjolnirForge } from "@/components/mjolnir/mjolnir-forge";
import { RealmBanner } from "@/components/realm-banner";

export default async function MjolnirPage() {
  const session = await requireAuth();

  const blueprints = await prisma.blueprint.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      version: true,
      beforeSample: true,
      afterSample: true,
      scope: true,
      tenantId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const blueprintIds = blueprints.map((blueprint) => blueprint.id);
  const [reportCounts, routeCounts] = blueprintIds.length > 0
    ? await Promise.all([
        prisma.report.groupBy({
          by: ["blueprintId"],
          where: {
            userId: session.user.id,
            blueprintId: { in: blueprintIds },
          },
          _count: { _all: true },
        }),
        prisma.bifrostRoute.groupBy({
          by: ["blueprintId"],
          where: {
            userId: session.user.id,
            blueprintId: { in: blueprintIds },
          },
          _count: { _all: true },
        }),
      ])
    : [[], []];

  const reportCountByBlueprint = new Map(
    reportCounts
      .filter((count) => count.blueprintId)
      .map((count) => [count.blueprintId as string, count._count._all])
  );
  const routeCountByBlueprint = new Map(
    routeCounts
      .filter((count) => count.blueprintId)
      .map((count) => [count.blueprintId as string, count._count._all])
  );

  const serialized = blueprints.map((b: { id: string; name: string; description: string | null; status: string; version: number; beforeSample: string | null; afterSample: string | null; scope: string; tenantId: string | null; createdAt: Date; updatedAt: Date }) => ({
    usage: {
      reports: reportCountByBlueprint.get(b.id) ?? 0,
      bifrostRoutes: routeCountByBlueprint.get(b.id) ?? 0,
      total: (reportCountByBlueprint.get(b.id) ?? 0) + (routeCountByBlueprint.get(b.id) ?? 0),
    },
    ...b,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <RealmBanner
        realm="nidavellir"
        rune="ᛗ"
        title="Mjolnir"
        subtitle="Forge transformation blueprints from example files"
        accentColor="#ffb74d"
      />
      <MjolnirForge blueprints={serialized} />
    </div>
  );
}
