import { PrismaClient } from "@prisma/client";
import { seedApiCatalog } from "./seeds/api-catalog";

const prisma = new PrismaClient();

async function main() {
  await seedApiCatalog(prisma);
  console.log("Seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
