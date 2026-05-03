import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { toConnectionLike } from "@/lib/providers";
import { MssqlProvider } from "@/lib/providers/mssql.provider";
import { mssqlPreflightSchema } from "@/lib/validations/mssql-backups";
import { resolveMssqlPolicyDatabases } from "@/lib/backups/mssql/mssql-database-discovery";

export const POST = withAuth(async (req, session) => {
  const body = await req.json();
  const parsed = mssqlPreflightSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const checks: Array<{ name: string; status: "passed" | "failed" | "warning"; message?: string }> = [];

  const connection = await prisma.connection.findFirst({
    where: { id: data.sourceConnectionId, userId: session.userId, tenantId: session.tenantId },
    select: { id: true, type: true, config: true, credentials: true },
  });
  if (!connection || connection.type !== "MSSQL") {
    return NextResponse.json({ ok: false, checks: [{ name: "SQL Server source", status: "failed", message: "MSSQL connection not found" }] }, { status: 404 });
  }

  const provider = new MssqlProvider();
  try {
    const connLike = toConnectionLike(connection);
    const canConnect = await provider.testConnection(connLike);
    checks.push({ name: "Connect to SQL Server", status: canConnect ? "passed" : "failed" });
    const databases = await resolveMssqlPolicyDatabases({
      databaseSelectionMode: data.databaseSelectionMode,
      selectedDatabases: data.selectedDatabases,
      excludedDatabases: data.excludedDatabases,
      databasePattern: data.databasePattern,
      sourceConnection: { config: connection.config },
    }, connLike, provider);
    checks.push({ name: "Resolve selected databases", status: databases.length > 0 ? "passed" : "failed", message: `${databases.length} database(s)` });
    if (data.logFrequency) {
      const simple = databases.filter((database) => database.recoveryModel === "SIMPLE");
      checks.push({
        name: "Transaction log recovery model",
        status: simple.length === 0 ? "passed" : "failed",
        message: simple.length === 0 ? undefined : `${simple.map((db) => db.name).join(", ")} use SIMPLE recovery model`,
      });
    }
  } catch (error) {
    checks.push({ name: "Preflight", status: "failed", message: error instanceof Error ? error.message : String(error) });
  }

  if (data.destinationMode === "BACKUP_TO_DISK_SHARED_PATH") {
    checks.push({
      name: "Shared path warning",
      status: "warning",
      message: "SQL Server must be able to write backupPath, and Hermod must be able to read hermodReadablePath or the same path.",
    });
  }
  if (data.destinationMode === "BACKUP_TO_DISK_SERVER_ONLY") {
    checks.push({
      name: "Server-local path warning",
      status: "warning",
      message: "Hermod will record metadata only unless a shared path or Raven/Data Agent can read the backup file.",
    });
  }
  if (data.destinationMode === "BACKUP_TO_URL" && (!data.urlBase || !data.urlCredentialName)) {
    checks.push({ name: "BACKUP TO URL settings", status: "failed", message: "URL base and SQL Server credential name are required" });
  }

  const ok = checks.every((check) => check.status !== "failed");
  return NextResponse.json({ ok, checks });
}, { minimumRole: "ADMIN" });
