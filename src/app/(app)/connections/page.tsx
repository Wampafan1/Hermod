import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ConnectionList } from "@/components/connections/connection-list";
import { RealmBanner } from "@/components/realm-banner";

export default async function ConnectionsPage() {
  const session = await requireAuth();

  const [connections, emailConnections, folders, ravenCount] = await Promise.all([
    prisma.connection.findMany({
      where: {
        OR: [
          { tenantId: session.user.tenantId ?? undefined },
          { userId: session.user.id },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        config: true,
        status: true,
        lastTestedAt: true,
        folderId: true,
      },
    }),
    prisma.emailConnection.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        secure: true,
        authType: true,
        username: true,
        fromAddress: true,
      },
    }),
    prisma.connectionFolder.findMany({
      where: { tenantId: session.user.tenantId ?? undefined },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { connections: true } } },
    }),
    prisma.ravenSatellite.count({
      where: { tenantId: session.user.tenantId ?? undefined },
    }),
  ]);

  const serializedConnections = connections.map((c) => ({
    ...c,
    config: (c.config ?? {}) as Record<string, unknown>,
    status: c.status as string,
    lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
    folderId: c.folderId ?? null,
  }));

  const serializedFolders = folders.map((f) => ({
    id: f.id,
    name: f.name,
    color: f.color,
    icon: f.icon,
    sortOrder: f.sortOrder,
    connectionCount: f._count.connections,
  }));

  return (
    <div className="space-y-6">
      <RealmBanner
        realm="midgard"
        rune="ᚨ"
        title="Connections"
        subtitle="Bridges to the outer realms"
        accentColor="#ce93d8"
        objectPosition="center 35%"
        action={
          <div className="flex gap-2">
            <Link href="/connections/new" className="btn-primary">
              <span>Add Connection</span>
            </Link>
          </div>
        }
      />

      <ConnectionList
        connections={serializedConnections}
        emailConnections={emailConnections}
        folders={serializedFolders}
        ravenCount={ravenCount}
      />
    </div>
  );
}
