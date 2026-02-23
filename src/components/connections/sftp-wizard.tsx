"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { CredentialCard } from "./credential-card";
import { useToast } from "@/components/toast";
import type { SourceType } from "./source-picker";

type SftpSourceType = Exclude<SourceType, "POSTGRES" | "MSSQL" | "MYSQL" | "BIGQUERY" | "EMAIL_SMTP">;

interface SftpWizardProps {
  sourceType: SftpSourceType;
  sourceName: string;
  onBack: () => void;
}

const STEPS = ["Name It", "Credentials", "Processing", "Review"];

const SETUP_INSTRUCTIONS: Record<SftpSourceType, string[]> = {
  ADP: [
    "Give these credentials to your ADP administrator:",
    "1. In ADP, go to Reports \u2192 Scheduled Exports",
    "2. Set delivery method to SFTP",
    "3. Enter the credentials above",
    "4. Set your export schedule",
    "5. Test the connection from ADP",
  ],
  QUICKBOOKS: [
    "Configure QuickBooks to export reports via SFTP:",
    "1. Open QuickBooks Desktop or Online",
    "2. Navigate to Reports \u2192 Scheduled Reports",
    "3. Set export format to CSV or XLSX",
    "4. Configure SFTP delivery with credentials above",
    "5. Schedule the export frequency",
  ],
  SAP: [
    "Configure your SAP system for SFTP export:",
    "1. In SAP, navigate to the relevant transaction",
    "2. Set up a periodic export job",
    "3. Configure SFTP delivery using the credentials above",
    "4. Verify the file lands in the inbound folder",
  ],
  GENERIC_FILE: [
    "Use these credentials to upload files via any SFTP client:",
    "1. Connect with an SFTP client (FileZilla, WinSCP, etc.)",
    "2. Navigate to the /inbound folder",
    "3. Upload your data files (CSV, TSV, or XLSX)",
    "4. Files are processed automatically on arrival",
  ],
  CUSTOM_SFTP: [
    "Connect any system that supports SFTP file delivery:",
    "1. Use the credentials above in your system's SFTP settings",
    "2. Upload files to the /inbound folder",
    "3. Supported formats: CSV, TSV, XLSX",
    "4. Files are processed and loaded to BigQuery automatically",
  ],
};

export function SftpWizard({ sourceType, sourceName, onBack }: SftpWizardProps) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Step 1 — Name
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2 — Credentials (generated after step 1)
  const [credentials, setCredentials] = useState<{
    host: string;
    port: number;
    username: string;
    password: string;
    connectionId: string;
  } | null>(null);

  // Step 3 — Processing
  const [fileFormat, setFileFormat] = useState("CSV");
  const [bqDataset, setBqDataset] = useState("");
  const [bqTable, setBqTable] = useState("");
  const [loadMode, setLoadMode] = useState("REPLACE");
  const [emails, setEmails] = useState("");

  const handleStep1Next = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Connection name is required");
      return;
    }

    // Create the connection now to generate credentials
    setCreating(true);
    try {
      const res = await fetch("/api/sftp-connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          sourceType,
          fileFormat,
          bqDataset: bqDataset || "default_dataset",
          bqTable: bqTable || "default_table",
          loadMode,
          notificationEmails: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to create connection");
        return;
      }
      setCredentials({
        host: data.sftpHost,
        port: data.sftpPort,
        username: data.sftpUsername,
        password: data.sftpPassword,
        connectionId: data.id,
      });
      setStep(1);
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  }, [name, description, sourceType, fileFormat, bqDataset, bqTable, loadMode, toast]);

  const handleTestConnection = useCallback(async () => {
    if (!credentials) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/sftp-connections/${credentials.connectionId}/test`, {
        method: "POST",
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  }, [credentials]);

  const handleStep3Next = useCallback(async () => {
    if (!credentials) return;
    if (!bqDataset.trim() || !bqTable.trim()) {
      toast.error("BigQuery dataset and table are required");
      return;
    }

    // Update the connection with processing config
    const emailList = emails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    try {
      const res = await fetch(`/api/sftp-connections/${credentials.connectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileFormat,
          bqDataset: bqDataset.trim(),
          bqTable: bqTable.trim(),
          loadMode,
          notificationEmails: emailList,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to update");
        return;
      }
      setStep(3);
    } catch {
      toast.error("Network error");
    }
  }, [credentials, bqDataset, bqTable, fileFormat, loadMode, emails, toast]);

  const handleFinish = () => {
    toast.success("Connection created");
    router.push("/connections");
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1 flex-1">
            <div
              className={`w-6 h-6 flex items-center justify-center text-[0.625rem] font-bold transition-colors ${
                i < step
                  ? "bg-gold text-void"
                  : i === step
                    ? "bg-gold-dim border border-gold text-gold-bright"
                    : "bg-deep border border-border text-text-dim"
              }`}
            >
              {i < step ? "\u2713" : i + 1}
            </div>
            <span
              className={`text-[0.5625rem] tracking-widest uppercase hidden sm:block ${
                i <= step ? "text-text" : "text-text-dim"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < step ? "bg-gold" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Name */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h2 className="heading-norse text-lg mb-1">Name Your Connection</h2>
            <p className="text-text-dim text-xs tracking-wide">
              Give this {sourceName} integration a recognizable name
            </p>
          </div>

          <div>
            <label className="label-norse">Connection Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Acme Corp Payroll"
              className="input-norse"
              autoFocus
            />
          </div>

          <div>
            <label className="label-norse">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Weekly payroll export from ADP"
              className="input-norse"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={onBack} className="btn-ghost">
              <span>Back</span>
            </button>
            <button
              onClick={handleStep1Next}
              disabled={!name.trim() || creating}
              className="btn-primary"
            >
              <span>{creating ? "Creating..." : "Generate Credentials"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Credentials */}
      {step === 1 && credentials && (
        <div className="space-y-5">
          <div>
            <h2 className="heading-norse text-lg mb-1">Credentials Generated</h2>
            <p className="text-text-dim text-xs tracking-wide">
              Use these credentials to configure {sourceName} SFTP delivery
            </p>
          </div>

          <CredentialCard
            credentials={[
              { label: "Host", value: credentials.host },
              { label: "Port", value: String(credentials.port) },
              { label: "Username", value: credentials.username },
              { label: "Password", value: credentials.password },
            ]}
          />

          {/* System-specific instructions */}
          <div className="bg-deep border border-border p-4 space-y-2">
            {SETUP_INSTRUCTIONS[sourceType].map((line, i) => (
              <p
                key={i}
                className={`text-xs tracking-wide ${
                  i === 0 ? "text-gold-bright label-norse text-[0.625rem] mb-2" : "text-text-dim"
                }`}
              >
                {line}
              </p>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleTestConnection}
              disabled={testing}
              className="btn-ghost"
            >
              <span>{testing ? "Testing..." : "Test Connection"}</span>
            </button>
            <button className="btn-ghost opacity-50 cursor-not-allowed">
              <span>Download Setup Guide (PDF)</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`px-3 py-2 text-xs ${
                testResult.success
                  ? "bg-success-dim border border-success/30 text-success"
                  : "bg-error-dim border border-error/30 text-error"
              }`}
            >
              {testResult.success
                ? "Connection test passed — folders are accessible"
                : `Test failed: ${testResult.error}`}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button onClick={() => setStep(0)} className="btn-ghost">
              <span>Back</span>
            </button>
            <button onClick={() => setStep(2)} className="btn-primary">
              <span>Configure Processing</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Configure Processing */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <h2 className="heading-norse text-lg mb-1">Configure Processing</h2>
            <p className="text-text-dim text-xs tracking-wide">
              How should Hermod handle files received from {sourceName}?
            </p>
          </div>

          <div>
            <label className="label-norse">Expected File Format</label>
            <select
              value={fileFormat}
              onChange={(e) => setFileFormat(e.target.value)}
              className="select-norse"
            >
              <option value="CSV">.csv (Comma Separated)</option>
              <option value="TSV">.tsv (Tab Separated)</option>
              <option value="XLSX">.xlsx (Excel)</option>
            </select>
          </div>

          <div className="bg-deep border border-border p-3">
            <span className="label-norse text-frost">Destination</span>
            <p className="text-text-dim text-xs mt-1">Load to BigQuery</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-norse">BigQuery Dataset</label>
              <input
                type="text"
                value={bqDataset}
                onChange={(e) => setBqDataset(e.target.value)}
                placeholder="e.g., payroll_data"
                className="input-norse"
              />
            </div>
            <div>
              <label className="label-norse">BigQuery Table</label>
              <input
                type="text"
                value={bqTable}
                onChange={(e) => setBqTable(e.target.value)}
                placeholder="e.g., adp_export"
                className="input-norse"
              />
            </div>
          </div>

          <div>
            <label className="label-norse">Load Mode</label>
            <select
              value={loadMode}
              onChange={(e) => setLoadMode(e.target.value)}
              className="select-norse"
            >
              <option value="REPLACE">Replace (drop and reload)</option>
              <option value="APPEND">Append (add rows)</option>
            </select>
          </div>

          <div>
            <label className="label-norse">Notification Emails</label>
            <input
              type="text"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="e.g., team@company.com, admin@company.com"
              className="input-norse"
            />
            <p className="text-text-dim text-[0.5625rem] tracking-wide mt-1">
              Comma-separated. Notified when files are processed.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={() => setStep(1)} className="btn-ghost">
              <span>Back</span>
            </button>
            <button
              onClick={handleStep3Next}
              disabled={!bqDataset.trim() || !bqTable.trim()}
              className="btn-primary"
            >
              <span>Review</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review */}
      {step === 3 && credentials && (
        <div className="space-y-5">
          <div>
            <h2 className="heading-norse text-lg mb-1">Review and Create</h2>
            <p className="text-text-dim text-xs tracking-wide">
              Confirm your {sourceName} integration setup
            </p>
          </div>

          <div className="bg-deep border border-border p-4 space-y-3">
            <ReviewRow label="Connection" value={name} />
            <ReviewRow label="Source" value={sourceName} />
            <ReviewRow label="SFTP User" value={credentials.username} />
            <ReviewRow label="File Format" value={fileFormat} />
            <ReviewRow label="Destination" value={`${bqDataset}.${bqTable}`} />
            <ReviewRow label="Load Mode" value={loadMode === "REPLACE" ? "Replace" : "Append"} />
            {emails && <ReviewRow label="Notify" value={emails} />}
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={() => setStep(2)} className="btn-ghost">
              <span>Back</span>
            </button>
            <button onClick={handleFinish} className="btn-primary">
              <span>Done</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-text-dim text-[0.625rem] tracking-widest uppercase w-28 shrink-0">
        {label}
      </span>
      <span className="text-text text-xs">{value}</span>
    </div>
  );
}
