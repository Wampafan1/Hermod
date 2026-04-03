/**
 * CSV File Provider — Jötunheim realm
 *
 * Reads CSV/TSV files as a data source using csv-parse streaming.
 */

import { createReadStream } from "fs";
import { access, constants } from "fs/promises";
import { resolve, join } from "path";
import { parse } from "csv-parse";
import type { ConnectionProvider } from "./provider";
import type { ConnectionLike, ProviderConnection } from "./types";
import type { SourceConfig } from "@/lib/bifrost/types";

interface CsvConfig {
  filePath: string;
  originalFilename: string;
  delimiter: string;
  hasHeaders: boolean;
  encoding: BufferEncoding;
  skipRows: number;
  pkColumns?: string[];
}

class CsvConnection implements ProviderConnection {
  constructor(public config: CsvConfig) {}
  async close() {
    // No persistent connection to close
  }
}

export class CsvProvider implements ConnectionProvider {
  readonly type = "CSV_FILE";

  async connect(connection: ConnectionLike): Promise<CsvConnection> {
    const config = connection.config as unknown as CsvConfig;
    return new CsvConnection(config);
  }

  async testConnection(connection: ConnectionLike): Promise<boolean> {
    const config = connection.config as unknown as CsvConfig;
    try {
      validateFilePath(config.filePath);
      await access(config.filePath, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async *extract(
    conn: ProviderConnection,
    config: SourceConfig
  ): AsyncGenerator<Record<string, unknown>[]> {
    const csvConn = conn as CsvConnection;
    const { filePath, delimiter, hasHeaders, encoding, skipRows, pkColumns } = csvConn.config;
    validateFilePath(filePath);
    const chunkSize = config.chunkSize ?? 10_000;
    const injectPk = pkColumns && pkColumns.length > 1;

    const parser = createReadStream(filePath, { encoding: encoding || "utf-8" }).pipe(
      parse({
        delimiter,
        columns: hasHeaders,
        skip_empty_lines: true,
        from_line: skipRows + 1, // csv-parse is 1-based
        relax_column_count: true,
        cast: (value, context) => {
          if (value === "") return null;
          return value;
        },
      })
    );

    let chunk: Record<string, unknown>[] = [];

    for await (const record of parser) {
      const row = record as Record<string, unknown>;
      if (injectPk) {
        row.__hermod_pk = pkColumns!.map((c) => String(row[c] ?? "")).join("_");
      }
      chunk.push(row);
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }

    if (chunk.length > 0) {
      yield chunk;
    }
  }
}

const UPLOADS_DIR = resolve(join(process.cwd(), "uploads"));

function validateFilePath(filePath: string): void {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(UPLOADS_DIR)) {
    throw new Error("File path outside allowed directory");
  }
}
