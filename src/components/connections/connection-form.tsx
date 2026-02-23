"use client";

import { useState, useRef } from "react";
import { useToast } from "@/components/toast";

type DbType = "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY";

interface ConnectionFormProps {
  onSaved: () => void;
  onClose: () => void;
  initial?: {
    id: string;
    name: string;
    type: DbType;
    host?: string | null;
    port?: number | null;
    database?: string | null;
    username?: string | null;
  };
}

const DEFAULT_PORTS: Record<string, number> = {
  POSTGRES: 5432,
  MSSQL: 1433,
  MYSQL: 3306,
};

const TYPE_LABELS: Record<DbType, string> = {
  POSTGRES: "PostgreSQL",
  MSSQL: "SQL Server",
  MYSQL: "MySQL",
  BIGQUERY: "BigQuery",
};

export function ConnectionForm({ onSaved, onClose, initial }: ConnectionFormProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<DbType>(initial?.type ?? "POSTGRES");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? DEFAULT_PORTS.POSTGRES);
  const [database, setDatabase] = useState(initial?.database ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [bqCredentials, setBqCredentials] = useState<Record<string, unknown> | null>(null);
  const [bqFileName, setBqFileName] = useState("");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const isBigQuery = type === "BIGQUERY";

  function handleTypeChange(newType: DbType) {
    setType(newType);
    setTestResult(null);
    if (newType !== "BIGQUERY" && DEFAULT_PORTS[newType]) {
      setPort(DEFAULT_PORTS[newType]);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBqFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        if (json.type !== "service_account") {
          toast.error("JSON must be a service account key file");
          return;
        }
        setBqCredentials(json);
        toast.success("Credentials file loaded");
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  function buildPayload() {
    if (isBigQuery) {
      return { name, type, extras: bqCredentials };
    }
    return { name, type, host, port, database, username, password };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        toast.success("Connection successful!");
      } else {
        toast.error(data.error || "Connection failed");
      }
    } catch {
      setTestResult({ success: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = isEditing
        ? `/api/connections/${initial!.id}`
        : "/api/connections";
      const method = isEditing ? "PUT" : "POST";
      const payload = buildPayload();

      if (isEditing && !password && !isBigQuery) {
        delete (payload as any).password;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success(isEditing ? "Connection updated" : "Connection created");
      onSaved();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="bg-deep border border-border-mid w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="heading-norse text-sm">
            {isEditing ? "Edit Connection" : "Add Connection"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="label-norse">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-norse"
              placeholder="Production Database"
            />
          </div>

          {/* Type */}
          <div>
            <label className="label-norse">Type</label>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as DbType)}
              disabled={isEditing}
              className="select-norse"
            >
              {(Object.keys(TYPE_LABELS) as DbType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* SQL Connection Fields */}
          {!isBigQuery && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="label-norse">Host</label>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="input-norse"
                    placeholder="localhost"
                  />
                </div>
                <div>
                  <label className="label-norse">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="input-norse"
                  />
                </div>
              </div>
              <div>
                <label className="label-norse">Database</label>
                <input
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  className="input-norse"
                  placeholder="my_database"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-norse">Username</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input-norse"
                    placeholder="postgres"
                  />
                </div>
                <div>
                  <label className="label-norse">
                    Password{isEditing ? " (blank = keep)" : ""}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-norse"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </>
          )}

          {/* BigQuery Fields */}
          {isBigQuery && (
            <div>
              <label className="label-norse">
                Service Account JSON
              </label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-4 py-8 bg-deep border-2 border-dashed border-gold-dim text-center cursor-pointer hover:border-gold transition-colors"
              >
                {bqFileName ? (
                  <p className="text-xs text-success tracking-wide">{bqFileName}</p>
                ) : (
                  <p className="text-xs text-text-dim tracking-wide">
                    Click to upload service account JSON file
                  </p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div
              className={`text-xs px-3 py-2 ${
                testResult.success
                  ? "bg-success-dim border border-success/30 text-success"
                  : "bg-error-dim border border-error/30 text-error"
              }`}
            >
              {testResult.success
                ? "Connection successful!"
                : testResult.error || "Connection failed"}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-border bg-surface">
          <button
            onClick={handleTest}
            disabled={testing}
            className="btn-ghost text-xs"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="btn-subtle"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs"
          >
            <span>{saving ? "Saving..." : "Save"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
