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
    try {
      const conn = await this.connect(connection);
      await conn.client.query({
        query: "SELECT 1",
        maximumBytesBilled: "1000000",
      });
      return true;
    } catch {
      return false;
    }
  }

  async query(conn: ProviderConnection, sql: string): Promise<QueryResult> {
    const bqConn = conn as BigQueryProviderConnection;
    const [rows] = await bqConn.client.query({
      query: sql,
      useLegacySql: false,
    });
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { columns, rows };
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const bqConn = conn as BigQueryProviderConnection;
    const chunkSize = config.chunkSize ?? DEFAULT_CHUNK_SIZE;

    const [job] = await bqConn.client.createQueryJob({
      query: config.query,
      useLegacySql: false,
    });

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
      ndjson.write(JSON.stringify(row) + "\n");
    }
    ndjson.end();

    const writable = (table as any).createWriteStream(loadOptions);

    const loadJob = await new Promise<any>((resolve, reject) => {
      writable.on("job", (job: any) => {
        job.on("complete", () => resolve(job));
        job.on("error", (err: Error) => reject(err));
      });
      writable.on("error", (err: Error) => reject(err));
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

    try {
      const [metadata] = await bqConn.client
        .dataset(dataset)
        .table(table)
        .getMetadata();

      const bqFields = metadata.schema?.fields;
      if (!bqFields || !Array.isArray(bqFields)) return null;

      return {
        fields: bqFields.map(mapBqField),
      };
    } catch (err: unknown) {
      // Table doesn't exist — return null
      if (
        err instanceof Error &&
        (err.message.includes("Not found") || err.message.includes("404"))
      ) {
        return null;
      }
      throw err;
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
  }
}

// ─── Helpers ─────────────────────────────────────────────

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
