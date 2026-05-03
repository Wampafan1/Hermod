import type { MssqlBackupDestinationMode, MssqlBackupType } from "@prisma/client";

export interface MssqlBackupSqlOptions {
  database: string;
  type: MssqlBackupType;
  destinationMode: MssqlBackupDestinationMode;
  target: string;
  credentialName?: string | null;
  compressionEnabled?: boolean;
  checksumEnabled?: boolean;
  copyOnly?: boolean;
}

export function quoteMssqlIdentifier(value: string): string {
  return `[${value.replace(/\]/g, "]]")}]`;
}

export function quoteMssqlString(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

function destinationKeyword(mode: MssqlBackupDestinationMode): "DISK" | "URL" {
  return mode === "BACKUP_TO_URL" ? "URL" : "DISK";
}

function extension(type: MssqlBackupType): string {
  if (type === "DIFFERENTIAL") return "dif";
  if (type === "LOG") return "trn";
  return "bak";
}

export function backupFileExtension(type: MssqlBackupType): string {
  return extension(type);
}

export function buildMssqlBackupSql(input: MssqlBackupSqlOptions): string {
  const verb = input.type === "LOG" ? "BACKUP LOG" : "BACKUP DATABASE";
  const options: string[] = [];

  if (input.type === "DIFFERENTIAL") options.push("DIFFERENTIAL");
  if (input.compressionEnabled !== false) options.push("COMPRESSION");
  if (input.checksumEnabled !== false) options.push("CHECKSUM");
  if (input.copyOnly && input.type === "FULL") options.push("COPY_ONLY");
  if (input.destinationMode === "BACKUP_TO_URL" && input.credentialName) {
    options.push(`CREDENTIAL = ${quoteMssqlString(input.credentialName)}`);
  }
  options.push("INIT", "STATS = 10");

  return [
    `${verb} ${quoteMssqlIdentifier(input.database)}`,
    `TO ${destinationKeyword(input.destinationMode)} = ${quoteMssqlString(input.target)}`,
    `WITH ${options.join(", ")};`,
  ].join("\n");
}

export function buildMssqlVerifySql(input: Pick<MssqlBackupSqlOptions, "destinationMode" | "target" | "checksumEnabled">): string {
  const options = input.checksumEnabled === false ? "" : " WITH CHECKSUM";
  return `RESTORE VERIFYONLY FROM ${destinationKeyword(input.destinationMode)} = ${quoteMssqlString(input.target)}${options};`;
}

export function buildMssqlArtifactKey(input: {
  prefix: string;
  policyId: string;
  database: string;
  type: MssqlBackupType;
  at: Date;
}): string {
  const prefix = input.prefix.replace(/^\/+|\/+$/g, "") || "niflheim";
  const database = input.database.replace(/[\\/\0]/g, "_");
  const yyyy = String(input.at.getUTCFullYear());
  const mm = String(input.at.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.at.getUTCDate()).padStart(2, "0");
  const stamp = input.at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const type = input.type.toLowerCase();
  return `${prefix}/${input.policyId}/mssql/${database}/${type}/${yyyy}/${mm}/${dd}/${database}-${type}-${stamp}.${extension(input.type)}`;
}

export function buildMssqlBackupFileName(input: {
  database: string;
  type: MssqlBackupType;
  at: Date;
}): string {
  const database = input.database.replace(/[\\/\0]/g, "_");
  const stamp = input.at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const type = input.type.toLowerCase();
  return `${database}-${type}-${stamp}.${extension(input.type)}`;
}
