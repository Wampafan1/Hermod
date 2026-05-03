/** Maximum rows returned by the preview endpoint. */
export const PREVIEW_ROW_LIMIT = 10_000;

export const MSSQL_RESET_ROWCOUNT_SQL = "SET ROWCOUNT 0;";

export interface LimitedSqlQuery {
  sql: string;
  limited: boolean;
  usesSessionRowLimit: boolean;
}

function stripTrailingTerminators(sql: string): string {
  let trimmed = sql.trim();
  while (trimmed.endsWith(";")) {
    trimmed = trimmed.slice(0, -1).trimEnd();
  }
  return trimmed;
}

function stripLeadingComments(sql: string): string {
  let remaining = sql.trimStart();
  let changed = true;
  while (changed) {
    changed = false;
    if (remaining.startsWith("--")) {
      const nextLine = remaining.indexOf("\n");
      remaining = nextLine === -1 ? "" : remaining.slice(nextLine + 1).trimStart();
      changed = true;
    } else if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      if (end === -1) return remaining;
      remaining = remaining.slice(end + 2).trimStart();
      changed = true;
    }
  }
  return remaining;
}

function isReadQuery(sql: string): boolean {
  return /^(select|with)\b/i.test(stripLeadingComments(sql));
}

export function buildLimitedSqlQuery(
  sql: string,
  connectionType: string,
  maxRows: number
): LimitedSqlQuery {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error("SQL row limit must be a positive safe integer");
  }

  if (!isReadQuery(sql)) {
    return { sql, limited: false, usesSessionRowLimit: false };
  }

  const trimmed = stripTrailingTerminators(sql);
  if (!trimmed) {
    return { sql, limited: false, usesSessionRowLimit: false };
  }

  if (connectionType === "MSSQL") {
    return {
      sql: `SET ROWCOUNT ${maxRows};\n${trimmed};\n${MSSQL_RESET_ROWCOUNT_SQL}`,
      limited: true,
      usesSessionRowLimit: true,
    };
  }

  if (connectionType === "POSTGRES" || connectionType === "MYSQL" || connectionType === "BIGQUERY") {
    return {
      sql: `SELECT * FROM (\n${trimmed}\n) AS __hermod_limited LIMIT ${maxRows}`,
      limited: true,
      usesSessionRowLimit: false,
    };
  }

  return { sql, limited: false, usesSessionRowLimit: false };
}
