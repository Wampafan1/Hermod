"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FileUploadStep } from "@/components/file-sources/file-upload-step";
import { SchemaDetectReview } from "@/components/file-sources/schema-detect-review";
import { SheetSelector } from "@/components/file-sources/sheet-selector";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import { detectPrimaryKey } from "@/lib/alfheim/pk-detector";
import type { ColumnMapping } from "@/lib/alfheim/types";

const ACCENT = "#81d4fa"; // Vanaheim blue

interface DetectionResult {
  fileId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  availableSheets: string[];
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: { columns: ColumnMapping[] };
}

type Step = "upload" | "schema";

export default function ExcelNewPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("upload");
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [connectionName, setConnectionName] = useState("");
  const [saving, setSaving] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
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

  function handleUploaded(result: unknown) {
    const det = result as DetectionResult;
    setDetection(det);
    setColumns(det.schema.columns);
    setConnectionName(det.originalFilename.replace(/\.(xlsx|xls)$/i, ""));
    setStep("schema");
  }

  async function handleSheetChange(sheetName: string) {
    if (!detection) return;
    setRedetecting(true);

    try {
      const formData = new FormData();
      // Re-detect with the same file but different sheet
      const res = await fetch("/api/connections/excel/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: detection.filePath,
          sheetName,
        }),
      });

      // For re-detection with an already uploaded file, we need to re-upload
      // For now, just update the selected sheet name in detection
      // The full re-detection would need a separate endpoint
      setDetection({ ...detection, sheetName });
    } finally {
      setRedetecting(false);
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
          type: "EXCEL_FILE",
          config: {
            filePath: detection.filePath,
            originalFilename: detection.originalFilename,
            sheetName: detection.sheetName,
            availableSheets: detection.availableSheets,
            headerRow: detection.headerRow,
            dataStartRow: detection.dataStartRow,
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

      toast.success("Excel source created");
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
          onClick={() => (step === "upload" ? router.push("/connections/new") : setStep("upload"))}
          className="btn-subtle text-xs mb-3"
        >
          &larr; Back
        </button>
        <div className="flex items-center gap-3">
          <span className="text-lg font-cinzel" style={{ color: ACCENT }}>
            ᚹ
          </span>
          <h1 className="heading-norse text-xl">Excel Source</h1>
        </div>
        <div className="realm-line mt-1.5 mb-1 w-24" style={{ background: ACCENT }} />
        <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
          Upload an Excel workbook from Vanaheim
        </p>
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <FileUploadStep
          accept=".xlsx,.xls"
          acceptLabel="Accepts .xlsx and .xls files up to 100MB"
          accentColor={ACCENT}
          realmRune="ᚹ"
          onUploaded={handleUploaded}
          detectEndpoint="/api/connections/excel/detect"
        />
      )}

      {/* Step 2: Sheet + Schema Review */}
      {step === "schema" && detection && (
        <div className="space-y-4">
          {/* File info */}
          <div className="bg-deep border border-border p-4">
            <div className="flex gap-6 text-xs font-inconsolata text-text-dim">
              <span>File: <span className="text-text">{detection.originalFilename}</span></span>
              <span>Rows: <span className="text-text">{detection.rowCount.toLocaleString()}</span></span>
              <span>Sheet: <span className="text-text">{detection.sheetName}</span></span>
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
          {!redetecting && (
            <SchemaDetectReview
              columns={columns}
              sampleRows={detection.sampleRows}
              onChange={setColumns}
              accentColor={ACCENT}
            />
          )}

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
            <button onClick={() => setStep("upload")} className="btn-ghost text-xs">
              Re-upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
