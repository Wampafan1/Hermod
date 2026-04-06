/**
 * Auto-match profiled file columns against destination table schemas.
 *
 * Queries tenant's destination-capable connections, fetches their table schemas,
 * and scores each table by column name similarity to the profiled file.
 */

import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";
import { canBeDestination } from "@/lib/providers/capabilities";
import type { ConnectionType } from "@/lib/providers/types";
import type { AnalyzedColumn } from "@/lib/duckdb/file-analyzer";

// ─── Types ──────────────────────────────────────────

export interface ColumnMatch {
  sourceColumn: string;
  sourceType: string;
  destinationColumn: string;
  destType: string;
  matchType: "exact" | "case_insensitive" | "normalized";
}

export interface DestinationMatch {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  databaseType: string; // "POSTGRESQL" | "SQLSERVER" | "MYSQL" | "BIGQUERY"
  schema: string;
  table: string;
  matchedColumns: number;
  totalSourceColumns: number;
  totalDestColumns: number;
  matchScore: number; // 0-1
  columnMatches: ColumnMatch[];
}

interface DestTableColumn {
  name: string;
  type: string;
}

// ─── Main ───────────────────────────────────────────

export async function findDestinationMatches(
  tenantId: string,
  sourceColumns: AnalyzedColumn[],
  maxResults: number = 5
): Promise<DestinationMatch[]> {
  // 1. Get all destination-capable connections for this tenant
  const connections = await prisma.connection.findMany({
    where: {
      tenantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      name: true,
      type: true,
      config: true,
      credentials: true,
    },
  });

  const destConnections = connections.filter((c) =>
    canBeDestination(c.type as ConnectionType)
  );

  if (destConnections.length === 0) return [];

  // 2. For each connection, list tables and score
  const allMatches: DestinationMatch[] = [];

  for (const conn of destConnections) {
    try {
      const provider = getProvider(conn.type);
      if (!provider.query) continue;

      const credentials = conn.credentials
        ? JSON.parse(decrypt(conn.credentials))
        : {};
      const providerConn = await provider.connect({
        config: conn.config as Record<string, unknown>,
        credentials,
      });

      try {
        const tables = await listTablesWithColumns(provider, providerConn, conn.type);

        for (const { schema, table, columns: destColumns } of tables) {
          const match = scoreMatch(
            sourceColumns,
            destColumns,
            conn.id,
            conn.name,
            conn.type,
            schema,
            table
          );
          if (match.matchedColumns > 0) {
            allMatches.push(match);
          }
        }
      } finally {
        await providerConn.close();
      }
    } catch (err) {
      console.error(`[Gate] Failed to scan connection ${conn.name}:`, err);
      // Continue with other connections
    }
  }

  // 3. Sort by match score descending, return top N
  allMatches.sort((a, b) => b.matchScore - a.matchScore);
  return allMatches.slice(0, maxResults);
}

// ─── All destination connections (unfiltered) ──────

export interface DestinationConnection {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  databaseType: string;
}

/**
 * List ALL destination-capable connections for this tenant.
 * No filtering by match score — every connection that canBeDestination appears.
 */
export async function listDestinationConnections(
  tenantId: string
): Promise<DestinationConnection[]> {
  const connections = await prisma.connection.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: { id: true, name: true, type: true },
  });

  return connections
    .filter((c) => canBeDestination(c.type as ConnectionType))
    .map((c) => ({
      connectionId: c.id,
      connectionName: c.name,
      connectionType: c.type,
      databaseType: connectionTypeToDatabaseType(c.type),
    }));
}

// ─── Table listing ──────────────────────────────────

export async function listTablesWithColumns(
  provider: ReturnType<typeof getProvider>,
  conn: Awaited<ReturnType<ReturnType<typeof getProvider>["connect"]>>,
  connType: string
): Promise<Array<{ schema: string; table: string; columns: DestTableColumn[] }>> {
  if (!provider.query) return [];

  let sql: string;

  switch (connType) {
    case "POSTGRES":
      sql = `SELECT table_schema, table_name, column_name, data_type
             FROM information_schema.columns
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_schema, table_name, ordinal_position
             LIMIT 2000`;
      break;
    case "MSSQL":
      sql = `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name, DATA_TYPE AS data_type
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;
      break;
    case "MYSQL":
      sql = `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name, DATA_TYPE AS data_type
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION
             LIMIT 2000`;
      break;
    case "BIGQUERY":
      // BigQuery uses dataset.table — handled by getSchema
      return [];
    default:
      return [];
  }

  const result = await provider.query(conn, sql);
  const tableMap = new Map<string, { schema: string; table: string; columns: DestTableColumn[] }>();

  for (const row of result.rows) {
    const schema = String(row.table_schema ?? row.TABLE_SCHEMA ?? "public");
    const table = String(row.table_name ?? row.TABLE_NAME);
    const key = `${schema}.${table}`;

    if (!tableMap.has(key)) {
      tableMap.set(key, { schema, table, columns: [] });
    }
    tableMap.get(key)!.columns.push({
      name: String(row.column_name ?? row.COLUMN_NAME),
      type: String(row.data_type ?? row.DATA_TYPE),
    });
  }

  return Array.from(tableMap.values());
}

// ─── Column matching & scoring ──────────────────────

function normalize(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, "");
}

function scoreMatch(
  sourceColumns: AnalyzedColumn[],
  destColumns: DestTableColumn[],
  connectionId: string,
  connectionName: string,
  connectionType: string,
  schema: string,
  table: string
): DestinationMatch {
  const matches: ColumnMatch[] = [];

  // Build lookup maps for destination columns
  const exactMap = new Map<string, DestTableColumn>();
  const lowerMap = new Map<string, DestTableColumn>();
  const normalizedMap = new Map<string, DestTableColumn>();

  for (const col of destColumns) {
    exactMap.set(col.name, col);
    lowerMap.set(col.name.toLowerCase(), col);
    normalizedMap.set(normalize(col.name), col);
  }

  const usedDest = new Set<string>();

  for (const srcCol of sourceColumns) {
    // Try exact match
    let destCol = exactMap.get(srcCol.name);
    let matchType: ColumnMatch["matchType"] = "exact";

    if (!destCol || usedDest.has(destCol.name)) {
      // Try case-insensitive
      destCol = lowerMap.get(srcCol.name.toLowerCase());
      matchType = "case_insensitive";
    }

    if (!destCol || usedDest.has(destCol.name)) {
      // Try normalized (strip underscores, spaces, hyphens)
      destCol = normalizedMap.get(normalize(srcCol.name));
      matchType = "normalized";
    }

    if (destCol && !usedDest.has(destCol.name)) {
      usedDest.add(destCol.name);
      matches.push({
        sourceColumn: srcCol.name,
        sourceType: srcCol.duckdbType,
        destinationColumn: destCol.name,
        destType: destCol.type,
        matchType,
      });
    }
  }

  const matchScore =
    sourceColumns.length > 0 ? matches.length / sourceColumns.length : 0;

  return {
    connectionId,
    connectionName,
    connectionType,
    databaseType: connectionTypeToDatabaseType(connectionType),
    schema,
    table,
    matchedColumns: matches.length,
    totalSourceColumns: sourceColumns.length,
    totalDestColumns: destColumns.length,
    matchScore,
    columnMatches: matches,
  };
}

function connectionTypeToDatabaseType(connType: string): string {
  switch (connType) {
    case "POSTGRES": return "POSTGRESQL";
    case "MSSQL": return "SQLSERVER";
    case "MYSQL": return "MYSQL";
    case "BIGQUERY": return "BIGQUERY";
    default: return connType;
  }
}
