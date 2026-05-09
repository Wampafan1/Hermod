import { prisma } from "@/lib/db";

export async function loadBlueprintVersionForTenant(input: {
  blueprintVersionId: string;
  tenantId: string;
}) {
  return prisma.blueprintVersion.findFirst({
    where: {
      id: input.blueprintVersionId,
      tenantId: input.tenantId,
    },
    select: {
      id: true,
      blueprintId: true,
      tenantId: true,
      version: true,
      steps: true,
      stepsHash: true,
      sourceSchema: true,
      afterFormatting: true,
      isLocked: true,
    },
  });
}
