/**
 * Test NetSuite field discovery — verifies custitem_* fields appear.
 * Usage: npx tsx scripts/test-netsuite-fields.ts
 */

import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers/helpers";
import { NetSuiteProvider } from "@/lib/providers/netsuite.provider";

const CONNECTION_ID = "cmmcgfu7800013pqvfhcr0w4b";

async function main() {
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: CONNECTION_ID },
  });

  const connLike = toConnectionLike(connection);
  const provider = new NetSuiteProvider();
  const conn = await provider.connect(connLike);

  console.log("Connected to NetSuite OK\n");

  const fields = await provider.getRecordFields(conn, "item");

  const standard = fields.filter((f) => !f.isCustom);
  const custom = fields.filter((f) => f.isCustom);

  console.log(`Total fields: ${fields.length}`);
  console.log(`Standard: ${standard.length}`);
  console.log(`Custom: ${custom.length}\n`);

  console.log("=== Standard Fields (first 10) ===");
  for (const f of standard.slice(0, 10)) {
    console.log(`  ${f.name.padEnd(35)} ${f.type.padEnd(12)} ${f.label}`);
  }

  console.log(`\n=== Custom Fields (all) ===`);
  for (const f of custom) {
    console.log(`  ${f.name.padEnd(45)} ${f.type.padEnd(12)} ${f.label}`);
  }

  await conn.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
