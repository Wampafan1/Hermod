import Link from "next/link";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { ConnectionWizard } from "@/components/alfheim/connection-wizard";

export default async function ConnectorWizardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const connector = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
    include: { objects: true },
  });

  if (!connector) notFound();

  // Serialize for client component (strip Prisma internals)
  const serialized = {
    slug: connector.slug,
    name: connector.name,
    baseUrl: connector.baseUrl,
    authType: connector.authType,
    authConfig: connector.authConfig,
    objects: connector.objects.map((o) => ({
      id: o.id,
      slug: o.slug,
      name: o.name,
      description: o.description,
      endpoint: o.endpoint,
      incrementalKey: o.incrementalKey,
      schema: o.schema as {
        columns: { jsonPath: string; columnName: string; dataType: string; nullable: boolean }[];
        childTables?: { jsonPath: string; tableName: string; columns: { columnName: string; dataType: string }[] }[];
      },
    })),
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link href="/connections/api" className="btn-ghost text-xs inline-flex items-center gap-1">
        <span>&larr; Back to Connectors</span>
      </Link>
      <ConnectionWizard connector={serialized} />
    </div>
  );
}
