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

      // For edit, only send password if user entered a new one
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
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEditing ? "Edit Connection" : "Add Connection"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            placeholder="Production Database"
          />
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Type</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as DbType)}
            disabled={isEditing}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
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
                <label className="block text-sm text-gray-400 mb-1">Host</label>
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="localhost"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Database</label>
              <input
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="my_database"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="postgres"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Password{isEditing ? " (leave blank to keep)" : ""}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </>
        )}

        {/* BigQuery Fields */}
        {isBigQuery && (
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Service Account JSON
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-8 bg-gray-800 border-2 border-dashed border-gray-600 rounded-lg text-center cursor-pointer hover:border-blue-500 transition-colors"
            >
              {bqFileName ? (
                <p className="text-sm text-green-400">{bqFileName}</p>
              ) : (
                <p className="text-sm text-gray-400">
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
            className={`text-sm px-3 py-2 rounded-lg ${
              testResult.success
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {testResult.success
              ? "Connection successful!"
              : testResult.error || "Connection failed"}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 text-sm bg-gray-800 border border-gray-600 rounded-lg text-gray-300 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 rounded-lg text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
