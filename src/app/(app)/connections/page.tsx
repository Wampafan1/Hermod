import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { ConnectionList } from "@/components/connections/connection-list";

export default async function ConnectionsPage() {
  const session = await requireAuth();

  const [connections, sftpConnections, emailConnections] = await Promise.all([
    prisma.dataSource.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        host: true,
        port: true,
        database: true,
        username: true,
      },
    }),
    prisma.sftpConnection.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        sourceType: true,
        status: true,
        lastFileAt: true,
        lastFileName: true,
        filesProcessed: true,
        sftpUsername: true,
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

  // Serialize dates for client component
  const serializedSftp = sftpConnections.map((s) => ({
    ...s,
    lastFileAt: s.lastFileAt?.toISOString() ?? null,
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
        connections={connections}
        sftpConnections={serializedSftp}
        emailConnections={emailConnections}
      />
    </div>
  );
}
