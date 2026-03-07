/**
 * BigQueryProvider — Unified ConnectionProvider for Google BigQuery.
 *
 * Merges query capability (from connectors.ts BigQueryConnector) and
 * extract/load/schema capability (from bifrost bigquery.provider.ts)
 * into a single provider.
 *
 * Uses the standard @google-cloud/bigquery client for reads (paginated)
 * and load jobs (NDJSON) for writes. No Storage API — upgrade later if needed.
 *
 * Credential source: connection.credentials.serviceAccountKey (already
 * decrypted by toConnectionLike()).
 * Config source: connection.config.projectId and connection.config.location (optional).
 */

import { PassThrough } from "stream";
import type { ConnectionProvider } from "./provider";
import { QUERY_TIMEOUT } from "./provider";
import type {
  ConnectionLike,
  ProviderConnection,
  QueryResult,
} from "./types";
import type {
  SourceConfig,
  DestConfig,
  LoadResult,
  SchemaDefinition,
  SchemaField,
} from "@/lib/bifrost/types";
import { DEFAULT_CHUNK_SIZE } from "@/lib/bifrost/types";

// ─── Cost / Safety Defaults ─────────────────────────────
// maximumBytesBilled caps how much data a query can scan before BigQuery aborts it.
const DEFAULT_MAX_BYTES_BILLED = "50000000000"; // 50 GB
const TEST_MAX_BYTES_BILLED = "1000000"; // 1 MB — just for SELECT 1
const LOAD_JOB_TIMEOUT_MS = 5 * 60_000; // 5 minutes — safety net for load jobs

// ─── Schema Cache ───────────────────────────────────────
const SCHEMA_CACHE_TTL_MS = 60 * 60_000; // 1 hour

interface CachedSchema {
  schema: SchemaDefinition | null;
  expiry: number;
}

const schemaCache = new Map<string, CachedSchema>();

function schemaCacheKey(projectId: string, dataset: string, table: string): string {
  return `${projectId}.${dataset}.${table}`;
}

/** Clear all cached schemas (for testing). */
export function clearSchemaCache(): void {
  schemaCache.clear();
}

// ─── Connection ──────────────────────────────────────────

interface BigQueryProviderConnection extends ProviderConnection {
  client: InstanceType<typeof import("@google-cloud/bigquery").BigQuery>;
  projectId: string;
}

// ─── Provider ────────────────────────────────────────────

export class BigQueryProvider implements ConnectionProvider {
  readonly type = "BIGQUERY";

  async connect(connection: ConnectionLike): Promise<BigQueryProviderConnection> {
    const { BigQuery } = await import("@google-cloud/bigquery");

    const cfg = connection.config as { projectId: string; location?: string };
    const creds = connection.credentials as {
      serviceAccountKey: Record<string, unknown>;
    };

    const client = new BigQuery({
      projectId: cfg.projectId,
      credentials: creds.serviceAccountKey,
      location: cfg.location,
    });

    return {
      client,
      projectId: cfg.projectId,
      close: async () => {
        // BigQuery client is stateless — no persistent connection to close
      },
    };
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    const conn = await this.connect(connection);
    try {
      await conn.client.query({
        query: "SELECT 1",
        maximumBytesBilled: TEST_MAX_BYTES_BILLED,
      });
      return true;
    } catch {
      return false;
    } finally {
      await conn.close();
    }
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const bqConn = conn as BigQueryProviderConnection;
    const [rows] = await bqConn.client.query({
      query: sql,
      useLegacySql: false,
      maximumBytesBilled: DEFAULT_MAX_BYTES_BILLED,
      jobTimeoutMs: String(QUERY_TIMEOUT),
    });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }

  async dryRun(
    conn: ProviderConnection,
    sql: string
  ): Promise<{ totalBytesProcessed: number; cacheHit: boolean }> {
    const bqConn = conn as BigQueryProviderConnection;
    const [, , response] = await bqConn.client.query({
      query: sql,
      useLegacySql: false,
      dryRun: true,
    });

    const stats = (response as Record<string, unknown>)?.statistics as
      | { totalBytesProcessed?: string; query?: { cacheHit?: boolean } }
      | undefined;

    return {
      totalBytesProcessed: Number(stats?.totalBytesProcessed ?? 0),
      cacheHit: stats?.query?.cacheHit ?? false,
    };
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const bqConn = conn as BigQueryProviderConnection;
    const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;

    const jobConfig: Record<string, unknown> = {
      query: config.query,
      useLegacySql: false,
      maximumBytesBilled: DEFAULT_MAX_BYTES_BILLED,
    };

    // Use BigQuery's native parameterized query support for @param placeholders
    if (config.params && Object.keys(config.params).length > 0) {
      jobConfig.params = config.params;
    }

    const [job] = await bqConn.client.createQueryJob(jobConfig);

    // Paginate results
    let pageToken: string | undefined;
    let isFirst = true;

    do {
      const options: Record<string, unknown> = {
        maxResults: chunkSize,
        autoPaginate: false,
      };
      if (pageToken) {
        options.pageToken = pageToken;
      }

      const response = await job.getQueryResults(options);
      const rows = response[0] as Record<string, unknown>[];
      const metadata = response[2] as { pageToken?: string } | undefined;

      if (rows.length > 0) {
        yield rows;
      } else if (isFirst) {
        // Source returned no rows — yield empty array to signal "no data"
        yield [];
      }

      pageToken = metadata?.pageToken;
      isFirst = false;
    } while (pageToken);
  }

  async load(
    conn: ProviderConnection,
    rows: Record<string, unknown>[],
    destConfig: DestConfig
  ): Promise<LoadResult> {
    if (rows.length === 0) {
      return { rowsLoaded: 0, errors: [] };
    }

    const bqConn = conn as BigQueryProviderConnection;

    // Detect actual dataset location to prevent regional mismatch.
    // Metadata API is global but load jobs are regional — if the client's
    // location doesn't match, the job gets "Not found: Dataset".
    const dsRef = bqConn.client.dataset(destConfig.dataset);
    try {
      const [dsMeta] = await dsRef.get();
      const actualLocation = dsMeta.metadata?.location;
      const clientLocation = (bqConn.client as any).location;
      if (actualLocation && clientLocation && actualLocation !== clientLocation) {
        console.log(
          `[BigQuery] Location mismatch: dataset "${destConfig.dataset}" is in "${actualLocation}" ` +
          `but client configured for "${clientLocation}". Overriding to "${actualLocation}".`
        );
        (bqConn.client as any).location = actualLocation;
      } else if (actualLocation && !clientLocation) {
        console.log(`[BigQuery] Setting client location to dataset location: "${actualLocation}"`);
        (bqConn.client as any).location = actualLocation;
      }
    } catch {
      // Dataset might not exist yet (autoCreateTable) — proceed without location override
    }

    const dataset = bqConn.client.dataset(destConfig.dataset);
    const table = dataset.table(destConfig.table);

    // Convert rows to NDJSON and pipe through a BigQuery load job.
    // table.load() only accepts file paths or GCS File objects in v7+,
    // so we use table.createWriteStream() which accepts piped data.
    const loadOptions: Record<string, unknown> = {
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      writeDisposition: destConfig.writeDisposition,
      autodetect: !destConfig.schema,
    };

    if (destConfig.schema) {
      loadOptions.schema = { fields: destConfig.schema.fields };
    }

    const ndjson = new PassThrough();
    for (const row of rows) {
      ndjson.write(floatSafeJsonLine(row) + "\n");
    }
    ndjson.end();

    const writable = (table as any).createWriteStream(loadOptions);

    const loadJob = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        writable.destroy();
        reject(new Error(
          `BigQuery load job timed out after ${LOAD_JOB_TIMEOUT_MS / 1000}s ` +
          `for ${destConfig.dataset}.${destConfig.table}`
        ));
      }, LOAD_JOB_TIMEOUT_MS);

      writable.on("job", (job: any) => {
        job.on("complete", () => { clearTimeout(timer); resolve(job); });
        job.on("error", (err: Error) => { clearTimeout(timer); reject(err); });
      });
      writable.on("error", (err: Error) => { clearTimeout(timer); reject(err); });
      ndjson.pipe(writable);
    });

    const [metadata] = await loadJob.getMetadata();

    const outputRows = Number(
      metadata.statistics?.load?.outputRows ?? rows.length
    );
    const errors = (metadata.status?.errors ?? []).map(
      (e: { message?: string; location?: string }) => ({
        message: e.message ?? "Unknown error",
        location: e.location,
      })
    );

    return { rowsLoaded: outputRows, errors };
  }

  async getSchema(
    conn: ProviderConnection,
    dataset: string,
    table: string
  ): Promise<SchemaDefinition | null> {
    const bqConn = conn as BigQueryProviderConnection;
    const cacheKey = schemaCacheKey(bqConn.projectId, dataset, table);

    // Check cache first
    const cached = schemaCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) {
      return cached.schema;
    }

    try {
      const [metadata] = await bqConn.client
        .dataset(dataset)
        .table(table)
        .getMetadata();

      const bqFields = metadata.schema?.fields;
      if (!bqFields || !Array.isArray(bqFields)) {
        schemaCache.set(cacheKey, { schema: null, expiry: Date.now() + SCHEMA_CACHE_TTL_MS });
        return null;
      }

      const schema: SchemaDefinition = { fields: bqFields.map(mapBqField) };
      schemaCache.set(cacheKey, { schema, expiry: Date.now() + SCHEMA_CACHE_TTL_MS });
      return schema;
    } catch (err: unknown) {
      // Table doesn't exist — cache the null and return
      if (
        err instanceof Error &&
        (err.message.includes("Not found") || err.message.includes("404"))
      ) {
        // Short TTL for missing tables — they might be created soon
        schemaCache.set(cacheKey, { schema: null, expiry: Date.now() + 60_000 });
        return null;
      }
      throw err;
    }
  }

  /** Invalidate a cached schema (e.g., after createTable). */
  invalidateSchema(projectId: string, dataset: string, table: string): void {
    schemaCache.delete(schemaCacheKey(projectId, dataset, table));
  }

  /** Ensure a dataset exists, creating it if missing. */
  async ensureDataset(conn: ProviderConnection, dataset: string): Promise<void> {
    const bqConn = conn as BigQueryProviderConnection;
    const ds = bqConn.client.dataset(dataset);
    try {
      await ds.get();
      console.log(`[BigQuery] Dataset "${dataset}" exists in project "${bqConn.projectId}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[BigQuery] Dataset "${dataset}" not found (${msg}), creating...`);
      await ds.create();
      console.log(`[BigQuery] Created dataset "${dataset}" in project "${bqConn.projectId}"`);
    }
  }

  async createTable(
    conn: ProviderConnection,
    dataset: string,
    tableName: string,
    schema: SchemaDefinition
  ): Promise<void> {
    const bqConn = conn as BigQueryProviderConnection;
    const ds = bqConn.client.dataset(dataset);

    // Ensure dataset exists
    try {
      await ds.get();
    } catch {
      await ds.create();
    }

    await ds.createTable(tableName, {
      schema: { fields: schema.fields },
    });

    // Invalidate cache so next getSchema() sees the new table
    this.invalidateSchema(bqConn.projectId, dataset, tableName);
  }
}

// ─── Helpers ─────────────────────────────────────────────

/**
 * Serialize a row to JSON with all integer literals written as floats (e.g., 5 → 5.0).
 *
 * BigQuery NDJSON autodetect infers INTEGER from `5` and FLOAT from `5.5`.
 * If different load jobs produce different types for the same column (e.g.,
 * `totalquantityonhand` is 5 in one chunk and 5.5 in another), BigQuery
 * rejects the later job with a schema mismatch error.
 *
 * Writing all numbers as floats ensures consistent FLOAT64 inference.
 */
export function floatSafeJsonLine(row: Record<string, unknown>): string {
  // Use a replacer to tag integers, then post-process to add ".0".
  // The old regex approach could corrupt strings containing patterns
  // like "1,2,3" or "price:100}".
  return JSON.stringify(row, (_key, value) => {
    if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
      return `__FLOAT__${value}`;
    }
    return value;
  }).replace(/"__FLOAT__(-?\d+)"/g, "$1.0");
}

function mapBqField(field: Record<string, unknown>): SchemaField {
  const result: SchemaField = {
    name: field.name as string,
    type: field.type as string,
    mode: (field.mode as string) ?? "NULLABLE",
  };

  if (field.description) {
    result.description = field.description as string;
  }

  if (Array.isArray(field.fields)) {
    result.fields = field.fields.map(mapBqField);
  }

  return result;
}
