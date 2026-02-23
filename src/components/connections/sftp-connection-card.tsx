"use client";

type SftpSourceType = "ADP" | "QUICKBOOKS" | "SAP" | "GENERIC_FILE" | "CUSTOM_SFTP";
type SftpStatus = "ACTIVE" | "ERROR" | "DISABLED";

interface SftpConnectionCardProps {
  connection: {
    id: string;
    name: string;
    sourceType: SftpSourceType;
    status: SftpStatus;
    lastFileAt: string | null;
    lastFileName: string | null;
    filesProcessed: number;
    sftpUsername: string;
  };
  onViewCredentials: () => void;
  onDelete: () => void;
}

const SOURCE_LABELS: Record<SftpSourceType, string> = {
  ADP: "ADP",
  QUICKBOOKS: "QuickBooks",
  SAP: "SAP",
  GENERIC_FILE: "File Drop",
  CUSTOM_SFTP: "Custom SFTP",
};

const STATUS_STYLES: Record<SftpStatus, { badge: string; dot: string }> = {
  ACTIVE: { badge: "badge-success", dot: "bg-success animate-pip-pulse" },
  ERROR: { badge: "badge-error", dot: "bg-error" },
  DISABLED: { badge: "badge-neutral", dot: "bg-text-dim" },
};

const STATUS_LABELS: Record<SftpStatus, string> = {
  ACTIVE: "Watching",
  ERROR: "Error",
  DISABLED: "Disabled",
};

export function SftpConnectionCard({
  connection,
  onViewCredentials,
  onDelete,
}: SftpConnectionCardProps) {
  const style = STATUS_STYLES[connection.status];

  return (
    <div className="card-norse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="text-text text-sm">{connection.name}</h3>
          <div className="flex items-center gap-2">
            <span className="badge-neutral">
              {SOURCE_LABELS[connection.sourceType]}
            </span>
            <span className={style.badge}>
              <span className={`w-1.5 h-1.5 ${style.dot}`} />
              {STATUS_LABELS[connection.status]}
            </span>
          </div>
          <div className="space-y-0.5 mt-2">
            {connection.lastFileAt && connection.lastFileName && (
              <p className="text-xs text-text-dim tracking-wide">
                Last file: {connection.lastFileName}
                <span className="text-text-dim/60 ml-2">
                  {new Date(connection.lastFileAt).toLocaleDateString()}
                </span>
              </p>
            )}
            <p className="text-xs text-text-dim tracking-wide">
              {connection.filesProcessed} file{connection.filesProcessed !== 1 ? "s" : ""} processed
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={onViewCredentials} className="btn-subtle">
            Credentials
          </button>
          <button onClick={onDelete} className="btn-subtle text-error hover:text-error">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
