"use client";

interface StorageTargetOption {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
}

interface MssqlDestinationModePanelProps {
  mode: string;
  backupPath: string;
  hermodReadablePath: string;
  urlBase: string;
  urlCredentialName: string;
  storageTargetId: string;
  targets: StorageTargetOption[];
  onModeChange: (mode: string) => void;
  onBackupPathChange: (value: string) => void;
  onHermodReadablePathChange: (value: string) => void;
  onUrlBaseChange: (value: string) => void;
  onUrlCredentialNameChange: (value: string) => void;
  onStorageTargetChange: (value: string) => void;
}

export function MssqlDestinationModePanel({
  mode,
  backupPath,
  hermodReadablePath,
  urlBase,
  urlCredentialName,
  storageTargetId,
  targets,
  onModeChange,
  onBackupPathChange,
  onHermodReadablePathChange,
  onUrlBaseChange,
  onUrlCredentialNameChange,
  onStorageTargetChange,
}: MssqlDestinationModePanelProps) {
  return (
    <div className="border border-border bg-deep p-5">
      <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Destination Mode</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
        {[
          ["BACKUP_TO_DISK_SHARED_PATH", "Shared path + upload", "SQL Server writes a .bak/.dif/.trn file where Hermod can also read it, then Hermod uploads it to S3/GCS."],
          ["BACKUP_TO_URL", "BACKUP TO URL", "SQL Server writes directly to an Azure Blob URL using a SQL Server Credential."],
          ["BACKUP_TO_DISK_SERVER_ONLY", "Server-local path only", "Hermod records status and metadata, but cannot upload or verify the file from the worker."],
          ["RAVEN_AGENT_BACKUP", "Raven/Data Agent", "Future on-prem agent mode for networks where Hermod cannot read SQL Server backup files."],
        ].map(([value, title, description]) => (
          <label
            key={value}
            className={`border p-3 transition-colors ${mode === value ? "border-gold bg-gold/[0.05]" : "border-border bg-void/30 hover:bg-gold/[0.03]"} ${value === "RAVEN_AGENT_BACKUP" ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <div className="flex items-start gap-2">
              <input
                type="radio"
                value={value}
                checked={mode === value}
                disabled={value === "RAVEN_AGENT_BACKUP"}
                onChange={(event) => onModeChange(event.target.value)}
                className="accent-gold mt-1"
              />
              <div>
                <div className="text-text text-xs tracking-[0.14em] uppercase">{title}</div>
                <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-1">{description}</p>
              </div>
            </div>
          </label>
        ))}
      </div>

      {mode === "BACKUP_TO_DISK_SHARED_PATH" && (
        <div className="space-y-4">
          <div className="border border-frost/30 bg-frost/10 p-3 text-frost text-xs tracking-wide leading-6">
            SQL Server creates the backup file from the database server. Hermod can upload it only when the Hermod worker can read
            the same path or a mounted equivalent.
          </div>
          <div>
            <label className="label-norse">SQL Server Writes To</label>
            <input
              value={backupPath}
              onChange={(event) => onBackupPathChange(event.target.value)}
              className="input-norse font-mono text-xs"
              placeholder="\\\\fileserver\\sqlbackups"
            />
          </div>
          <div>
            <label className="label-norse">Hermod Reads From</label>
            <input
              value={hermodReadablePath}
              onChange={(event) => onHermodReadablePathChange(event.target.value)}
              className="input-norse font-mono text-xs"
              placeholder="/mnt/sqlbackups or leave blank if same path"
            />
          </div>
          <div>
            <label className="label-norse">Hermod Storage Target</label>
            <select
              value={storageTargetId}
              onChange={(event) => onStorageTargetChange(event.target.value)}
              className="select-norse"
            >
              <option value="">Record local file only...</option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name} ({target.provider})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {mode === "BACKUP_TO_DISK_SERVER_ONLY" && (
        <div className="space-y-4">
          <div className="border border-ember/30 bg-ember/10 p-3 text-ember text-xs tracking-wide leading-6">
            SQL Server will create the backup on the SQL Server host. Hermod will record the backup command result, but cannot
            upload or checksum the file unless this path is shared or a Data Agent can access it.
          </div>
          <div>
            <label className="label-norse">SQL Server Backup Path</label>
            <input
              value={backupPath}
              onChange={(event) => onBackupPathChange(event.target.value)}
              className="input-norse font-mono text-xs"
              placeholder="C:\\SQLBackups"
            />
          </div>
        </div>
      )}

      {mode === "BACKUP_TO_URL" && (
        <div className="space-y-4">
          <div className="border border-frost/30 bg-frost/10 p-3 text-frost text-xs tracking-wide leading-6">
            This mode is Azure Blob-oriented for MVP. The SQL Server Credential must exist on the SQL Server instance and grant
            access to the configured container/path.
          </div>
          <div>
            <label className="label-norse">URL Base</label>
            <input
              value={urlBase}
              onChange={(event) => onUrlBaseChange(event.target.value)}
              className="input-norse font-mono text-xs"
              placeholder="https://account.blob.core.windows.net/container/hermod"
            />
          </div>
          <div>
            <label className="label-norse">SQL Server Credential Name</label>
            <input
              value={urlCredentialName}
              onChange={(event) => onUrlCredentialNameChange(event.target.value)}
              className="input-norse font-mono text-xs"
              placeholder="HermodBackupCredential"
            />
          </div>
        </div>
      )}
    </div>
  );
}
