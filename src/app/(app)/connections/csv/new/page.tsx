"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { FileUploadStep } from "@/components/file-sources/file-upload-step";
import { SchemaDetectReview } from "@/components/file-sources/schema-detect-review";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import { detectPrimaryKey } from "@/lib/alfheim/pk-detector";
import type { ColumnMapping } from "@/lib/alfheim/types";

const ACCENT = "#a1887f"; // Jotunheim brown

interface DetectionResult {
  fileId: string;
  filePath: string;
  originalFilename: string;
  fileSize: number;
  delimiter: string;
  hasHeaders: boolean;
  encoding: string;
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  schema: { columns: ColumnMapping[] };
}

type WriteMode = "merge" | "append" | "truncate";
type Step = "upload" | "schema";

export default function CsvNewPage() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>("upload");
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [columns, setColumns] = useState<ColumnMapping[]>([]);
  const [connectionName, setConnectionName] = useState("");
  const [writeMode, setWriteMode] = useState<WriteMode>("merge");
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const pkDetection = useMemo(() => {
    if (!detection) return null;
    const result = detectPrimaryKey(
      detection.sampleRows,
      detection.schema.columns.map((c) => ({ name: c.jsonPath, dataType: c.dataType }))
    );
    setPkColumns(result.columns);
    // Default write mode based on confidence
    if (result.confidence === "low") setWriteMode("truncate");
    return result;
  }, [detection]);

  function handleUploaded(result: unknown) {
    const det = result as DetectionResult;
    setDetection(det);
    setColumns(det.schema.columns);
    setConnectionName(det.originalFilename.replace(/\.(csv|tsv|txt)$/i, ""));
    setStep("schema");
  }

  async function handleSave() {
    if (!detection) return;
    setSaving(true);

    const isComposite = pkColumns.length > 1;
    const effectiveColumns = isComposite && writeMode === "merge"
      ? [
          ...columns,
          {
            jsonPath: "__hermod_pk",
            columnName: "__hermod_pk",
            dataType: "STRING" as const,
            nullable: false,
          },
        ]
      : columns;

    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: connectionName,
          type: "CSV_FILE",
          config: {
            filePath: detection.filePath,
            originalFilename: detection.originalFilename,
            delimiter: detection.delimiter,
            hasHeaders: detection.hasHeaders,
            encoding: detection.encoding,
            skipRows: 0,
            pkColumns: writeMode === "merge" ? pkColumns : undefined,
            schema: { columns: effectiveColumns },
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(body.error || "Failed to create connection");
        return;
      }

      toast.success("CSV source created");
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
          <span className="text-lg font-cinzel" style={{ color: ACCENT }}>ᛃ</span>
          <h1 className="heading-norse text-xl">CSV Source</h1>
        </div>
        <div className="realm-line mt-1.5 mb-1 w-24" style={{ background: ACCENT }} />
        <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
          Upload a CSV, TSV, or text file from Jotunheim
        </p>
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <FileUploadStep
          accept=".csv,.tsv,.txt"
          acceptLabel="Accepts .csv, .tsv, .txt files up to 100MB"
          accentColor={ACCENT}
          realmRune="ᛃ"
          onUploaded={handleUploaded}
          detectEndpoint="/api/connections/csv/detect"
        />
      )}

      {/* Step 2: Schema + PK Review */}
      {step === "schema" && detection && (
        <div className="space-y-4">
          {/* File info */}
          <div className="bg-deep border border-border p-4">
            <div className="flex gap-6 text-xs font-inconsolata text-text-dim">
              <span>File: <span className="text-text">{detection.originalFilename}</span></span>
              <span>Rows: <span className="text-text">{detection.rowCount.toLocaleString()}</span></span>
              <span>Delimiter: <span className="text-text">{detection.delimiter === "\t" ? "TAB" : `"${detection.delimiter}"`}</span></span>
              <span>Headers: <span className="text-text">{detection.hasHeaders ? "Yes" : "No"}</span></span>
            </div>
          </div>

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
            <button onClick={() => setStep("upload")} className="btn-ghost text-xs">
              Re-upload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
