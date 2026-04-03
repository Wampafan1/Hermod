import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { HelheimDashboard } from "@/components/helheim/helheim-dashboard";
import { RealmBanner } from "@/components/realm-banner";

export default async function HelheimPage() {
  const session = await requireAuth();
  const userId = session.user.id;

  const [entries, statusCounts] = await Promise.all([
    prisma.helheimEntry.findMany({
      where: { route: { userId } },
      select: {
        id: true,
        routeId: true,
        jobId: true,
        chunkIndex: true,
        rowCount: true,
        errorType: true,
        errorMessage: true,
        retryCount: true,
        maxRetries: true,
        status: true,
        createdAt: true,
        lastRetriedAt: true,
        nextRetryAt: true,
        route: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),

    prisma.helheimEntry.groupBy({
      by: ["status"],
      where: { route: { userId } },
      _count: true,
    }),
  ]);

  const byStatus = Object.fromEntries(
    statusCounts.map((g) => [g.status, g._count])
  );

  const initialData = {
    entries: entries.map((e) => ({
      id: e.id,
      routeId: e.routeId,
      routeName: e.route.name,
      jobId: e.jobId,
      chunkIndex: e.chunkIndex,
      rowCount: e.rowCount,
      errorType: e.errorType,
      errorMessage: e.errorMessage,
      retryCount: e.retryCount,
      maxRetries: e.maxRetries,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
      lastRetriedAt: e.lastRetriedAt?.toISOString() ?? null,
      nextRetryAt: e.nextRetryAt?.toISOString() ?? null,
    })),
    stats: {
      pending: (byStatus["pending"] ?? 0) + (byStatus["retrying"] ?? 0),
      dead: byStatus["dead"] ?? 0,
      recovered: byStatus["recovered"] ?? 0,
    },
  };

  return (
    <div className="space-y-6">
      <RealmBanner
        realm="helheim"
        rune="ᛞ"
        title="Helheim"
        subtitle="Domain of failed deliveries"
        accentColor="#78909c"
        objectPosition="center 53%"
      />

      <HelheimDashboard initialData={initialData} />
    </div>
  );
}
