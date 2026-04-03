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

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  // Asgard — Databases
  POSTGRES: { bg: "rgba(212,175,55,0.12)", text: "#d4af37", border: "rgba(212,175,55,0.3)" },
  MSSQL:    { bg: "rgba(212,175,55,0.12)", text: "#d4af37", border: "rgba(212,175,55,0.3)" },
  MYSQL:    { bg: "rgba(212,175,55,0.12)", text: "#d4af37", border: "rgba(212,175,55,0.3)" },
  BIGQUERY: { bg: "rgba(212,175,55,0.12)", text: "#d4af37", border: "rgba(212,175,55,0.3)" },
  // Alfheim — Cloud/API
  NETSUITE: { bg: "rgba(206,147,216,0.12)", text: "#ce93d8", border: "rgba(206,147,216,0.3)" },
  // Midgard — FTP/SFTP
  SFTP:     { bg: "rgba(102,187,106,0.12)", text: "#66bb6a", border: "rgba(102,187,106,0.3)" },
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

  const typeColor = TYPE_COLORS[connection.type];

  return (
    <div className="card-norse hoverable-card">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="text-text text-sm">{connection.name}</h3>
          {typeColor ? (
            <span
              className="inline-flex items-center px-2 py-0.5 text-[0.6875rem] font-space-grotesk font-medium tracking-[0.1em] uppercase border"
              style={{
                background: typeColor.bg,
                color: typeColor.text,
                borderColor: typeColor.border,
              }}
            >
              {TYPE_LABELS[connection.type] ?? connection.type}
            </span>
          ) : (
            <span className="badge-neutral">
              {TYPE_LABELS[connection.type] ?? connection.type}
            </span>
          )}
          {detail && (
            <p className="text-xs text-text-dim tracking-wide">
              {detail}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connection.status === "OK"
                  ? "bg-success status-pulse-green"
                  : connection.status === "FAILED"
                    ? "bg-error status-pulse-red"
                    : "bg-text-muted"
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
