"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { SheetsUrlInput } from "@/components/file-sources/sheets-url-input";
import { SchemaDetectReview } from "@/components/file-sources/schema-detect-review";
import { SheetSelector } from "@/components/file-sources/sheet-selector";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import { detectPrimaryKey } from "@/lib/alfheim/pk-detector";
import type { ColumnMapping } from "@/lib/alfheim/types";

const ACCENT = "#ce93d8"; // Alfheim purple

interface DetectionResult {
  spreadsheetId: string;
  spreadsheetName: string;
  availableSheets: string[];
  sheetName: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: { columns: ColumnMapping[] };
}

type Step = "url" | "schema";

export default function SheetsNewPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("url");
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [connectionName, setConnectionName] = useState("");
  const [saving, setSaving] = useState(false);
  const [writeMode, setWriteMode] = useState<"merge" | "append" | "truncate">("merge");
  const [pkColumns, setPkColumns] = useState<string[]>([]);

  const pkDetection = useMemo(() => {
    if (!detection) return null;
    const result = detectPrimaryKey(
      detection.sampleRows,
      detection.schema.columns.map((c) => ({ name: c.jsonPath, dataType: c.dataType }))
    );
    setPkColumns(result.columns);
    if (result.confidence === "low") setWriteMode("truncate");
    return result;
  }, [detection]);

  function handleDetected(result: unknown) {
    const det = result as DetectionResult;
    setDetection(det);
    setColumns(det.schema.columns);
    setConnectionName(det.spreadsheetName);
    setStep("schema");
  }

  async function handleSheetChange(sheetName: string) {
    if (!detection) return;
    // Re-detect with different sheet
    try {
      const res = await fetch("/api/connections/sheets/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${detection.spreadsheetId}/edit`,
          sheetName,
        }),
      });
      if (res.ok) {
        const newDet = (await res.json()) as DetectionResult;
        setDetection(newDet);
        setColumns(newDet.schema.columns);
      }
    } catch {
      toast.error("Failed to re-detect schema");
    }
  }

  async function handleSave() {
    if (!detection) return;
    setSaving(true);

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connectionName,
          type: "GOOGLE_SHEETS",
          config: {
            spreadsheetId: detection.spreadsheetId,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${detection.spreadsheetId}/edit`,
            spreadsheetName: detection.spreadsheetName,
            sheetName: detection.sheetName,
            availableSheets: detection.availableSheets,
            headerRow: 1,
            dataStartRow: 2,
            pkColumns: writeMode === "merge" ? pkColumns : undefined,
            schema: { columns },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(body.error || "Failed to create connection");
        return;
      }

      toast.success("Google Sheets source created");
      router.push("/connections");
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <button
          onClick={() => (step === "url" ? router.push("/connections/new") : setStep("url"))}
          className="btn-subtle text-xs mb-3"
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-lg font-cinzel" style={{ color: ACCENT }}>
            ᚨ
          </span>
          <h1 className="heading-norse text-xl">Google Sheets</h1>
        </div>
        <div className="realm-line mt-1.5 mb-1 w-24" style={{ background: ACCENT }} />
        <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
          Connect to a spreadsheet in Alfheim
        </p>
      </div>

      {/* Step 1: URL Input */}
      {step === "url" && <SheetsUrlInput onDetected={handleDetected} />}

      {/* Step 2: Schema Review */}
      {step === "schema" && detection && (
        <div className="space-y-4">
          {/* Sheet info */}
          <div className="bg-deep border border-border p-4">
            <div className="flex gap-6 text-xs font-inconsolata text-text-dim">
              <span>Spreadsheet: <span className="text-text">{detection.spreadsheetName}</span></span>
              <span>Sheet: <span className="text-text">{detection.sheetName}</span></span>
              <span>Rows: <span className="text-text">{detection.rowCount.toLocaleString()}</span></span>
            </div>
          </div>

          {/* Sheet selector */}
          <SheetSelector
            sheets={detection.availableSheets}
            selected={detection.sheetName}
            onSelect={handleSheetChange}
            accentColor={ACCENT}
          />

          {/* Connection name */}
          <div>
            <label className="label-norse">Connection Name</label>
            <input
              type="text"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              className="input-norse"
            />
          </div>

          {/* Schema table */}
          <SchemaDetectReview
            columns={columns}
            sampleRows={detection.sampleRows}
            onChange={setColumns}
            accentColor={ACCENT}
          />

          {/* PK Detection + Write Mode */}
          {pkDetection && (
            <PKDetectionPanel
              detection={pkDetection}
              allColumns={columns.map((c) => c.jsonPath)}
              sampleRows={detection.sampleRows}
              writeMode={writeMode}
              onWriteModeChange={setWriteMode}
              onPkColumnsChange={setPkColumns}
            />
          )}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving || !connectionName.trim()} className="btn-primary text-xs">
              <span>{saving ? "Creating..." : "Create Source"}</span>
            </button>
            <button onClick={() => setStep("url")} className="btn-ghost text-xs">
              Change URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
