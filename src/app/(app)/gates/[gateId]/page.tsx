import { requireAuth } from "@/lib/session";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { GateDetail } from "@/components/gates/gate-detail";

interface Props {
  params: { gateId: string };
}

export default async function GateDetailPage({ params }: Props) {
  const session = await requireAuth();
  const { gateId } = await params;

  const gate = await prisma.realmGate.findFirst({
    where: { id: gateId, tenantId: session.user.tenantId ?? undefined },
    include: {
      connection: { select: { id: true, name: true, type: true } },
      forgeBlueprint: { select: { id: true, name: true, status: true } },
      pushes: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!gate) notFound();

  const serialized = {
    ...gate,
    createdAt: gate.createdAt.toISOString(),
    updatedAt: gate.updatedAt.toISOString(),
    lastPushAt: gate.lastPushAt?.toISOString() ?? null,
    pushes: gate.pushes.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      completedAt: p.completedAt?.toISOString() ?? null,
    })),
  };

  return <GateDetail gate={serialized as Parameters<typeof GateDetail>[0]["gate"]} />;
}
