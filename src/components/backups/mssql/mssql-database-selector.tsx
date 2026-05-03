"use client";

interface MssqlDatabaseInfo {
  name: string;
  state?: string;
  recoveryModel?: string;
  sizeBytes?: string | number | null;
  canConnect?: boolean;
}

interface MssqlDatabaseSelectorProps {
  sourceScope: "DATABASE" | "SERVER";
  configuredDatabase: string;
  mode: string;
  selectedDatabases: string[];
  excludedDatabases: string[];
  databasePattern: string;
  discoveredDatabases: MssqlDatabaseInfo[];
  discovering: boolean;
  onModeChange: (mode: string) => void;
  onDiscover: () => void;
  onToggleDatabase: (database: string) => void;
  onExcludedChange: (databases: string[]) => void;
  onPatternChange: (pattern: string) => void;
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatBytes(value: string | number | null | undefined): string {
  if (value == null) return "-";
  const bytes = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = bytes / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[index]}`;
}

export function MssqlDatabaseSelector({
  sourceScope,
  configuredDatabase,
  mode,
  selectedDatabases,
  excludedDatabases,
  databasePattern,
  discoveredDatabases,
  discovering,
  onModeChange,
  onDiscover,
  onToggleDatabase,
  onExcludedChange,
  onPatternChange,
}: MssqlDatabaseSelectorProps) {
  if (sourceScope === "DATABASE") {
    return (
      <div className="border border-border bg-void/40 p-3">
        <div className="label-norse mb-2">Database Scope</div>
        <p className="text-text-dim text-xs tracking-wide leading-6">
          This connection protects <span className="text-gold font-mono">{configuredDatabase}</span>. Use a SERVER-scoped SQL Server
          connection to protect multiple databases from one policy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]">
          <label className="label-norse">Database Selection</label>
          <select
            value={mode}
            onChange={(event) => onModeChange(event.target.value)}
            className="select-norse"
          >
            <option value="SINGLE">One database</option>
            <option value="MULTIPLE">Selected databases</option>
            <option value="ALL_USER_DATABASES">All user databases</option>
            <option value="PATTERN">Matching pattern</option>
          </select>
        </div>
        <button
          type="button"
          onClick={onDiscover}
          disabled={discovering}
          className="btn-subtle px-4 py-2 text-xs tracking-[0.15em] uppercase"
        >
          {discovering ? "Discovering..." : "Discover Databases"}
        </button>
      </div>

      {mode === "PATTERN" && (
        <div>
          <label className="label-norse">Database Pattern</label>
          <input
            value={databasePattern}
            onChange={(event) => onPatternChange(event.target.value)}
            className="input-norse font-mono text-xs"
            placeholder="^(prod|app)_"
          />
          <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
            Hermod treats this as a regular expression matched against discovered online user databases.
          </p>
        </div>
      )}

      {(mode === "ALL_USER_DATABASES" || mode === "PATTERN") && (
        <div>
          <label className="label-norse">Excluded Databases</label>
          <input
            value={excludedDatabases.join(", ")}
            onChange={(event) => onExcludedChange(commaList(event.target.value))}
            className="input-norse font-mono text-xs"
            placeholder="sandbox, reporting_tmp"
          />
        </div>
      )}

      {(mode === "SINGLE" || mode === "MULTIPLE") && (
        <div>
          <label className="label-norse">Selected Databases</label>
          {discoveredDatabases.length === 0 ? (
            <p className="text-text-dim text-xs tracking-wide leading-6">
              Run discovery to choose databases from this SQL Server instance.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {discoveredDatabases.map((database) => (
                <label key={database.name} className="border border-border bg-deep/70 p-3 cursor-pointer hover:bg-gold/[0.03] transition-colors">
                  <div className="flex items-center gap-2">
                    <input
                      type={mode === "SINGLE" ? "radio" : "checkbox"}
                      checked={selectedDatabases.includes(database.name)}
                      onChange={() => onToggleDatabase(database.name)}
                      className="accent-gold"
                    />
                    <span className="text-text text-xs tracking-wide">{database.name}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[0.62rem] tracking-widest uppercase text-text-dim/75">
                    <span>{database.recoveryModel ?? "UNKNOWN"}</span>
                    <span>{database.state ?? "ONLINE"}</span>
                    <span>{formatBytes(database.sizeBytes)}</span>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "ALL_USER_DATABASES" && (
        <div className="border border-frost/30 bg-frost/10 p-3 text-frost text-xs tracking-wide leading-6">
          Hermod resolves online user databases at run time. System databases are excluded.
        </div>
      )}
    </div>
  );
}
