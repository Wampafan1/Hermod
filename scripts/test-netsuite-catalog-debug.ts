/**
 * Debug: inspect raw metadata-catalog responses from NetSuite.
 * Usage: npx tsx scripts/test-netsuite-catalog-debug.ts
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

  const names = ["item", "inventoryItem", "customer", "transaction"];

  for (const name of names) {
    const url = `${conn.baseUrl}/services/rest/record/v1/metadata-catalog/${name}`;
    console.log(`\n=== GET ${name} ===`);
    console.log(`URL: ${url}`);

    try {
      // Use raw fetch with OAuth to see actual response before signedRequest throws
      const { buildTbaAuthHeader } = await import("@/lib/providers/netsuite.provider");
      const authHeader = buildTbaAuthHeader(conn.tba, "GET", url);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/schema+json",
        },
        signal: AbortSignal.timeout(30000),
      });

      console.log(`Status: ${response.status} ${response.statusText}`);
      console.log(`Content-Type: ${response.headers.get("content-type")}`);

      const body = await response.text();
      console.log(`Body (first 500 chars):\n${body.slice(0, 500)}`);
    } catch (err) {
      console.log(`FETCH ERROR: ${err instanceof Error ? err.message : err}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
