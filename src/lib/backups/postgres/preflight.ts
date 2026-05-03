import { spawn } from "child_process";

export interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
}

export interface BackupPreflightInput {
  walEnabled: boolean;
  replicationSlot?: string | null;
}

function runVersion(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${binary} did not respond to --version`));
    }, 5_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve((stdout || stderr).trim());
        return;
      }
      reject(new Error(`${binary} exited with code ${code}`));
    });
  });
}

export async function verifyBackupBinary(binary: "pg_dump" | "pg_receivewal" | "pg_restore"): Promise<PreflightCheck> {
  try {
    const version = await runVersion(binary);
    return {
      name: binary,
      ok: true,
      message: version || `${binary} is available`,
    };
  } catch {
    return {
      name: binary,
      ok: false,
      message: `${binary} was not found. Install PostgreSQL client tools in the app and worker runtime.`,
    };
  }
}

export async function runPostgresBackupPreflight(
  input: BackupPreflightInput
): Promise<{ ok: boolean; checks: PreflightCheck[] }> {
  const checks: PreflightCheck[] = [await verifyBackupBinary("pg_dump")];

  if (input.walEnabled) {
    checks.push(await verifyBackupBinary("pg_receivewal"));
    checks.push({
      name: "replication-slot",
      ok: !!input.replicationSlot,
      message: input.replicationSlot
        ? "Replication slot is configured"
        : "Configure a physical replication slot before enabling WAL/PITR coverage",
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}
