import Link from "next/link";
import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { GateList } from "@/components/gates/gate-list";

export default async function GatesPage() {
  const session = await requireAuth();

  const gates = await prisma.realmGate.findMany({
    where: {
      tenantId: session.user.tenantId ?? undefined,
      status: { not: "ARCHIVED" },
    },
    include: {
      connection: { select: { name: true, type: true } },
    },
    orderBy: [
      { lastPushAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ],
  });

  const serialized = gates.map((g) => ({
    id: g.id,
    name: g.name,
    realmType: g.realmType,
    status: g.status,
    connectionName: g.connection.name,
    connectionType: g.connection.type,
    targetTable: g.targetTable,
    targetSchema: g.targetSchema,
    mergeStrategy: g.mergeStrategy,
    primaryKeyColumns: Array.isArray(g.primaryKeyColumns) ? g.primaryKeyColumns : [],
    lastPushAt: g.lastPushAt?.toISOString() ?? null,
    pushCount: g.pushCount,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="heading-norse text-lg">Realm Gates</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            On-demand file push portals — drop and deliver
          </p>
        </div>
        <Link href="/gates/new" className="btn-primary">
          New gate
        </Link>
      </div>

      <GateList gates={serialized} />
    </div>
  );
}
