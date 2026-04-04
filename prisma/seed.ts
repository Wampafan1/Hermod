import { PrismaClient } from "@prisma/client";
import { seedApiCatalog } from "./seeds/api-catalog";

const prisma = new PrismaClient();

async function seedConnectionFolders() {
  // Find first user with an active tenant (the dev user)
  const user = await prisma.user.findFirst({
    where: { activeTenantId: { not: null } },
    select: { id: true, activeTenantId: true },
  });

  if (!user?.activeTenantId) {
    console.log("No user with active tenant found — skipping folder seeds");
    return;
  }

  const tenantId = user.activeTenantId;

  const folders = [
    { name: "Whitmor", color: "#66bb6a", sortOrder: 0 },
    { name: "Sparkstone", color: "#ce93d8", sortOrder: 1 },
    { name: "Internal", color: "#d4af37", sortOrder: 2 },
  ];

  for (const folder of folders) {
    await prisma.connectionFolder.upsert({
      where: {
        id: `seed-folder-${folder.name.toLowerCase()}`,
      },
      create: {
        id: `seed-folder-${folder.name.toLowerCase()}`,
        name: folder.name,
        color: folder.color,
        sortOrder: folder.sortOrder,
        tenantId,
      },
      update: {
        name: folder.name,
        color: folder.color,
        sortOrder: folder.sortOrder,
      },
    });
    console.log(`  Folder: ${folder.name} (${folder.color})`);
  }

  console.log("Connection folders seeded");
}

async function main() {
  await seedApiCatalog(prisma);
  await seedConnectionFolders();
  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
