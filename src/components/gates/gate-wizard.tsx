"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { PKDetectionPanel } from "@/components/file-sources/pk-detection-panel";
import type { UCCResult } from "@/lib/ucc/discovery";

// ─── Types ──────────────────────────────────────────

interface ProfileColumn {
  name: string;
  type: string;
  hermodType: string;
  nullable: boolean;
  uniqueCount: number;
  nullCount: number;
  sampleValues: unknown[];
}

interface ColumnMatchItem {
  sourceColumn: string;
  sourceType: string;
  destinationColumn: string;
  destType: string;
  matchType: string;
}

interface DestMatch {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  schema: string;
  table: string;
  matchedColumns: number;
  totalSourceColumns: number;
  totalDestColumns: number;
  matchScore: number;
  columnMatches: ColumnMatchItem[];
}

interface DestConnection {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  databaseType: string;
}

interface NearMiss {
  columns: string[];
  uniquenessRatio: number;
  duplicateCount: number;
}

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
  nearMisses: NearMiss[];
  stats: {
    totalRows: number;
    candidateColumns: number;
    levelsSearched: number;
    queriesExecuted: number;
    durationMs: number;
    timedOut: boolean;
  };
}

interface ProfileResult {
  fileName: string;
  fileSize: number;
  realmType: string;
  rowCount: number;
  columns: ProfileColumn[];
  primaryKey: PrimaryKeyResult;
  destinationMatches: DestMatch[];
  allConnections: DestConnection[];
  tempFileId: string;
  previewRows?: Record<string, unknown>[];
}

interface MappingRow {
  sourceColumn: string;
  destinationColumn: string | null;
  sourceType: string;
  destType: string | null;
  matchType: string;
}

interface TableInfo {
  schema: string;
  table: string;
  fullName: string;
  columns: Array<{ name: string; type: string }>;
}

// ─── Helpers ────────────────────────────────────────

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

function writeModeToMergeStrategy(mode: "merge" | "append" | "truncate"): string {
  switch (mode) {
    case "merge": return "UPSERT";
    case "append": return "APPEND";
    case "truncate": return "TRUNCATE_RELOAD";
  }
}

// ─── Step Indicator ─────────────────────────────────

const STEPS = ["Drop", "Map", "Seal"] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((label, idx) => {
        const isComplete = idx < current;
        const isActive = idx === current;
        return (
          <div key={label} className="flex items-center">
            {idx > 0 && (
              <div
                className={`w-16 h-px ${isComplete ? "bg-gold" : "bg-[rgba(201,147,58,0.15)]"}`}
              />
            )}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-7 h-7 flex items-center justify-center text-xs border transition-colors ${
                  isComplete
                    ? "bg-gold/20 border-gold text-gold"
                    : isActive
                      ? "bg-frost/10 border-frost text-frost"
                      : "border-[rgba(201,147,58,0.15)] text-text-dim"
                }`}
              >
                {isComplete ? "\u2713" : idx + 1}
              </div>
              <span
                className={`text-[9px] uppercase tracking-[0.3em] font-space-grotesk ${
                  isActive ? "text-frost" : isComplete ? "text-gold" : "text-text-dim"
                }`}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Realm Badge ────────────────────────────────────

function RealmBadge({ type }: { type: string }) {
  const isVanaheim = type === "VANAHEIM";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-space-grotesk px-2 py-0.5 border"
      style={{
        color: isVanaheim ? "#7eb8d4" : "#a1887f",
        borderColor: isVanaheim ? "rgba(126,184,212,0.3)" : "rgba(161,136,127,0.3)",
        background: isVanaheim ? "rgba(126,184,212,0.06)" : "rgba(161,136,127,0.06)",
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: isVanaheim ? "#7eb8d4" : "#a1887f" }}
      />
      {isVanaheim ? "Vanaheim" : "Jotunheim"}
    </span>
  );
}

// ─── Column matching (client-side) ──────────────────

function normalizeColName(s: string): string {
  return s.toLowerCase().replace(/[_\-\s]/g, "");
}

function computeColumnMapping(
  sourceColumns: ProfileColumn[],
  destColumns: Array<{ name: string; type: string }>
): MappingRow[] {
  const mapping: MappingRow[] = [];
  const usedDest = new Set<string>();

  for (const src of sourceColumns) {
    let match: { name: string; type: string } | undefined;
    let matchType = "none";

    // Exact
    match = destColumns.find((d) => d.name === src.name && !usedDest.has(d.name));
    if (match) matchType = "exact";

    // Case-insensitive
    if (!match) {
      match = destColumns.find(
        (d) => d.name.toLowerCase() === src.name.toLowerCase() && !usedDest.has(d.name)
      );
      if (match) matchType = "case_insensitive";
    }

    // Normalized (strip _, -, spaces)
    if (!match) {
      match = destColumns.find(
        (d) => normalizeColName(d.name) === normalizeColName(src.name) && !usedDest.has(d.name)
      );
      if (match) matchType = "normalized";
    }

    if (match) {
      usedDest.add(match.name);
      mapping.push({
        sourceColumn: src.name,
        destinationColumn: match.name,
        sourceType: src.hermodType,
        destType: match.type,
        matchType,
      });
    } else {
      mapping.push({
        sourceColumn: src.name,
        destinationColumn: null,
        sourceType: src.hermodType,
        destType: null,
        matchType: "none",
      });
    }
  }

  return mapping;
}

// ─── Main Component ─────────────────────────────────

export function GateWizard() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);

  // Step 1 state
  const [profiling, setProfiling] = useState(false);
  const [profile, setProfile] = useState<ProfileResult | null>(null);

  // Step 2 state
  const [gateName, setGateName] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedTable, setSelectedTable] = useState(""); // "schema.table" composite key or "__CREATE_NEW__"
  const [newTableName, setNewTableName] = useState("");
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  const [writeMode, setWriteMode] = useState<"merge" | "append" | "truncate">("merge");
  const [uccResult, setUccResult] = useState<UCCResult | null>(null);
  const [columnMapping, setColumnMapping] = useState<MappingRow[]>([]);
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [forgeEnabled, setForgeEnabled] = useState(false);
  const [sealing, setSealing] = useState(false);

  // On-demand table loading
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  // Step 3 state
  const [createdGateId, setCreatedGateId] = useState<string | null>(null);
  const [initialPushResult, setInitialPushResult] = useState<{ status: string; rowCount?: number; rowsInserted?: number; rowsUpdated?: number; error?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Step 1: Drop ──────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      if (profiling) return;

      const MAX_SIZE = 20 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        toast.error("File too large. Maximum size is 20MB.");
        return;
      }
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!ext || !["xlsx", "xls", "csv", "tsv"].includes(ext)) {
        toast.error("Unsupported file type. Accepted: .xlsx, .csv, .tsv");
        return;
      }

      setProfiling(true);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch("/api/gates/profile", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Profile failed" }));
          toast.error(data.error || "Failed to profile file");
          return;
        }

        const result: ProfileResult = await res.json();
        setProfile(result);

        // Auto-fill gate name from file name
        setGateName(
          file.name
            .replace(/\.(xlsx|csv|tsv)$/i, "")
            .replace(/[_-]/g, " ")
            .trim()
        );

        // Build UCC result for PKDetectionPanel
        if (result.primaryKey) {
          const uccCompat = primaryKeyToUCCResult(result.primaryKey);
          setUccResult(uccCompat);

          // Auto-select best key
          if (result.primaryKey.detected) {
            const bestCols = result.primaryKey.column
              ? [result.primaryKey.column]
              : result.primaryKey.compositeKey ?? [];
            setPkColumns(bestCols);
            setWriteMode("merge");
          } else {
            setPkColumns([]);
            setWriteMode("truncate");
          }
        } else {
          setUccResult(null);
          setPkColumns([]);
          setWriteMode("truncate");
        }

        // Auto-select best destination connection (from matches, or first available)
        const bestMatch = result.destinationMatches?.[0];
        const defaultConnId =
          bestMatch?.connectionId ?? result.allConnections?.[0]?.connectionId ?? "";
        setSelectedConnectionId(defaultConnId);

        // If best match exists, pre-select its table and mapping
        if (bestMatch) {
          setSelectedTable(`${bestMatch.schema}.${bestMatch.table}`);
          setColumnMapping(
            bestMatch.columnMatches.map((m) => ({
              sourceColumn: m.sourceColumn,
              destinationColumn: m.destinationColumn,
              sourceType: m.sourceType,
              destType: m.destType,
              matchType: m.matchType,
            }))
          );
        } else {
          setSelectedTable("");
          setColumnMapping([]);
        }

        setStep(1);
      } catch {
        toast.error("Network error during profiling");
      } finally {
        setProfiling(false);
      }
    },
    [profiling, toast]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // ── Step 2: Map ───────────────────────────────────

  // Fetch tables when connection changes
  useEffect(() => {
    if (!selectedConnectionId) {
      setTables([]);
      return;
    }

    let cancelled = false;
    setLoadingTables(true);

    fetch(`/api/gates/tables?connectionId=${selectedConnectionId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load tables");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setTables(data.tables ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
          toast.error("Failed to load tables for this connection");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTables(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedConnectionId, toast]);

  // Re-compute column mapping when table selection changes
  useEffect(() => {
    if (!selectedTable || !profile) return;

    const selectedTableInfo = tables.find((t) => `${t.schema}.${t.table}` === selectedTable);
    if (!selectedTableInfo) return;

    // Check if we have a pre-computed match for this exact table
    const preMatch = profile.destinationMatches.find(
      (m) =>
        m.connectionId === selectedConnectionId &&
        `${m.schema}.${m.table}` === selectedTable
    );

    if (preMatch) {
      // Use the server-computed mapping (higher quality)
      const mapped: MappingRow[] = preMatch.columnMatches.map((m) => ({
        sourceColumn: m.sourceColumn,
        destinationColumn: m.destinationColumn,
        sourceType: m.sourceType,
        destType: m.destType,
        matchType: m.matchType,
      }));
      // Add unmapped source columns
      const mappedSources = new Set(mapped.map((m) => m.sourceColumn));
      for (const col of profile.columns) {
        if (!mappedSources.has(col.name)) {
          mapped.push({
            sourceColumn: col.name,
            destinationColumn: null,
            sourceType: col.hermodType,
            destType: null,
            matchType: "none",
          });
        }
      }
      setColumnMapping(mapped);
    } else {
      // Client-side matching
      setColumnMapping(computeColumnMapping(profile.columns, selectedTableInfo.columns));
    }
  }, [selectedTable, tables, selectedConnectionId, profile]);

  // Connection change handler
  const handleConnectionChange = useCallback(
    (connId: string) => {
      setSelectedConnectionId(connId);
      setSelectedTable("");
      setColumnMapping([]);
    },
    []
  );

  // Table dropdown options — sorted with matches first
  const tableOptions = useMemo(() => {
    if (!profile) return [];

    return tables
      .map((t) => {
        const key = `${t.schema}.${t.table}`;
        const match = profile.destinationMatches.find(
          (m) =>
            m.connectionId === selectedConnectionId &&
            m.schema === t.schema &&
            m.table === t.table
        );
        return {
          value: key,
          label: match
            ? `${t.schema}.${t.table} \u2014 matched ${match.matchedColumns}/${match.totalSourceColumns} columns`
            : `${t.schema}.${t.table}`,
          matchScore: match?.matchScore ?? 0,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore || a.label.localeCompare(b.label));
  }, [tables, profile, selectedConnectionId]);

  // Visible columns for schema display
  const visibleColumns = useMemo(() => {
    if (!profile) return [];
    return showAllColumns ? profile.columns : profile.columns.slice(0, 6);
  }, [profile, showAllColumns]);

  // Mapped columns (non-null destinations) for seal check
  const mappedColumns = useMemo(
    () => columnMapping.filter((m) => m.destinationColumn !== null),
    [columnMapping]
  );

  // Seal validation
  const needsPK = writeMode === "merge";
  const isCreatingTable = selectedTable === "__CREATE_NEW__";
  const canSeal =
    gateName.trim() &&
    selectedConnectionId &&
    (isCreatingTable ? newTableName.trim() : selectedTable) &&
    (isCreatingTable || mappedColumns.length > 0) &&
    (!needsPK || pkColumns.length > 0);

  // Unmapped column destination dropdown handler
  const handleUnmappedDestChange = useCallback(
    (sourceColumn: string, destColumn: string) => {
      setColumnMapping((prev) =>
        prev.map((m) => {
          if (m.sourceColumn !== sourceColumn) return m;
          if (!destColumn) {
            return { ...m, destinationColumn: null, destType: null, matchType: "none" };
          }
          const selectedTableInfo = tables.find(
            (t) => `${t.schema}.${t.table}` === selectedTable
          );
          const destCol = selectedTableInfo?.columns.find((c) => c.name === destColumn);
          return {
            ...m,
            destinationColumn: destColumn,
            destType: destCol?.type ?? null,
            matchType: "manual",
          };
        })
      );
    },
    [tables, selectedTable]
  );

  // Destination columns not yet used in mapping (for unmapped dropdowns)
  const availableDestColumns = useMemo(() => {
    const selectedTableInfo = tables.find(
      (t) => `${t.schema}.${t.table}` === selectedTable
    );
    if (!selectedTableInfo) return [];

    const usedDest = new Set(
      columnMapping.filter((m) => m.destinationColumn).map((m) => m.destinationColumn)
    );
    return selectedTableInfo.columns.filter((c) => !usedDest.has(c.name));
  }, [tables, selectedTable, columnMapping]);

  // Parse schema/table from composite key
  const selectedConn = profile?.allConnections.find((c) => c.connectionId === selectedConnectionId);
  const defaultSchema = selectedConn?.databaseType === "SQLSERVER" ? "dbo" : selectedConn?.databaseType === "POSTGRESQL" ? "public" : "";
  const selectedSchema = selectedTable === "__CREATE_NEW__"
    ? defaultSchema
    : selectedTable.includes(".")
      ? selectedTable.split(".")[0]
      : defaultSchema;
  const selectedTableName = selectedTable === "__CREATE_NEW__"
    ? newTableName.trim()
    : selectedTable.includes(".")
      ? selectedTable.split(".").slice(1).join(".")
      : selectedTable;

  // Manual validation handler for PKDetectionPanel
  const handleManualValidation = useCallback(
    async (cols: string[]): Promise<{ isUnique: boolean; duplicateGroups?: number }> => {
      if (!profile) return { isUnique: false };
      try {
        const res = await fetch("/api/ucc/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tempFileId: profile.tempFileId,
            columns: cols,
          }),
        });
        if (!res.ok) return { isUnique: false };
        const uccRes = await res.json();
        const isUnique = uccRes.uccs?.some(
          (ucc: { columns: string[] }) =>
            ucc.columns.length === cols.length &&
            cols.every((c: string) => ucc.columns.includes(c))
        ) ?? false;
        return { isUnique };
      } catch {
        return { isUnique: false };
      }
    },
    [profile]
  );

  const handleSeal = useCallback(async () => {
    if (!profile || !canSeal) return;
    setSealing(true);

    try {
      const res = await fetch("/api/gates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: gateName.trim(),
          tempFileId: profile.tempFileId,
          realmType: profile.realmType,
          connectionId: selectedConnectionId,
          targetTable: isCreatingTable ? newTableName.trim() : selectedTableName,
          targetSchema: selectedSchema || null,
          createTable: isCreatingTable || undefined,
          primaryKeyColumns: pkColumns,
          mergeStrategy: writeModeToMergeStrategy(writeMode),
          columnMapping: isCreatingTable
            ? profile.columns.map((c) => ({
                sourceColumn: c.name,
                destinationColumn: c.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                sourceType: c.duckdbType ?? c.type,
                destType: null,
              }))
            : mappedColumns.map((m) => ({
                sourceColumn: m.sourceColumn,
                destinationColumn: m.destinationColumn,
                sourceType: m.sourceType,
                destType: m.destType,
              })),
          forgeEnabled,
          forgeBlueprintId: null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(data.error || "Failed to create gate");
        return;
      }

      const gate = await res.json();
      setCreatedGateId(gate.id);
      setInitialPushResult(gate.initialPush ?? null);
      setStep(2);
      if (gate.initialPush?.status === "SUCCESS") {
        toast.success(`Gate sealed — ${gate.initialPush.rowCount?.toLocaleString() ?? 0} rows pushed`);
      } else if (gate.initialPush?.status === "FAILED") {
        toast.success("Gate sealed");
        toast.error(`Initial push failed: ${gate.initialPush.error ?? "Unknown error"}`);
      } else {
        toast.success("Gate sealed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSealing(false);
    }
  }, [
    profile,
    canSeal,
    gateName,
    selectedConnectionId,
    selectedTableName,
    selectedSchema,
    pkColumns,
    writeMode,
    mappedColumns,
    forgeEnabled,
    toast,
  ]);

  // ── Render ────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      <StepIndicator current={step} />

      {/* Step 1: Drop */}
      {step === 0 && (
        <div>
          <h1 className="heading-norse text-lg text-center mb-2">Open a Realm Gate</h1>
          <p className="text-text-dim text-xs text-center tracking-wide mb-8">
            Drop a file to begin. Hermod will profile it and find the best destination.
          </p>

          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center py-20 ${
              profiling
                ? "border-frost/30 bg-frost/[0.02]"
                : "border-[rgba(201,147,58,0.2)] hover:border-gold/40 hover:bg-gold/[0.02]"
            }`}
          >
            {profiling ? (
              <>
                <span className="spinner-norse mb-3" style={{ width: 24, height: 24 }} />
                <span className="text-text-dim text-xs tracking-widest uppercase">
                  Profiling your file...
                </span>
              </>
            ) : (
              <>
                <span className="text-3xl text-text-dim mb-3">{"\u16C9"}</span>
                <span className="text-text text-sm tracking-wide">
                  Drop a file here or click to browse
                </span>
                <span className="text-text-dim text-[10px] tracking-wide mt-2">
                  .xlsx, .csv, .tsv — up to 20MB
                </span>
                <div className="flex gap-4 mt-4 text-[9px] uppercase tracking-[0.25em] text-text-dim">
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-frost" />
                    Excel = Vanaheim
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#a1887f" }} />
                    CSV/TSV = Jotunheim
                  </span>
                </div>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv,.tsv"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>
      )}

      {/* Step 2: Map */}
      {step === 1 && profile && (
        <div>
          <h1 className="heading-norse text-lg mb-6">Configure Gate</h1>

          <div className="grid grid-cols-2 gap-6">
            {/* Left column: Detected Schema */}
            <div className="space-y-4">
              <div className="card-norse p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <RealmBadge type={profile.realmType} />
                  <span className="text-text text-xs font-inconsolata truncate">
                    {profile.fileName}
                  </span>
                </div>
                <div className="text-text-dim text-[10px] tracking-wide">
                  {profile.rowCount.toLocaleString()} rows · {profile.columns.length} columns
                </div>

                <div className="space-y-1">
                  {visibleColumns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-2 py-1 px-2 text-xs border-b border-[rgba(201,147,58,0.06)] last:border-0"
                    >
                      <span className="font-inconsolata text-text flex-1 truncate">{col.name}</span>
                      <span className="badge-neutral text-[9px]">{col.hermodType}</span>
                      {pkColumns.includes(col.name) && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-gold/10 text-gold border border-gold/20 font-space-grotesk">
                          PK
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {profile.columns.length > 6 && !showAllColumns && (
                  <button
                    onClick={() => setShowAllColumns(true)}
                    className="text-frost text-[10px] tracking-wide hover:underline"
                  >
                    +{profile.columns.length - 6} more columns
                  </button>
                )}
              </div>
            </div>

            {/* Right column: Destination Config */}
            <div className="space-y-4">
              {/* Gate Name */}
              <div>
                <label className="label-norse">Gate Name</label>
                <input
                  type="text"
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  placeholder="e.g. Acme customer sync"
                  className="input-norse"
                />
              </div>

              {/* Destination Connection */}
              <div>
                <label className="label-norse">Destination Connection</label>
                {profile.allConnections.length === 0 ? (
                  <p className="text-text-dim text-xs">
                    No destination connections found. Create a database connection first.
                  </p>
                ) : (
                  <select
                    value={selectedConnectionId}
                    onChange={(e) => handleConnectionChange(e.target.value)}
                    className="select-norse"
                  >
                    <option value="">Select connection...</option>
                    {profile.allConnections.map((c) => {
                      const bestScore = profile.destinationMatches
                        .filter((m) => m.connectionId === c.connectionId)
                        .reduce((max, m) => Math.max(max, m.matchedColumns), 0);

                      return (
                        <option key={c.connectionId} value={c.connectionId}>
                          {c.connectionName} ({c.databaseType})
                          {bestScore > 0
                            ? ` \u2014 ${bestScore} column match${bestScore !== 1 ? "es" : ""}`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              {/* Target Table */}
              {selectedConnectionId && (
                <div>
                  <label className="label-norse">Target Table</label>
                  {loadingTables ? (
                    <div className="flex items-center gap-2 py-2 text-text-dim text-xs">
                      <span className="spinner-norse" style={{ width: 14, height: 14 }} />
                      <span className="tracking-wide">Loading tables...</span>
                    </div>
                  ) : (
                    <>
                      {tables.length > 0 ? (
                        <select
                          value={selectedTable}
                          onChange={(e) => {
                            setSelectedTable(e.target.value);
                            if (e.target.value === "__CREATE_NEW__") {
                              setNewTableName("");
                            }
                          }}
                          className="select-norse"
                        >
                          <option value="">Select table...</option>
                          {tableOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                          <option value="__CREATE_NEW__">+ Create new table from schema</option>
                        </select>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-text-dim text-xs">No tables found. Create one from the profiled schema:</p>
                          {selectedTable !== "__CREATE_NEW__" && (
                            <button
                              type="button"
                              onClick={() => { setSelectedTable("__CREATE_NEW__"); setNewTableName(""); }}
                              className="btn-ghost text-xs"
                            >
                              + Create new table
                            </button>
                          )}
                        </div>
                      )}
                      {selectedTable === "__CREATE_NEW__" && (
                        <div className="mt-2 space-y-2">
                          <label className="label-norse text-[10px]">New Table Name</label>
                          <input
                            type="text"
                            value={newTableName}
                            onChange={(e) => setNewTableName(e.target.value.replace(/[^a-zA-Z0-9_]/g, "_"))}
                            placeholder="e.g. barnes_inbound_containers"
                            className="input-norse"
                          />
                          {newTableName && (
                            <p className="text-text-dim text-[10px] font-inconsolata">
                              Will create: {selectedSchema || "dbo"}.{newTableName} with {profile.columns.length} columns
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Primary Key & Write Mode — PKDetectionPanel */}
              {uccResult && (
                <PKDetectionPanel
                  result={uccResult}
                  writeMode={writeMode}
                  onWriteModeChange={setWriteMode}
                  onPkColumnsChange={setPkColumns}
                  allColumns={profile.columns.map((c) => c.name)}
                  onManualValidationRequest={handleManualValidation}
                />
              )}
              {!uccResult && (
                <div className="bg-void border border-border p-4">
                  <p className="text-xs text-text-dim">
                    No key analysis available. Use Truncate or Append mode.
                  </p>
                  <div className="flex gap-2 mt-3">
                    {(
                      [
                        { value: "append" as const, label: "Append" },
                        { value: "truncate" as const, label: "Truncate + Reload" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setWriteMode(opt.value)}
                        className={`flex-1 px-2 py-2 text-[0.6rem] tracking-wider uppercase border transition-colors ${
                          writeMode === opt.value
                            ? "bg-gold/10 border-gold/40 text-gold"
                            : "border-[rgba(201,147,58,0.1)] text-text-dim hover:border-gold/20"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Forge */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forgeEnabled}
                    onChange={(e) => setForgeEnabled(e.target.checked)}
                    className="accent-gold"
                  />
                  <span className="text-text-dim text-xs tracking-wide">Route through the Forge</span>
                </label>
                {forgeEnabled && (
                  <p className="text-text-dim text-[10px] mt-1.5 pl-5">
                    Forge blueprints can be created in{" "}
                    <a href="/mjolnir" className="text-gold hover:underline">Mjolnir</a>.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* New Table Schema Preview */}
          {selectedTable === "__CREATE_NEW__" && newTableName && (
            <details className="mt-6" open>
              <summary className="label-norse cursor-pointer select-none">
                New Table Schema ({profile.columns.length} columns)
              </summary>
              <div className="mt-2 border border-[rgba(201,147,58,0.1)]">
                <div className="grid grid-cols-[1fr_1fr] gap-0 text-[9px] uppercase tracking-[0.2em] text-text-dim bg-void/50 px-3 py-2 border-b border-[rgba(201,147,58,0.1)]">
                  <span>Source Column</span>
                  <span>Destination Column</span>
                </div>
                {profile.columns.map((col) => (
                  <div
                    key={col.name}
                    className="grid grid-cols-[1fr_1fr] gap-0 px-3 py-1.5 text-xs font-inconsolata border-b border-[rgba(201,147,58,0.04)] last:border-0"
                  >
                    <span className="text-text">{col.name}</span>
                    <span className="text-text-dim">
                      {col.name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}
                      <span className="text-text-muted ml-2 text-[10px]">{col.duckdbType ?? col.type}</span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Column Mapping */}
          {selectedTable && selectedTable !== "__CREATE_NEW__" && columnMapping.length > 0 && (
            <details className="mt-6" open={mappedColumns.length < profile.columns.length}>
              <summary className="label-norse cursor-pointer select-none">
                Column Mapping ({mappedColumns.length}/{profile.columns.length} mapped)
              </summary>
              <div className="mt-2 border border-[rgba(201,147,58,0.1)]">
                <div className="grid grid-cols-[1fr_1fr_80px] gap-0 text-[9px] uppercase tracking-[0.2em] text-text-dim bg-void/50 px-3 py-2 border-b border-[rgba(201,147,58,0.1)]">
                  <span>Source Column</span>
                  <span>Destination Column</span>
                  <span>Match</span>
                </div>
                {columnMapping.map((m) => (
                  <div
                    key={m.sourceColumn}
                    className="grid grid-cols-[1fr_1fr_80px] gap-0 px-3 py-1.5 text-xs font-inconsolata border-b border-[rgba(201,147,58,0.04)] last:border-0 items-center"
                  >
                    <span className={m.destinationColumn ? "text-text" : "text-ember"}>
                      {m.sourceColumn}
                    </span>
                    {m.destinationColumn ? (
                      <span className="text-text-dim">{m.destinationColumn}</span>
                    ) : (
                      <select
                        value=""
                        onChange={(e) =>
                          handleUnmappedDestChange(m.sourceColumn, e.target.value)
                        }
                        className="select-norse text-xs py-0.5"
                      >
                        <option value="">unmapped</option>
                        {availableDestColumns.map((dc) => (
                          <option key={dc.name} value={dc.name}>
                            {dc.name} ({dc.type})
                          </option>
                        ))}
                      </select>
                    )}
                    <span
                      className={`text-[9px] uppercase tracking-wider ${
                        m.matchType === "exact"
                          ? "text-gold"
                          : m.matchType === "none"
                            ? "text-ember"
                            : "text-text-dim"
                      }`}
                    >
                      {m.matchType === "none" ? "\u2014" : m.matchType.replace("_", " ")}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Actions */}
          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(0)} className="btn-ghost">
              Back
            </button>
            <button
              onClick={handleSeal}
              disabled={!canSeal || sealing}
              className="btn-primary"
            >
              {sealing ? "Sealing..." : "Seal this gate"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Seal */}
      {step === 2 && profile && (
        <div className="text-center">
          <div className="text-4xl text-gold mb-4">{"\u16B7"}</div>
          <h1 className="heading-norse text-xl mb-2">Gate Sealed</h1>
          <p className="text-text-dim text-xs tracking-wide mb-8">
            {initialPushResult?.status === "SUCCESS"
              ? "Your portal is inscribed and the data has been delivered."
              : "Your portal is ready. Drop files here whenever you need to push data."}
          </p>

          <div className="card-norse p-6 text-left max-w-md mx-auto space-y-3">
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Name</span>
              <span className="text-text font-cinzel">{gateName}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Realm</span>
              <RealmBadge type={profile.realmType} />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Destination</span>
              <span className="font-inconsolata text-text">{selectedTable}</span>
            </div>
            {pkColumns.length > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Key</span>
                <span className="font-inconsolata text-gold">{pkColumns.join(" + ")}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-text-dim">Strategy</span>
              <span className="badge-neutral text-[9px]">{writeModeToMergeStrategy(writeMode)}</span>
            </div>

            {/* Initial push result */}
            {initialPushResult && (
              <div className="border-t border-border pt-3 mt-3">
                {initialPushResult.status === "SUCCESS" ? (
                  <div className="flex justify-between text-xs">
                    <span className="text-success">Initial push</span>
                    <span className="font-inconsolata text-success">
                      {initialPushResult.rowCount?.toLocaleString()} rows
                      {initialPushResult.rowsInserted ? ` (${initialPushResult.rowsInserted.toLocaleString()} inserted)` : ""}
                      {initialPushResult.rowsUpdated ? ` (${initialPushResult.rowsUpdated.toLocaleString()} updated)` : ""}
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between text-xs">
                    <span className="text-ember">Initial push failed</span>
                    <span className="font-inconsolata text-ember text-[10px]">{initialPushResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => router.push(`/gates/${createdGateId}`)}
            className="btn-primary mt-8"
          >
            Open this gate now
          </button>
        </div>
      )}
    </div>
  );
}
