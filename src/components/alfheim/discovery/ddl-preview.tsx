"use client";

import { useState, useEffect, useCallback } from "react";
import type { SchemaMapping } from "@/lib/alfheim/types";

interface DDLPreviewProps {
  tableName: string;
  schema: SchemaMapping;
}

type Dialect = "postgres" | "mssql" | "mysql" | "bigquery";

const DIALECTS: { value: Dialect; label: string }[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mssql", label: "SQL Server" },
  { value: "mysql", label: "MySQL" },
  { value: "bigquery", label: "BigQuery" },
];

export function DDLPreview({ tableName, schema }: DDLPreviewProps) {
  const [dialect, setDialect] = useState<Dialect>("bigquery");
  const [ddl, setDdl] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchDDL = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alfheim/discover/ddl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableName, schema, dialect }),
      });
      if (!res.ok) throw new Error("Failed to generate DDL");
      const data = await res.json();
      setDdl(data.statements ?? []);
      setWarnings(data.warnings ?? []);
    } catch {
      setDdl([`-- Error generating DDL for ${dialect}`]);
    } finally {
      setLoading(false);
    }
  }, [tableName, schema, dialect]);

  useEffect(() => {
    if (tableName && schema.columns.length > 0) {
      fetchDDL();
    }
  }, [fetchDDL, tableName, schema]);

  const fullDdl = ddl.join("\n\n");

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(fullDdl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [fullDdl]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([fullDdl], { type: "text/sql" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fullDdl, tableName]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="label-norse">DDL Preview</h3>
        <div className="flex items-center gap-2">
          <select
            value={dialect}
            onChange={(e) => setDialect(e.target.value as Dialect)}
            className="input-norse text-xs py-1"
          >
            {DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <button type="button" onClick={handleCopy} className="btn-ghost text-xs py-1 px-2">
            {copied ? "\u2713 Copied" : "Copy"}
          </button>
          <button type="button" onClick={handleDownload} className="btn-ghost text-xs py-1 px-2">
            Download .sql
          </button>
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/30 p-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-amber-400 text-[10px] tracking-wide">{w}</p>
          ))}
        </div>
      )}

      {/* SQL output */}
      <div className="border border-border bg-void p-4 overflow-x-auto max-h-96 overflow-y-auto">
        {loading ? (
          <p className="text-text-dim text-xs">Generating...</p>
        ) : (
          <pre className="text-text text-xs font-inconsolata leading-relaxed whitespace-pre-wrap">
            {fullDdl || "-- No DDL generated"}
          </pre>
        )}
      </div>
    </div>
  );
}
