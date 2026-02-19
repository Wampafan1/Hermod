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

const TYPE_COLORS: Record<DbType, string> = {
  POSTGRES: "bg-blue-500/10 text-blue-400",
  MSSQL: "bg-orange-500/10 text-orange-400",
  MYSQL: "bg-cyan-500/10 text-cyan-400",
  BIGQUERY: "bg-purple-500/10 text-purple-400",
};

export function ConnectionCard({ connection, onEdit, onDelete }: ConnectionCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="font-medium text-white">{connection.name}</h3>
          <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[connection.type]}`}
          >
            {TYPE_LABELS[connection.type]}
          </span>
          {connection.host && (
            <p className="text-sm text-gray-400">
              {connection.host}
              {connection.port ? `:${connection.port}` : ""}
              {connection.database ? ` / ${connection.database}` : ""}
            </p>
          )}
          {connection.type === "BIGQUERY" && (
            <p className="text-sm text-gray-400">Google BigQuery</p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            className="text-gray-400 hover:text-red-400 text-sm transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
