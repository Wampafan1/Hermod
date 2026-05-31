/**
 * READ-ONLY diagnostic for a failed Gate push.
 *
 * Run with: npx tsx --env-file=.env scripts/diagnose-gate-push.ts ["file name substring"]
 *
 * Prints:
 *   - the matched GatePush (status, counts, errorMessage, per-row errorDetails.rowErrors)
 *   - the gate config (mergeStrategy, primary key, target, connection type, column mapping)
 *   - the LIVE destination table schema and a diff vs. the gate's column mapping
 *
 * Does NOT write anything anywhere. Destination access is metadata-read only.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";

const fileNeedle = process.argv[2] ?? "OM Billing Summary";

function j(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function main() {
  console.log(`\n=== GATE PUSH DIAGNOSTIC (fileName contains "${fileNeedle}") ===`);

  let push = await prisma.gatePush.findFirst({
    where: { fileName: { contains: fileNeedle, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
  });

  if (!push) {
    console.log(`No push matched that file name. Falling back to most recent FAILED/PARTIAL push.`);
    push = await prisma.gatePush.findFirst({
      where: { status: { in: ["FAILED", "PARTIAL"] } },
      orderBy: { createdAt: "desc" },
    });
  }

  if (!push) {
    console.log("No matching push found at all.");
    return;
  }

  console.log(`\n--- PUSH ---`);
  console.log(
    `id=${push.id} file="${push.fileName}" status=${push.status} created=${push.createdAt.toISOString()}`
  );
  console.log(
    `rowCount=${push.rowCount} inserted=${push.rowsInserted} updated=${push.rowsUpdated} ` +
      `errored=${push.rowsErrored} blankSkipped=${push.blankRowsSkipped} duration=${push.duration ?? "?"}ms`
  );
  console.log(`driftResolution=${push.driftResolution ?? "(none)"}`);
  console.log(`errorMessage=${push.errorMessage ?? "(none)"}`);

  const details = push.errorDetails as Record<string, unknown> | null;
  const rowErrors = (details?.rowErrors as Array<Record<string, unknown>> | undefined) ?? null;

  if (rowErrors && rowErrors.length > 0) {
    console.log(`\n--- ROW ERRORS (stored: ${rowErrors.length}${details?.rowErrorsTruncated ? ", truncated" : ""}) ---`);
    const byKey = new Map<string, { count: number; destType: unknown; examples: unknown[] }>();
    for (const e of rowErrors) {
      const key = `${e.column} | ${e.reason}`;
      const bucket = byKey.get(key) ?? { count: 0, destType: e.destType, examples: [] };
      bucket.count++;
      if (bucket.examples.length < 5) bucket.examples.push(e.valuePreview);
      byKey.set(key, bucket);
    }
    for (const [key, bucket] of byKey) {
      console.log(
        `  [${bucket.count}x] ${key}  (destType=${bucket.destType ?? "?"})\n        examples: ${j(bucket.examples)}`
      );
    }
  } else {
    console.log(`\n--- errorDetails (raw) ---\n${j(details)}`);
  }

  const gate = await prisma.realmGate.findUnique({
    where: { id: push.gateId },
    include: { connection: true },
  });

  if (!gate) {
    console.log("\nGate row not found.");
    return;
  }

  const columnMapping = (gate.columnMapping as Array<Record<string, unknown>>) ?? [];
  const primaryKeyColumns = Array.isArray(gate.primaryKeyColumns)
    ? (gate.primaryKeyColumns as string[])
    : [];
  const savedSchema = (gate.savedSchema as Array<Record<string, unknown>>) ?? [];

  console.log(`\n--- GATE CONFIG ---`);
  console.log(`gate id=${gate.id}`);
  console.log(`connection type=${gate.connection.type} name="${gate.connection.name}"`);
  console.log(`target=${gate.targetSchema ?? "(no schema)"}.${gate.targetTable}`);
  console.log(`mergeStrategy=${gate.mergeStrategy}`);
  console.log(`primaryKeyColumns (source names)=${j(primaryKeyColumns)}`);
  console.log(`keyConstraintName=${gate.keyConstraintName ?? "(none)"}`);
  console.log(`columnMapping (count=${columnMapping.length}):`);
  for (const m of columnMapping) {
    console.log(
      `    "${m.sourceColumn}" -> "${m.destinationColumn}"  destType=${m.destType ?? "?"} (srcType=${m.sourceType ?? "?"})`
    );
  }
  console.log(`savedSchema columns (count=${savedSchema.length}): ${j(savedSchema.map((c) => `${c.name}:${c.duckdbType ?? c.inferredType}`))}`);

  // --- Live destination schema (READ ONLY) ---
  console.log(`\n--- LIVE DESTINATION TABLE SCHEMA ---`);
  const provider = getProvider(gate.connection.type);
  if (!provider.getSchema) {
    console.log(`Provider ${gate.connection.type} has no getSchema(); skipping live diff.`);
    return;
  }

  let conn: Awaited<ReturnType<typeof provider.connect>> | null = null;
  try {
    const credentials = gate.connection.credentials
      ? JSON.parse(decrypt(gate.connection.credentials))
      : {};
    conn = await provider.connect({
      type: gate.connection.type,
      config: gate.connection.config as Record<string, unknown>,
      credentials,
    });
    const schema = await provider.getSchema(conn, gate.targetSchema || "public", gate.targetTable);
    const liveFields = schema?.fields ?? [];
    if (liveFields.length === 0) {
      console.log(`!! Live table "${gate.targetSchema ?? ""}.${gate.targetTable}" returned NO columns — table may not exist or is empty of columns.`);
    } else {
      console.log(`live columns (count=${liveFields.length}):`);
      for (const f of liveFields) console.log(`    ${f.name} : ${f.type ?? "?"}`);
    }

    if (provider.query) {
      try {
        const schemaRef = gate.targetSchema ? `"${gate.targetSchema}".` : "";
        const countRes = await provider.query(conn, `SELECT COUNT(*) AS n FROM ${schemaRef}"${gate.targetTable}"`);
        const row = (countRes.rows?.[0] ?? {}) as Record<string, unknown>;
        const n = row.n ?? row.N ?? Object.values(row)[0];
        console.log(`\n>>> LIVE ROW COUNT of ${gate.targetSchema ?? ""}.${gate.targetTable} = ${n}`);
      } catch (e) {
        console.log(`(row count query failed: ${e instanceof Error ? e.message : String(e)})`);
      }
    }

    const liveByLower = new Map(liveFields.map((f) => [f.name.toLowerCase(), f]));

    console.log(`\n--- MAPPING vs LIVE TABLE DIFF ---`);
    let missing = 0;
    for (const m of columnMapping) {
      const dest = String(m.destinationColumn ?? "");
      const live = liveByLower.get(dest.toLowerCase());
      if (!live) {
        missing++;
        console.log(`  !! destinationColumn "${dest}" NOT FOUND in live table  (INSERT/UPDATE would fail)`);
      } else if (String(live.type).toLowerCase() !== String(m.destType ?? "").toLowerCase()) {
        console.log(`  ~  "${dest}" type: live=${live.type}  mapping.destType=${m.destType}`);
      }
    }
    if (missing === 0) console.log(`  (all ${columnMapping.length} mapped destination columns exist in the live table)`);

    // PK presence
    const pkDest = primaryKeyColumns.map((src) => {
      const m = columnMapping.find(
        (cm) => String(cm.sourceColumn).toLowerCase() === src.toLowerCase()
      );
      return (m?.destinationColumn as string) ?? src;
    });
    console.log(`\n--- PRIMARY KEY (resolved source->destination) ---`);
    for (let i = 0; i < primaryKeyColumns.length; i++) {
      const dest = pkDest[i];
      const present = liveByLower.has(String(dest).toLowerCase());
      console.log(`  "${primaryKeyColumns[i]}" -> "${dest}"  ${present ? "present" : "!! MISSING in table"}`);
    }
  } catch (err) {
    console.log(`Live schema fetch failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch {
        /* ignore */
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("Diagnostic failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
