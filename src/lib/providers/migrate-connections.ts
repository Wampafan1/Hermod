/**
 * Migration script: DataSource + SftpConnection → unified Connection model.
 *
 * Pure transform functions (no DB access) + a runnable migration script.
 * Run via: npx tsx src/lib/providers/migrate-connections.ts
 */

import { encrypt, decrypt } from "@/lib/crypto";

// ─── Types ────────────────────────────────────────────────

export interface MigrationResult {
  oldId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  credentials: string; // encrypted JSON
  userId: string;
  status: string;
}

/** Shape of a Prisma DataSource row (subset of fields we need). */
interface DataSourceRow {
  id: string;
  name: string;
  type: string;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  extras?: unknown;
  userId: string;
}

/** Shape of a Prisma SftpConnection row (subset of fields we need). */
interface SftpConnectionRow {
  id: string;
  name: string;
  sftpHost: string;
  sftpPort: number;
  sftpUsername: string;
  sftpPassword: string;
  fileFormat: string;
  sourceType: string;
  status?: string;
  userId: string;
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Try to decrypt a value. If decryption fails (e.g., value is already
 * plaintext or null), return the raw value.
 */
export function tryDecrypt(value: string | null | undefined): string {
  if (value == null) return "";
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

// ─── Transform Functions ──────────────────────────────────

/**
 * Transform a DataSource row into the unified Connection shape.
 * Handles 5 types: POSTGRES, MSSQL, MYSQL, BIGQUERY, NETSUITE.
 */
export function transformDataSource(ds: DataSourceRow): MigrationResult {
  const base = {
    oldId: ds.id,
    name: ds.name,
    type: ds.type,
    userId: ds.userId,
    status: "ACTIVE",
  };

  switch (ds.type) {
    case "POSTGRES":
    case "MSSQL":
    case "MYSQL": {
      const decryptedPassword = ds.password ? tryDecrypt(ds.password) : "";
      return {
        ...base,
        config: {
          host: ds.host,
          port: ds.port,
          database: ds.database,
          username: ds.username,
          ssl: false,
        },
        credentials: encrypt(JSON.stringify({ password: decryptedPassword })),
      };
    }

    case "BIGQUERY": {
      const extras = (ds.extras ?? null) as Record<string, unknown> | null;
      const projectId = extras?.project_id ?? extras?.projectId;
      return {
        ...base,
        config: {
          projectId,
          location: "US",
        },
        credentials: encrypt(
          JSON.stringify({ serviceAccountKey: extras })
        ),
      };
    }

    case "NETSUITE": {
      const extras = (ds.extras ?? null) as Record<string, unknown> | null;
      return {
        ...base,
        config: {
          accountId: extras?.accountId,
        },
        credentials: encrypt(
          JSON.stringify({
            consumerKey: extras?.consumerKey,
            consumerSecret: tryDecrypt(
              extras?.consumerSecret as string | null | undefined
            ),
            tokenId: extras?.tokenId,
            tokenSecret: tryDecrypt(
              extras?.tokenSecret as string | null | undefined
            ),
          })
        ),
      };
    }

    default:
      throw new Error(`Unsupported DataSource type: ${ds.type}`);
  }
}

/**
 * Transform an SftpConnection row into the unified Connection shape.
 */
export function transformSftpConnection(
  sftp: SftpConnectionRow
): MigrationResult {
  return {
    oldId: sftp.id,
    name: sftp.name,
    type: "SFTP",
    config: {
      host: sftp.sftpHost,
      port: sftp.sftpPort,
      username: sftp.sftpUsername,
      fileFormat: sftp.fileFormat,
      sourceType: sftp.sourceType,
    },
    credentials: encrypt(
      JSON.stringify({ password: tryDecrypt(sftp.sftpPassword) })
    ),
    userId: sftp.userId,
    status: sftp.status || "ACTIVE",
  };
}

// ─── Runnable Migration Script ────────────────────────────

/** Upsert a single MigrationResult into the Connection table (idempotent). */
async function upsertConnection(
  prisma: { connection: { findFirst: Function; create: Function } },
  transformed: MigrationResult,
  sourceLabel: string
): Promise<{ newId: string; action: "created" | "skipped" }> {
  // Idempotency: skip if a Connection with same name+type+userId exists
  const existing = await prisma.connection.findFirst({
    where: {
      name: transformed.name,
      type: transformed.type as never,
      userId: transformed.userId,
    },
  });

  if (existing) {
    console.log(
      `  SKIP ${sourceLabel} "${transformed.name}" (${transformed.type}) — already exists as Connection ${existing.id}`
    );
    return { newId: existing.id, action: "skipped" };
  }

  const conn = await prisma.connection.create({
    data: {
      name: transformed.name,
      type: transformed.type as never,
      config: transformed.config,
      credentials: transformed.credentials,
      status: transformed.status as never,
      userId: transformed.userId,
    },
  });

  console.log(
    `  CREATE ${sourceLabel} "${transformed.name}" (${transformed.type}) → Connection ${conn.id}`
  );
  return { newId: conn.id, action: "created" };
}

async function runMigration() {
  // Dynamic import to avoid loading Prisma in test contexts
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    console.log("Starting connection migration...\n");

    // 1. Read all DataSource records (raw SQL since model was removed from schema)
    const dataSources = await prisma.$queryRaw<DataSourceRow[]>`
      SELECT id, name, type, host, port, database, username, password, extras, "userId"
      FROM "DataSource"
    `;
    console.log(`Found ${dataSources.length} DataSource record(s)`);

    // 2. Read all SftpConnection records
    const sftpConnections = await prisma.$queryRaw<SftpConnectionRow[]>`
      SELECT id, name, "sftpHost", "sftpPort", "sftpUsername", "sftpPassword",
             "fileFormat"::text, "sourceType"::text, status::text, "userId"
      FROM "SftpConnection"
    `;
    console.log(`Found ${sftpConnections.length} SftpConnection record(s)\n`);

    const idMapping: Record<string, string> = {};
    let created = 0;
    let skipped = 0;

    // 3. Transform and insert DataSource records
    for (const ds of dataSources) {
      const transformed = transformDataSource(ds);
      const { newId, action } = await upsertConnection(prisma, transformed, "DataSource");
      idMapping[ds.id] = newId;
      if (action === "created") created++;
      else skipped++;
    }

    // 4. Transform and insert SftpConnection records
    for (const sftp of sftpConnections) {
      const transformed = transformSftpConnection(sftp);
      const { newId, action } = await upsertConnection(prisma, transformed, "SftpConnection");
      idMapping[sftp.id] = newId;
      if (action === "created") created++;
      else skipped++;
    }

    // 5. Output mapping
    console.log(`\nMigration complete: ${created} created, ${skipped} skipped`);
    console.log("\nID Mapping (oldId → newId):");
    console.log(JSON.stringify(idMapping, null, 2));

    // Write mapping to file for downstream FK updates
    const fs = await import("fs");
    const mappingPath = "migration-id-mapping.json";
    fs.writeFileSync(mappingPath, JSON.stringify(idMapping, null, 2));
    console.log(`\nMapping written to ${mappingPath}`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run when executed directly (npx tsx src/lib/providers/migrate-connections.ts)
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].includes("migrate-connections") ||
    process.argv[1].endsWith("migrate-connections.ts"));

if (isMainModule) {
  runMigration();
}
