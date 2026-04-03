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
      createdAt: true,
      updatedAt: true,
    },
  });

  const serialized = blueprints.map((b: { id: string; name: string; description: string | null; status: string; version: number; beforeSample: string | null; afterSample: string | null; createdAt: Date; updatedAt: Date }) => ({
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
