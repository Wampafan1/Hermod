"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { SheetsUrlInput } from "@/components/file-sources/sheets-url-input";
import { SchemaDetectReview } from "@/components/file-sources/schema-detect-review";
import { SheetSelector } from "@/components/file-sources/sheet-selector";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import type { ColumnMapping } from "@/lib/alfheim/types";
import type { UCCResult } from "@/lib/ucc/discovery";

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

  // UCC discovery state
  const [uccResult, setUccResult] = useState<UCCResult | null>(null);
  const [uccLoading, setUccLoading] = useState(false);
  const [uccError, setUccError] = useState<string | null>(null);

  function handleDetected(result: unknown) {
    const det = result as DetectionResult;
    setDetection(det);
    setColumns(det.schema.columns);
    setConnectionName(det.spreadsheetName);
    setUccResult(null);
    setUccError(null);
    setStep("schema");
  }

  // Run UCC discovery async after detection
  useEffect(() => {
    if (!detection || step !== "schema") return;
    if (detection.sampleRows.length === 0) return;

    let cancelled = false;
    setUccLoading(true);
    setUccError(null);

    (async () => {
      try {
        // Sheets data comes from Google API, not a local file — send rows directly
        // TODO: For Google Sheets, consider fetching full data for UCC discovery
        const res = await fetch("/api/ucc/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: detection.sampleRows }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "UCC discovery failed" }));
          throw new Error(body.error || "UCC discovery failed");
        }
        const result = (await res.json()) as UCCResult;
        if (!cancelled) {
          setUccResult(result);
          if (result.uccs.length > 0) {
            setPkColumns(result.uccs[0].columns);
          } else {
            setWriteMode("truncate");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setUccError(err instanceof Error ? err.message : "UCC discovery failed");
        }
      } finally {
        if (!cancelled) setUccLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [detection, step]);

  const handleManualValidation = useCallback(
    async (cols: string[]): Promise<{ isUnique: boolean; duplicateGroups?: number }> => {
      if (!detection) return { isUnique: false };
      const res = await fetch("/api/ucc/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: detection.sampleRows }),
      });
      if (!res.ok) return { isUnique: false };
      const result = (await res.json()) as UCCResult;
      const isUnique = result.uccs.some(
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
        setUccResult(null); // will re-trigger discovery via useEffect
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

          {/* PK Detection — async loading */}
          {uccLoading && (
            <div className="bg-deep border border-border p-5 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-gold border-t-transparent animate-spin" />
              <span className="text-text-dim text-xs font-inconsolata tracking-wide">
                Analyzing primary keys across all rows...
              </span>
            </div>
          )}
          {uccError && (
            <div className="bg-deep border border-ember/30 p-4">
              <p className="text-ember text-xs font-inconsolata">{uccError}</p>
            </div>
          )}
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
            <button onClick={() => setStep("url")} className="btn-ghost text-xs">
              Change URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
