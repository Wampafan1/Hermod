import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ConnectionList } from "@/components/connections/connection-list";

export default async function ConnectionsPage() {
  const session = await requireAuth();

  const [connections, emailConnections] = await Promise.all([
    prisma.connection.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        config: true,
        status: true,
        lastTestedAt: true,
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
  ]);

  // Serialize dates and cast config for client component
  const serializedConnections = connections.map((c) => ({
    ...c,
    config: (c.config ?? {}) as Record<string, unknown>,
    status: c.status as string,
    lastTestedAt: c.lastTestedAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Connections</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Manage your database and file connections.
          </p>
        </div>
        <Link href="/connections/new" className="btn-primary">
          <span>Add Connection</span>
        </Link>
      </div>

      <ConnectionList
        connections={serializedConnections}
        emailConnections={emailConnections}
      />
    </div>
  );
}
