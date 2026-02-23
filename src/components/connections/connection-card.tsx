"use client";

type DbType = "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY";

interface ConnectionCardProps {
  connection: {
    id: string;
    name: string;
    type: DbType;
    host?: string | null;
    port?: number | null;
    database?: string | null;
    username?: string | null;
  };
  onEdit: () => void;
  onDelete: () => void;
}

const TYPE_LABELS: Record<DbType, string> = {
  POSTGRES: "PostgreSQL",
  MSSQL: "SQL Server",
  MYSQL: "MySQL",
  BIGQUERY: "BigQuery",
};

export function ConnectionCard({ connection, onEdit, onDelete }: ConnectionCardProps) {
  return (
    <div className="card-norse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="text-text text-sm">{connection.name}</h3>
          <span className="badge-neutral">
            {TYPE_LABELS[connection.type]}
          </span>
          {connection.host && (
            <p className="text-xs text-text-dim tracking-wide">
              {connection.host}
              {connection.port ? `:${connection.port}` : ""}
              {connection.database ? ` / ${connection.database}` : ""}
            </p>
          )}
          {connection.type === "BIGQUERY" && (
            <p className="text-xs text-text-dim tracking-wide">Google BigQuery</p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="btn-subtle">
            Edit
          </button>
          <button onClick={onDelete} className="btn-subtle text-error hover:text-error">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
