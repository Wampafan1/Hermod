import { prisma } from "@/lib/db";

export interface DashboardStats {
  activeRoutes: number;
  runsToday: number;
  successRate: number | null;
  rowsSynced: number;
  helheimPending: number;
}

export interface DashboardRoute {
  id: string;
  name: string;
  enabled: boolean;
  sourceType: string;
  sourceName: string;
  destType: string;
  destName: string;
  nextRunAt: string | null;
  helheimPending: number;
  lastRun: {
    status: string;
    startedAt: string;
    duration: number | null;
    rowsLoaded: number | null;
    errorCount: number;
  } | null;
}

export interface DashboardUpcoming {
  id: string;
  name: string;
  nextRunAt: string;
}

export interface DashboardRecentRun {
  id: string;
  routeId: string;
  routeName: string;
  status: string;
  rowsExtracted: number | null;
  rowsLoaded: number | null;
  errorCount: number;
  bytesTransferred: string | null;
  duration: number | null;
  error: string | null;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
}

export interface DashboardHelheim {
  pending: number;
  retrying: number;
  dead: number;
  recovered: number;
  recoveryRate: number | null;
}

export interface DashboardData {
  stats: DashboardStats;
  routes: DashboardRoute[];
  upcomingRuns: DashboardUpcoming[];
  recentRuns: DashboardRecentRun[];
  helheim: DashboardHelheim;
  totalRunCount: number;
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [
    activeRouteCount,
    runsToday,
    runs7d,
    rowsSynced7d,
    helheimPending,
    helheimStats,
    routes,
    helheimByRoute,
    upcomingRuns,
    recentRuns,
    totalRunCount,
  ] = await Promise.all([
    // [A] Active routes count
    prisma.bifrostRoute.count({ where: { userId, enabled: true } }),

    // [A] Runs today
    prisma.routeLog.count({
      where: { route: { userId }, startedAt: { gte: startOfToday } },
    }),

    // [A] Runs in last 7 days grouped by status
    prisma.routeLog.groupBy({
      by: ["status"],
      where: { route: { userId }, startedAt: { gte: sevenDaysAgo } },
      _count: true,
    }),

    // [A] Rows synced in last 7 days
    prisma.routeLog.aggregate({
      where: { route: { userId }, startedAt: { gte: sevenDaysAgo } },
      _sum: { rowsLoaded: true },
    }),

    // [A] Helheim pending count
    prisma.helheimEntry.count({
      where: { route: { userId }, status: { in: ["pending", "retrying"] } },
    }),

    // [E] Helheim status breakdown
    prisma.helheimEntry.groupBy({
      by: ["status"],
      where: { route: { userId } },
      _count: true,
    }),

    // [B] All routes with last run
    prisma.bifrostRoute.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      include: {
        source: { select: { name: true, type: true } },
        dest: { select: { name: true, type: true } },
        routeLogs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            status: true,
            startedAt: true,
            duration: true,
            rowsLoaded: true,
            errorCount: true,
          },
        },
      },
    }),

    // [B] Helheim pending counts per route
    prisma.helheimEntry.groupBy({
      by: ["routeId"],
      where: { route: { userId }, status: { in: ["pending", "retrying"] } },
      _count: true,
    }),

    // [C] Upcoming scheduled runs in next 24h
    prisma.bifrostRoute.findMany({
      where: {
        userId,
        enabled: true,
        nextRunAt: { gte: now, lte: twentyFourHoursFromNow },
      },
      orderBy: { nextRunAt: "asc" },
      take: 10,
      select: { id: true, name: true, nextRunAt: true },
    }),

    // [D] Recent 50 runs for timeline
    prisma.routeLog.findMany({
      where: { route: { userId } },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { route: { select: { name: true } } },
    }),

    // [D] Total run count for pagination
    prisma.routeLog.count({
      where: { route: { userId } },
    }),
  ]);

  // Build helheim-per-route lookup
  const helheimCountMap = new Map(
    helheimByRoute.map((g) => [g.routeId, g._count])
  );

  // Process success rate
  const total7dRuns = runs7d.reduce((sum, g) => sum + g._count, 0);
  const completed7dRuns = runs7d.find((g) => g.status === "completed")?._count ?? 0;
  const successRate = total7dRuns > 0 ? (completed7dRuns / total7dRuns) * 100 : null;

  // Process helheim stats
  const helheimByStatus = Object.fromEntries(
    helheimStats.map((g) => [g.status, g._count])
  );
  const recovered = helheimByStatus["recovered"] ?? 0;
  const dead = helheimByStatus["dead"] ?? 0;
  const recoveryRate =
    recovered + dead > 0 ? (recovered / (recovered + dead)) * 100 : null;

  return {
    stats: {
      activeRoutes: activeRouteCount,
      runsToday,
      successRate,
      rowsSynced: rowsSynced7d._sum.rowsLoaded ?? 0,
      helheimPending,
    },
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      sourceType: r.source.type,
      sourceName: r.source.name,
      destType: r.dest.type,
      destName: r.dest.name,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
      helheimPending: helheimCountMap.get(r.id) ?? 0,
      lastRun: r.routeLogs[0]
        ? {
            status: r.routeLogs[0].status,
            startedAt: r.routeLogs[0].startedAt.toISOString(),
            duration: r.routeLogs[0].duration,
            rowsLoaded: r.routeLogs[0].rowsLoaded,
            errorCount: r.routeLogs[0].errorCount,
          }
        : null,
    })),
    upcomingRuns: upcomingRuns.map((r) => ({
      id: r.id,
      name: r.name,
      nextRunAt: r.nextRunAt!.toISOString(),
    })),
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      routeId: r.routeId,
      routeName: r.route.name,
      status: r.status,
      rowsExtracted: r.rowsExtracted,
      rowsLoaded: r.rowsLoaded,
      errorCount: r.errorCount,
      bytesTransferred: r.bytesTransferred?.toString() ?? null,
      duration: r.duration,
      error: r.error,
      triggeredBy: r.triggeredBy,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    helheim: {
      pending: helheimByStatus["pending"] ?? 0,
      retrying: helheimByStatus["retrying"] ?? 0,
      dead,
      recovered,
      recoveryRate,
    },
    totalRunCount,
  };
}
