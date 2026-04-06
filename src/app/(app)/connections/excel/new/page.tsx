"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FileUploadStep } from "@/components/file-sources/file-upload-step";
import { SchemaDetectReview } from "@/components/file-sources/schema-detect-review";
import { SheetSelector } from "@/components/file-sources/sheet-selector";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import type { ColumnMapping } from "@/lib/alfheim/types";
import type { TableProfile } from "@/lib/duckdb/engine";
import type { AnalyzedColumn } from "@/lib/duckdb/file-analyzer";
import type { UCCResult } from "@/lib/ucc/discovery";

const ACCENT = "#81d4fa"; // Vanaheim blue

interface PrimaryKeyResult {
  detected: boolean;
  column: string | null;
  compositeKey: string[] | null;
  confidence: string;
  allKeys: Array<{
    columns: string[];
    type: "single" | "composite";
    quality: {
      columnCount: number;
      totalNullCount: number;
      hasIdPattern: boolean;
      allColumnsNotNull: boolean;
    };
  }>;
  nearMisses: Array<{
    columns: string[];
    uniquenessRatio: number;
    duplicateCount: number;
  }>;
  stats: {
    totalRows: number;
    candidateColumns: number;
    levelsSearched: number;
    queriesExecuted: number;
    durationMs: number;
    timedOut: boolean;
  };
}

interface DetectionResult {
  fileId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  availableSheets?: string[];
  sheetName?: string;
  selectedSheet?: string;
  headerRow: number;
  dataStartRow: number;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  previewRows?: Record<string, unknown>[];
  schema: { columns: ColumnMapping[] };
  profile?: TableProfile;
  analyzedColumns?: AnalyzedColumn[];
  columns?: AnalyzedColumn[];
  primaryKey?: PrimaryKeyResult;
}

type Step = "upload" | "schema";

/** Convert the unified primaryKey response into a UCCResult for PKDetectionPanel */
function primaryKeyToUCCResult(pk: PrimaryKeyResult): UCCResult {
  return {
    uccs: pk.allKeys.map((k) => ({
      columns: k.columns,
      type: k.type,
      verified: true as const,
      rowCount: pk.stats.totalRows,
      quality: k.quality,
    })),
    noKeyExists: !pk.detected && pk.nearMisses.length === 0,
    analyzedColumns: [],
    excludedColumns: [],
    stats: {
      totalRows: pk.stats.totalRows,
      totalColumns: 0,
      candidateColumns: pk.stats.candidateColumns,
      levelsSearched: pk.stats.levelsSearched,
      queriesExecuted: pk.stats.queriesExecuted,
      totalDurationMs: pk.stats.durationMs,
      pruningDurationMs: 0,
      discoveryDurationMs: pk.stats.durationMs,
      timedOut: pk.stats.timedOut,
    },
  };
}

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
  const [profileData, setProfileData] = useState<TableProfile | null>(null);
  const [analyzedColumns, setAnalyzedColumns] = useState<AnalyzedColumn[] | null>(null);

  // UCC result — now comes directly from detect response
  const [uccResult, setUccResult] = useState<UCCResult | null>(null);

  function handleUploaded(result: unknown) {
    const det = result as DetectionResult;
    setDetection(det);
    setColumns(det.schema.columns);
    setConnectionName(det.originalFilename.replace(/\.(xlsx|xls)$/i, ""));
    if (det.profile) setProfileData(det.profile);
    const cols = det.analyzedColumns ?? det.columns;
    if (cols) setAnalyzedColumns(cols);

    // PK now comes from the detect response directly — no separate API call
    if (det.primaryKey) {
      const uccCompat = primaryKeyToUCCResult(det.primaryKey);
      setUccResult(uccCompat);
      if (det.primaryKey.detected) {
        const bestCols = det.primaryKey.column
          ? [det.primaryKey.column]
          : det.primaryKey.compositeKey ?? [];
        setPkColumns(bestCols);
      } else {
        setWriteMode("truncate");
      }
    } else {
      setUccResult(null);
      setWriteMode("truncate");
    }

    setStep("schema");
  }

  const handleManualValidation = useCallback(
    async (cols: string[]): Promise<{ isUnique: boolean; duplicateGroups?: number }> => {
      if (!detection) return { isUnique: false };
      const res = await fetch("/api/ucc/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: detection.filePath,
          fileType: "excel",
        }),
      });
      if (!res.ok) return { isUnique: false };
      const uccRes = (await res.json()) as UCCResult;
      const isUnique = uccRes.uccs.some(
        (ucc) =>
          ucc.columns.length === cols.length &&
          cols.every((c) => ucc.columns.includes(c))
      );
      return { isUnique, duplicateGroups: isUnique ? 0 : undefined };
    },
    [detection]
  );

  async function handleSheetChange(sheetName: string) {
    if (!detection) return;
    setRedetecting(true);
    try {
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
            sheetName: detection.sheetName ?? detection.selectedSheet,
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
              <span>Sheet: <span className="text-text">{detection.sheetName ?? detection.selectedSheet}</span></span>
            </div>
          </div>

          {/* Sheet selector */}
          {detection.availableSheets && (
            <SheetSelector
              sheets={detection.availableSheets}
              selected={detection.sheetName ?? detection.selectedSheet ?? ""}
              onSelect={handleSheetChange}
              accentColor={ACCENT}
            />
          )}

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
              sampleRows={detection.sampleRows ?? detection.previewRows ?? []}
              onChange={setColumns}
              accentColor={ACCENT}
            />
          )}

          {/* PK Detection — now inline from detect response */}
          {uccResult && (
            <PKDetectionPanel
              result={uccResult}
              allColumns={columns.map((c) => c.jsonPath)}
              writeMode={writeMode}
              onWriteModeChange={setWriteMode}
              onPkColumnsChange={setPkColumns}
              onManualValidationRequest={handleManualValidation}
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
