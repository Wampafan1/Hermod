"use client";

import { useState, useRef } from "react";
import { useToast } from "@/components/toast";
import type { UnifiedConnection } from "@/components/connections/connection-card";

type ConnectionType = "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY" | "NETSUITE" | "SFTP";

interface ConnectionFormProps {
  onSaved: () => void;
  onClose: () => void;
  initial?: UnifiedConnection;
}

const DEFAULT_PORTS: Record<string, number> = {
  POSTGRES: 5432,
  MSSQL: 1433,
  MYSQL: 3306,
  SFTP: 22,
};

const TYPE_LABELS: Record<ConnectionType, string> = {
  POSTGRES: "PostgreSQL",
  MSSQL: "SQL Server",
  MYSQL: "MySQL",
  BIGQUERY: "BigQuery",
  NETSUITE: "NetSuite",
  SFTP: "SFTP",
};

const SFTP_FILE_FORMATS = ["CSV", "TSV", "XLSX"] as const;
const SFTP_SOURCE_TYPES = ["ADP", "QUICKBOOKS", "SAP", "GENERIC_FILE", "CUSTOM_SFTP"] as const;

function extractFromConfig(config: Record<string, unknown> | undefined, key: string, fallback: unknown = ""): any {
  if (!config) return fallback;
  return config[key] ?? fallback;
}

export function ConnectionForm({ onSaved, onClose, initial }: ConnectionFormProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!initial;
  const initialConfig = initial?.config as Record<string, unknown> | undefined;

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<ConnectionType>((initial?.type as ConnectionType) ?? "POSTGRES");

  // SQL + SFTP shared fields
  const [host, setHost] = useState<string>(extractFromConfig(initialConfig, "host", ""));
  const [port, setPort] = useState<number>(
    extractFromConfig(initialConfig, "port", DEFAULT_PORTS[(initial?.type as string) ?? "POSTGRES"] ?? 5432)
  );
  const [database, setDatabase] = useState<string>(extractFromConfig(initialConfig, "database", ""));
  const [username, setUsername] = useState<string>(extractFromConfig(initialConfig, "username", ""));
  const [password, setPassword] = useState("");

  // BigQuery
  const [bqProjectId, setBqProjectId] = useState<string>(extractFromConfig(initialConfig, "projectId", ""));
  const [bqCredentials, setBqCredentials] = useState<Record<string, unknown> | null>(null);
  const [bqFileName, setBqFileName] = useState("");

  // NetSuite TBA fields
  const [nsAccountId, setNsAccountId] = useState<string>(extractFromConfig(initialConfig, "accountId", ""));
  const [nsConsumerKey, setNsConsumerKey] = useState("");
  const [nsConsumerSecret, setNsConsumerSecret] = useState("");
  const [nsTokenId, setNsTokenId] = useState("");
  const [nsTokenSecret, setNsTokenSecret] = useState("");

  // SFTP-specific
  const [sftpFileFormat, setSftpFileFormat] = useState<string>(extractFromConfig(initialConfig, "fileFormat", "CSV"));
  const [sftpSourceType, setSftpSourceType] = useState<string>(extractFromConfig(initialConfig, "sourceType", "GENERIC_FILE"));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; message?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const isBigQuery = type === "BIGQUERY";
  const isNetSuite = type === "NETSUITE";
  const isSftp = type === "SFTP";
  const isSql = !isBigQuery && !isNetSuite && !isSftp;

  function handleTypeChange(newType: ConnectionType) {
    setType(newType);
    setTestResult(null);
    if (DEFAULT_PORTS[newType]) {
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
        // Extract projectId from the service account JSON
        if (json.project_id) {
          setBqProjectId(json.project_id);
        }
        toast.success("Credentials file loaded");
      } catch {
        toast.error("Invalid JSON file");
      }
    };
    reader.readAsText(file);
  }

  function buildPayload(): { name: string; type: string; config: Record<string, unknown>; credentials?: Record<string, unknown> } {
    if (isBigQuery) {
      return {
        name,
        type,
        config: { projectId: bqProjectId, location: "US" },
        ...(bqCredentials ? { credentials: { serviceAccountKey: bqCredentials } } : {}),
      };
    }
    if (isNetSuite) {
      return {
        name,
        type,
        config: { accountId: nsAccountId },
        credentials: {
          consumerKey: nsConsumerKey,
          consumerSecret: nsConsumerSecret,
          tokenId: nsTokenId,
          tokenSecret: nsTokenSecret,
        },
      };
    }
    if (isSftp) {
      return {
        name,
        type,
        config: {
          host,
          port,
          username,
          fileFormat: sftpFileFormat,
          sourceType: sftpSourceType,
        },
        ...(password ? { credentials: { password } } : {}),
      };
    }
    // SQL types
    return {
      name,
      type,
      config: { host, port, database, username, ssl: false },
      ...(password ? { credentials: { password } } : {}),
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const payload = buildPayload();
      // For test, we always need credentials
      // If editing and no password provided, warn user
      if (isEditing && !password && !isBigQuery && !isNetSuite) {
        setTestResult({ success: false, error: "Enter password to test connection" });
        setTesting(false);
        return;
      }

      const res = await fetch("/api/v2/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        setTestResult({ success: true });
        toast.success(data.message || "Connection successful!");
      } else {
        setTestResult({ success: false, error: data.error || data.message || "Connection failed" });
        toast.error(data.error || data.message || "Connection failed");
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
        ? `/api/v2/connections/${initial!.id}`
        : "/api/v2/connections";
      const method = isEditing ? "PUT" : "POST";
      const payload = buildPayload();

      // For PUT (edit): omit credentials if empty (keep existing)
      if (isEditing) {
        const hasNewCredentials = isBigQuery
          ? !!bqCredentials
          : isNetSuite
            ? !!(nsConsumerKey || nsConsumerSecret || nsTokenId || nsTokenSecret)
            : !!password;

        if (!hasNewCredentials) {
          delete (payload as any).credentials;
        }
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
      <div className="bg-deep border border-border-mid w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
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
              onChange={(e) => handleTypeChange(e.target.value as ConnectionType)}
              disabled={isEditing}
              className="select-norse"
            >
              {(Object.keys(TYPE_LABELS) as ConnectionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          {/* NetSuite TBA Fields */}
          {isNetSuite && (
            <>
              <div>
                <label className="label-norse">Account ID</label>
                <input
                  value={nsAccountId}
                  onChange={(e) => setNsAccountId(e.target.value)}
                  className="input-norse"
                  placeholder='e.g., 1234567 or 1234567_SB1 for sandbox'
                />
                <p className="text-text-dim/80 text-[0.5625rem] tracking-wide mt-1">
                  Found at Setup &gt; Company &gt; Company Information
                </p>
              </div>
              <div>
                <label className="label-norse">Consumer Key</label>
                <input
                  value={nsConsumerKey}
                  onChange={(e) => setNsConsumerKey(e.target.value)}
                  className="input-norse"
                  placeholder={isEditing ? "(leave blank to keep)" : "From the Integration Record"}
                />
              </div>
              <div>
                <label className="label-norse">Consumer Secret</label>
                <input
                  type="password"
                  value={nsConsumerSecret}
                  onChange={(e) => setNsConsumerSecret(e.target.value)}
                  className="input-norse"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="label-norse">Token ID</label>
                <input
                  value={nsTokenId}
                  onChange={(e) => setNsTokenId(e.target.value)}
                  className="input-norse"
                  placeholder={isEditing ? "(leave blank to keep)" : "From the Access Token"}
                />
              </div>
              <div>
                <label className="label-norse">Token Secret</label>
                <input
                  type="password"
                  value={nsTokenSecret}
                  onChange={(e) => setNsTokenSecret(e.target.value)}
                  className="input-norse"
                  placeholder="••••••••"
                />
              </div>
            </>
          )}

          {/* SQL Connection Fields */}
          {isSql && (
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
            <>
              <div>
                <label className="label-norse">Project ID</label>
                <input
                  value={bqProjectId}
                  onChange={(e) => setBqProjectId(e.target.value)}
                  className="input-norse"
                  placeholder="my-gcp-project"
                />
                <p className="text-text-dim/80 text-[0.5625rem] tracking-wide mt-1">
                  Auto-filled from service account JSON, or enter manually
                </p>
              </div>
              <div>
                <label className="label-norse">
                  Service Account JSON{isEditing ? " (upload to replace)" : ""}
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
            </>
          )}

          {/* SFTP Fields */}
          {isSftp && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="label-norse">Host</label>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="input-norse"
                    placeholder="sftp.example.com"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-norse">Username</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input-norse"
                    placeholder="sftpuser"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-norse">Source Type</label>
                  <select
                    value={sftpSourceType}
                    onChange={(e) => setSftpSourceType(e.target.value)}
                    className="select-norse"
                  >
                    {SFTP_SOURCE_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {st === "GENERIC_FILE" ? "File Drop" : st === "CUSTOM_SFTP" ? "Custom" : st}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label-norse">File Format</label>
                  <select
                    value={sftpFileFormat}
                    onChange={(e) => setSftpFileFormat(e.target.value)}
                    className="select-norse"
                  >
                    {SFTP_FILE_FORMATS.map((ff) => (
                      <option key={ff} value={ff}>
                        {ff}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
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
