import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";

const HEARTBEAT_ONLINE_MS = 5 * 60 * 1000; // 5 minutes

interface SatelliteConnection {
  id: string;
  name: string;
  driver: string;
  database?: string;
  status: string;
}

// GET /api/bifrost/raven-connections — List Raven satellite connections for route builder
export const GET = withAuth(async (_req, ctx) => {
  const satellites = await prisma.ravenSatellite.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: ["active", "pending"] },
    },
    select: {
      id: true,
      name: true,
      status: true,
      lastHeartbeatAt: true,
      connections: true,
    },
    orderBy: { name: "asc" },
  });

  const now = Date.now();

  const result = satellites.flatMap((sat) => {
    const connections = (sat.connections as SatelliteConnection[] | null) ?? [];
    if (connections.length === 0) return [];

    const isOnline =
      sat.lastHeartbeatAt != null &&
      now - new Date(sat.lastHeartbeatAt).getTime() < HEARTBEAT_ONLINE_MS;

    return [
      {
        ravenId: sat.id,
        ravenName: sat.name,
        status: isOnline ? "online" : "offline",
        lastHeartbeat: sat.lastHeartbeatAt?.toISOString() ?? null,
        connections: connections.map((conn) => ({
          satelliteId: sat.id,
          connectionId: conn.id,
          name: conn.name,
          driver: conn.driver,
          database: conn.database ?? "",
          status: conn.status,
        })),
      },
    ];
  });

  return NextResponse.json(result);
});
