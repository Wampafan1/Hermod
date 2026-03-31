"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/toast";
import type { ConnectionType } from "@/lib/providers/types";

export interface UnifiedConnection {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  status?: string | null;
  lastTestedAt?: string | null;
}

interface ConnectionCardProps {
  connection: UnifiedConnection;
  onEdit: () => void;
  onDelete: () => void;
}

export const TYPE_LABELS: Record<string, string> = {
  POSTGRES: "PostgreSQL",
  MSSQL: "SQL Server",
  MYSQL: "MySQL",
  BIGQUERY: "BigQuery",
  NETSUITE: "NetSuite",
  SFTP: "SFTP",
};

function getDetailLine(connection: UnifiedConnection): string | null {
  const config = connection.config;
  const type = connection.type as ConnectionType;

  switch (type) {
    case "POSTGRES":
    case "MSSQL":
    case "MYSQL": {
      const host = config.host as string | undefined;
      const port = config.port as number | undefined;
      const db = config.database as string | undefined;
      if (!host) return null;
      let line = host;
      if (port) line += `:${port}`;
      if (db) line += ` / ${db}`;
      return line;
    }
    case "BIGQUERY": {
      const projectId = config.projectId as string | undefined;
      return projectId ? `Project: ${projectId}` : "Google BigQuery";
    }
    case "NETSUITE": {
      const accountId = config.accountId as string | undefined;
      return accountId ? `Account: ${accountId}` : "Oracle NetSuite";
    }
    case "SFTP": {
      const host = config.host as string | undefined;
      const port = config.port as number | undefined;
      if (!host) return null;
      return port ? `${host}:${port}` : host;
    }
    default:
      return null;
  }
}

export function ConnectionCard({ connection, onEdit, onDelete }: ConnectionCardProps) {
  const detail = getDetailLine(connection);
  const toast = useToast();
  const [testing, setTesting] = useState(false);

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/connections/${connection.id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("Connection is healthy");
      } else {
        toast.error(data.error || "Connection test failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="card-norse">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="text-text text-sm">{connection.name}</h3>
          <span className="badge-neutral">
            {TYPE_LABELS[connection.type] ?? connection.type}
          </span>
          {detail && (
            <p className="text-xs text-text-dim tracking-wide">
              {detail}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connection.status === "OK"
                  ? "bg-emerald-500"
                  : connection.status === "FAILED"
                    ? "bg-red-500"
                    : "bg-gray-600"
              }`}
            />
            <span className="text-[0.6rem] text-text-dim tracking-wider">
              {connection.lastTestedAt
                ? `Tested ${formatDistanceToNow(new Date(connection.lastTestedAt), { addSuffix: true })}`
                : "Never tested"}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleTest} disabled={testing} className="btn-subtle text-frost hover:text-gold-bright">
            {testing ? "Testing..." : "Test"}
          </button>
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
