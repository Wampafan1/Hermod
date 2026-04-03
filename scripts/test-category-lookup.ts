/**
 * Combined category field lookup:
 * 1. Fetch inventoryItem metadata catalog → search for "category" in name/label
 * 2. SuiteQL: customfield table WHERE appliesto = 'ITEM' AND scriptid LIKE '%category%'
 * 3. Fallback: SELECT custitem_category FROM item LIMIT 1
 *
 * Usage: npx tsx scripts/test-category-lookup.ts
 */

import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers/helpers";
import {
  NetSuiteProvider,
  buildTbaAuthHeader,
} from "@/lib/providers/netsuite.provider";

const CONNECTION_ID = "cmmcgfu7800013pqvfhcr0w4b";

interface CatalogProperty {
  title?: string;
  type?: string;
  format?: string;
  enum?: string[];
  nullable?: boolean;
  "x-ns-custom-field"?: boolean;
  [key: string]: unknown;
}

async function main() {
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: CONNECTION_ID },
  });

  const connLike = toConnectionLike(connection);
  const provider = new NetSuiteProvider();
  const conn = await provider.connect(connLike);

  console.log("Connected to NetSuite OK\n");

  // ─── PART 1: Metadata Catalog for inventoryItem ───────────────────────
  console.log("═".repeat(80));
  console.log("  PART 1: METADATA CATALOG — inventoryItem");
  console.log("═".repeat(80));

  const url = `${conn.baseUrl}/services/rest/record/v1/metadata-catalog/inventoryItem`;
  console.log(`GET ${url}\n`);

  try {
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

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.log(`Body: ${body.slice(0, 300)}\n`);
    } else {
      const data = (await response.json()) as {
        properties?: Record<string, CatalogProperty>;
      };

      if (!data.properties) {
        console.log("No properties in response\n");
      } else {
        const totalFields = Object.keys(data.properties).length;
        console.log(`Total fields: ${totalFields}\n`);

        let matchCount = 0;
        for (const [key, meta] of Object.entries(data.properties)) {
          const keyLower = key.toLowerCase();
          const titleLower = (meta.title ?? "").toLowerCase();

          if (keyLower.includes("category") || titleLower.includes("category")) {
            matchCount++;
            console.log(`  MATCH #${matchCount}:`);
            console.log(`    Field name (scriptId): ${key}`);
            console.log(`    Label/title:           ${meta.title ?? "(none)"}`);
            console.log(`    Type:                  ${meta.type ?? "?"}`);
            console.log(`    Format:                ${meta.format ?? "(none)"}`);
            console.log(`    Nullable:              ${meta.nullable ?? "?"}`);
            console.log(`    Custom field:          ${meta["x-ns-custom-field"] ?? false}`);
            // Print full definition
            console.log(`    Full definition:       ${JSON.stringify(meta, null, 2)}`);
            console.log();
          }
        }

        if (matchCount === 0) {
          console.log("  No fields matching 'category' found in catalog.\n");
        } else {
          console.log(`  Total matches: ${matchCount}\n`);
        }
      }
    }
  } catch (err) {
    console.log(`ERROR: ${err instanceof Error ? err.message : err}\n`);
  }

  // ─── PART 2: SuiteQL customfield table ────────────────────────────────
  console.log("═".repeat(80));
  console.log("  PART 2: SuiteQL — customfield WHERE appliesto = 'ITEM'");
  console.log("═".repeat(80));

  const sql1 = `SELECT scriptid, label, fieldtype FROM customfield WHERE appliesto = 'ITEM' AND LOWER(scriptid) LIKE '%category%'`;
  console.log(`Query: ${sql1}\n`);

  try {
    const result1 = await provider.query(conn, sql1);
    if (result1.rows.length === 0) {
      console.log("  No rows returned.\n");
    } else {
      console.log(`  Rows: ${result1.rows.length}`);
      for (const row of result1.rows) {
        console.log(`    ${JSON.stringify(row)}`);
      }
      console.log();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ERROR: ${msg}\n`);

    // ─── PART 3: Fallback — direct SELECT from item ───────────────────
    console.log("═".repeat(80));
    console.log("  PART 3: FALLBACK — SELECT custitem_category FROM item");
    console.log("═".repeat(80));

    const sql2 = `SELECT custitem_category FROM item WHERE ROWNUM <= 5`;
    console.log(`Query: ${sql2}\n`);

    try {
      const result2 = await provider.query(conn, sql2);
      if (result2.rows.length === 0) {
        console.log("  No rows returned.\n");
      } else {
        console.log(`  Rows: ${result2.rows.length}`);
        for (const row of result2.rows) {
          console.log(`    ${JSON.stringify(row)}`);
        }
        console.log();
      }
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      console.log(`  ERROR: ${msg2}\n`);
    }
  }

  await conn.close();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
