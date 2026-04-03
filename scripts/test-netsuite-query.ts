/**
 * Standalone NetSuite SuiteQL query tester.
 * Usage: npx tsx scripts/test-netsuite-query.ts
 *
 * Loads the connection for route cmmdmc98j000j49v7nmbp1uk2,
 * runs progressively larger queries to identify bad fields.
 */

import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers/helpers";
import { NetSuiteProvider } from "@/lib/providers/netsuite.provider";

const ROUTE_ID = "cmmdmc98j000j49v7nmbp1uk2";

async function main() {
  // 1. Load route + source connection
  const route = await prisma.bifrostRoute.findUniqueOrThrow({
    where: { id: ROUTE_ID },
    include: { source: true },
  });

  const connLike = toConnectionLike(route.source);
  const provider = new NetSuiteProvider();
  const conn = await provider.connect(connLike);

  console.log("Connected to NetSuite OK\n");

  // All 82 fields from the route's sourceConfig
  const allFields = (route.sourceConfig as { fields: string[] }).fields;

  // Phase 1: 5-field query with WHERE clause
  const baseFields = ["id", "itemid", "itemtype", "lastmodifieddate", "isinactive"];
  const whereClause = "WHERE lastmodifieddate >= '3/7/2026'";
  const orderBy = "ORDER BY lastmodifieddate ASC";

  console.log("=== Phase 1: 5 fields + WHERE clause ===");
  const ok = await testQuery(provider, conn, baseFields, whereClause, orderBy);

  if (!ok) {
    // Phase 1b: same 5 fields WITHOUT WHERE
    console.log("\n=== Phase 1b: 5 fields, NO WHERE clause ===");
    const okNoWhere = await testQuery(provider, conn, baseFields, null, "ORDER BY id ASC");
    if (!okNoWhere) {
      console.log("\nFAILED even without WHERE — problem is not the date filter.");
    } else {
      console.log("\nSUCCESS without WHERE — the date filter syntax is the issue.");
    }
    await prisma.$disconnect();
    return;
  }

  // Phase 2: progressively add fields in batches of 10
  console.log("\n=== Phase 2: Adding fields in batches of 10 ===");
  const remainingFields = allFields.filter((f) => !baseFields.includes(f));

  for (let i = 0; i < remainingFields.length; i += 10) {
    const batch = remainingFields.slice(0, i + 10);
    const fields = [...baseFields, ...batch];
    console.log(`\n--- Testing ${fields.length} fields (added ${batch.slice(-10).join(", ")}) ---`);

    const batchOk = await testQuery(provider, conn, fields, whereClause, orderBy);
    if (!batchOk) {
      // Narrow down within this batch of 10
      console.log("\nFailed! Narrowing down within last batch...");
      const prevBatch = remainingFields.slice(0, i);
      const failBatch = remainingFields.slice(i, i + 10);

      for (const field of failBatch) {
        const testFields = [...baseFields, ...prevBatch, field];
        const fieldOk = await testQuery(provider, conn, testFields, whereClause, orderBy);
        if (!fieldOk) {
          console.log(`\n>>> BAD FIELD IDENTIFIED: "${field}" <<<`);
          await prisma.$disconnect();
          return;
        }
      }

      // If we get here, it's a combination issue
      console.log("\nCombination of fields in this batch causes failure (not a single field).");
      await prisma.$disconnect();
      return;
    }
  }

  console.log("\n=== All fields passed! ===");
  await prisma.$disconnect();
}

async function testQuery(
  provider: NetSuiteProvider,
  conn: Awaited<ReturnType<NetSuiteProvider["connect"]>>,
  fields: string[],
  where: string | null,
  orderBy: string
): Promise<boolean> {
  const query = `SELECT ${fields.join(", ")} FROM item ${where ?? ""} ${orderBy}`.trim();
  console.log(`Query: ${query.slice(0, 120)}${query.length > 120 ? "..." : ""}`);

  try {
    const result = await provider.query(conn, query);
    console.log(`OK — ${result.rows.length} rows returned`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`FAILED — ${msg}`);
    return false;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
