/**
 * READ-ONLY end-to-end dry run: pushes the real file through the same data path
 * as executePush (load -> map -> refresh destTypes from live table -> coerce),
 * but WITHOUT writing any rows. Proves the coercion fix lands all rows.
 *
 * Run: npx tsx --env-file=.env scripts/verify-gate-coercion.ts ["path to file"]
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import {
  loadRowsFromGateFile,
  prepareMappedRowsForPush,
  coerceGateRowsForDestination,
  resolvePrimaryKeyDestinationColumns,
  type ColumnMap,
} from "@/lib/gates/push-executor";

const filePath =
  process.argv[2] ??
  "C:\\Users\\JDelg\\Downloads\\LOV - OM Billing Summary - Departures 10.20.24 thru 4.18.26 (1).xlsx";

async function main() {
  const gate = await prisma.realmGate.findFirst({
    where: { targetTable: "loves_billing_summary" },
    include: { connection: true },
    orderBy: { createdAt: "desc" },
  });
  if (!gate) return console.log("gate not found");

  const provider = getProvider(gate.connection.type);
  const credentials = gate.connection.credentials ? JSON.parse(decrypt(gate.connection.credentials)) : {};
  const conn = await provider.connect({
    type: gate.connection.type,
    config: gate.connection.config as Record<string, unknown>,
    credentials,
  });

  try {
    let mapping = gate.columnMapping as unknown as ColumnMap[];

    // Mirror resolveDestinationColumnMapping: stamp live destination types.
    if (provider.getSchema) {
      const schema = await provider.getSchema(conn, gate.targetSchema || "public", gate.targetTable);
      const liveByLower = new Map((schema?.fields ?? []).map((f) => [f.name.toLowerCase(), f]));
      mapping = mapping.map((m) => {
        const live = liveByLower.get(m.destinationColumn.toLowerCase());
        return live ? { ...m, destType: live.type ?? m.destType } : m;
      });
    }

    const buffer = readFileSync(filePath);
    const rows = await loadRowsFromGateFile(buffer, ".xlsx");
    console.log(`Loaded ${rows.length} rows from file.`);

    const primaryKeyColumns = Array.isArray(gate.primaryKeyColumns)
      ? (gate.primaryKeyColumns as string[])
      : [];

    const prepared = prepareMappedRowsForPush({
      rows,
      columnMapping: mapping,
      primaryKeyColumns,
      mergeStrategy: gate.mergeStrategy,
    });
    console.log(`Blank rows skipped: ${prepared.blankRowsSkipped}`);
    if (prepared.keyDrift) {
      console.log(`!! KEY_DRIFT would block: ${prepared.keyDrift.reason}`);
    }

    const coerced = coerceGateRowsForDestination({
      rows: prepared.indexedMappedRows,
      columnMapping: mapping,
    });

    console.log(`\nRows that would load cleanly: ${coerced.rows.length}`);
    console.log(`Rows that would ERROR: ${coerced.errors.length}`);
    if (coerced.errors.length > 0) {
      const byKey = new Map<string, number>();
      for (const e of coerced.errors) {
        const k = `${e.column} | ${e.reason}`;
        byKey.set(k, (byKey.get(k) ?? 0) + 1);
      }
      for (const [k, n] of byKey) console.log(`  [${n}x] ${k}`);
    }

    // Show a few converted etd serials
    const etdDest = resolvePrimaryKeyDestinationColumns(["ETD"], mapping)[0] ?? "etd";
    const sampleSerials = coerced.rows.slice(0, 5).map((r) => r.row[etdDest]);
    console.log(`\nSample converted "${etdDest}" serials (first 5): ${JSON.stringify(sampleSerials)}`);
    console.log(`(expect integers ~45585..46090; 45595 = 2024-10-30)`);
  } finally {
    await conn.close();
  }
}

main()
  .catch((e) => {
    console.error("verify failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
