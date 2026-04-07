"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

// ─── Types ──────────────────────────────────────────

interface GatePush {
  id: string;
  fileName: string;
  fileSize: number;
  status: string;
  rowCount: number | null;
  rowsInserted: number | null;
  rowsUpdated: number | null;
  rowsErrored: number | null;
  duration: number | null;
  errorMessage: string | null;
  schemaDiff: unknown | null;
  createdAt: string;
  completedAt: string | null;
}

interface AlterStatement {
  sql: string;
  description: string;
  isComment: boolean;
  warning?: string;
}

interface DriftResolution {
  adjustFile: {
    description: string;
    actions: string[];
  };
  adjustDestination: {
    description: string;
    statements: AlterStatement[];
    warning: string;
  };
}

interface GateData {
  id: string;
  name: string;
  realmType: string;
  status: string;
  connectionId: string;
  connection: { name: string; type: string };
  targetTable: string;
  targetSchema: string | null;
  primaryKeyColumns: unknown;
  mergeStrategy: string;
  forgeEnabled: boolean;
  lastPushAt: string | null;
  pushCount: number;
  pushes: GatePush[];
}

interface PushValidationResult {
  pushId: string;
  status: string;
  rowCount: number;
  fileName?: string;
  schemaDiff?: unknown;
  resolutionOptions?: DriftResolution;
}

// ─── Sub-components ─────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "text-emerald-400 bg-emerald-900/20 border-emerald-700/30",
    PAUSED: "text-amber-400 bg-amber-900/20 border-amber-700/30",
    ARCHIVED: "text-text-dim bg-void/50 border-[rgba(201,147,58,0.1)]",
    SUCCESS: "text-emerald-400",
    FAILED: "text-red-400",
    SCHEMA_DRIFT: "text-amber-400",
    VALIDATED: "text-frost",
    PUSHING: "text-frost",
    VALIDATING: "text-text-dim",
    CANCELLED: "text-text-dim",
  };
  return (
    <span className={`text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 border ${colors[status] || "text-text-dim border-[rgba(201,147,58,0.1)]"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Main Component ─────────────────────────────────

export function GateDetail({ gate: initialGate }: { gate: GateData }) {
  const router = useRouter();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [gate, setGate] = useState(initialGate);
  const [pushState, setPushState] = useState<
    "idle" | "validating" | "confirmed" | "pushing" | "drift" | "success" | "failed"
  >("idle");
  const [validation, setValidation] = useState<PushValidationResult | null>(null);
  const [pushResult, setPushResult] = useState<{
    rowCount: number;
    rowsInserted: number;
    rowsUpdated: number;
    rowsErrored: number;
    duration: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Drift resolution state
  const [checkedStatements, setCheckedStatements] = useState<Set<number>>(new Set());
  const [resolving, setResolving] = useState(false);

  const [expandedPush, setExpandedPush] = useState<string | null>(null);

  // ── Drop handler ──────────────────────────────────

  const handleFile = useCallback(
    async (file: File) => {
      setPushState("validating");
      setValidation(null);
      setError(null);

      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`/api/gates/${gate.id}/push`, {
          method: "POST",
          body: formData,
        });

        const data: PushValidationResult = await res.json();

        if (!res.ok) {
          setError((data as unknown as { error: string }).error || "Validation failed");
          setPushState("failed");
          return;
        }

        setValidation(data);

        if (data.status === "SCHEMA_DRIFT") {
          setPushState("drift");
          // Default all executable statements to checked
          const stmts = data.resolutionOptions?.adjustDestination?.statements ?? [];
          setCheckedStatements(
            new Set(stmts.map((_, i) => i).filter((i) => !stmts[i].isComment))
          );
        } else if (data.status === "VALIDATED") {
          setValidation(data);
          // Auto-execute — no confirmation step needed
          setPushState("pushing");

          try {
            const execRes = await fetch(`/api/gates/${gate.id}/push/${data.pushId}/execute`, {
              method: "POST",
            });
            const execData = await execRes.json();

            if (!execRes.ok) {
              setError(execData.error || "Push failed");
              setPushState("failed");
              return;
            }

            setPushResult(execData);
            setPushState("success");
            toast.success(`Pushed ${execData.rowCount?.toLocaleString()} rows`);
            refreshGate();
          } catch {
            setError("Network error during push execution");
            setPushState("failed");
          }
        }
      } catch {
        setError("Network error");
        setPushState("failed");
      }
    },
    [gate.id]
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

  // ── Execute push ──────────────────────────────────

  const executePush = useCallback(async () => {
    if (!validation) return;
    setPushState("pushing");

    try {
      const res = await fetch(`/api/gates/${gate.id}/push/${validation.pushId}/execute`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Push failed");
        setPushState("failed");
        return;
      }

      setPushResult(data);
      setPushState("success");
      toast.success(`Pushed ${data.rowCount} rows`);

      // Refresh gate data
      refreshGate();
    } catch {
      setError("Network error during push");
      setPushState("failed");
    }
  }, [validation, gate.id, toast]);

  // ── Drift resolution ──────────────────────────────

  const resolveAdjustFile = useCallback(async () => {
    if (!validation) return;
    setResolving(true);
    try {
      await fetch(`/api/gates/${gate.id}/push/${validation.pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "ADJUST_FILE" }),
      });
      setPushState("idle");
      toast.success("Push cancelled — fix your file and re-upload");
      refreshGate();
    } finally {
      setResolving(false);
    }
  }, [validation, gate.id, toast]);

  const resolveAdjustDestination = useCallback(async () => {
    if (!validation?.resolutionOptions) return;
    setResolving(true);

    const stmts = validation.resolutionOptions.adjustDestination.statements;
    const confirmed = stmts
      .filter((_, i) => checkedStatements.has(i))
      .map((s) => s.sql);

    try {
      const res = await fetch(`/api/gates/${gate.id}/push/${validation.pushId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: "ADJUST_DESTINATION",
          executeStatements: true,
          confirmedStatements: confirmed,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Resolution failed");
        setPushState("failed");
        return;
      }

      if (data.status === "SUCCESS") {
        setPushResult(data);
        setPushState("success");
        toast.success(`Destination adjusted & ${data.rowCount} rows pushed`);
      } else {
        setError(data.error || "Push failed after adjustment");
        setPushState("failed");
      }
      refreshGate();
    } catch {
      setError("Network error");
      setPushState("failed");
    } finally {
      setResolving(false);
    }
  }, [validation, gate.id, checkedStatements, toast]);

  // ── Refresh gate ──────────────────────────────────

  const refreshGate = useCallback(async () => {
    try {
      const res = await fetch(`/api/gates/${gate.id}`);
      if (res.ok) {
        setGate(await res.json());
      }
    } catch {
      // best effort
    }
  }, [gate.id]);

  const resetPush = useCallback(() => {
    setPushState("idle");
    setValidation(null);
    setPushResult(null);
    setError(null);
  }, []);

  // ── Render ────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Top bar */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="heading-norse text-lg">{gate.name}</h1>
          <p className="font-inconsolata text-text-dim text-xs mt-1">
            {gate.connection.name} → {gate.targetSchema ? `${gate.targetSchema}.` : ""}
            {gate.targetTable} · {gate.mergeStrategy === "UPSERT" ? `Upsert on ${(Array.isArray(gate.primaryKeyColumns) ? (gate.primaryKeyColumns as string[]) : []).join(" + ")}` : gate.mergeStrategy.replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={gate.status} />
          <button
            onClick={() => {
              const action = prompt("Gate settings:\n1) Rename\n2) Pause/Resume\n3) Archive\n\nType new name to rename, 'pause'/'resume', or 'archive':");
              if (!action) return;
              const lower = action.toLowerCase().trim();
              const body: Record<string, string> = {};
              if (lower === "pause") body.status = "PAUSED";
              else if (lower === "resume") body.status = "ACTIVE";
              else if (lower === "archive") body.status = "ARCHIVED";
              else body.name = action.trim();

              fetch(`/api/gates/${gate.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }).then(() => refreshGate());
            }}
            className="text-text-dim hover:text-gold transition-colors text-sm"
            title="Gate settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Drop zone / Push flow */}
      {pushState === "idle" && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[rgba(201,147,58,0.15)] hover:border-gold/30 hover:bg-gold/[0.02] cursor-pointer transition-colors flex flex-col items-center justify-center"
          style={{ minHeight: "140px" }}
        >
          <span className="text-2xl text-text-dim mb-2">ᛉ</span>
          <span className="text-text text-sm tracking-wide">Drop updated file to push</span>
          <span className="text-text-dim text-[10px] tracking-wide mt-1">
            Schema must match — Hermod will validate before pushing
          </span>
        </div>
      )}

      {pushState === "validating" && (
        <div className="border-2 border-dashed border-frost/20 bg-frost/[0.02] flex flex-col items-center justify-center py-12">
          <span className="spinner-norse mb-3" style={{ width: 20, height: 20 }} />
          <span className="text-text-dim text-xs tracking-widest uppercase">Validating schema...</span>
        </div>
      )}

      {pushState === "confirmed" && validation && (
        <div className="card-norse p-6 space-y-4">
          <h3 className="heading-norse text-sm">Ready to push {validation.rowCount?.toLocaleString()} rows</h3>
          <p className="text-text-dim text-xs">
            File: <span className="font-inconsolata text-text">{validation.fileName}</span>
          </p>
          <div className="flex gap-3">
            <button onClick={executePush} className="btn-primary">
              Push now
            </button>
            <button onClick={resetPush} className="btn-ghost">
              Cancel
            </button>
          </div>
        </div>
      )}

      {pushState === "pushing" && (
        <div className="card-norse p-6 flex items-center gap-3">
          <span className="spinner-norse" style={{ width: 16, height: 16 }} />
          <span className="text-text-dim text-xs tracking-widest uppercase">Pushing rows...</span>
        </div>
      )}

      {pushState === "success" && pushResult && (
        <div className="card-norse p-6 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 text-lg">✓</span>
            <h3 className="heading-norse text-sm text-emerald-400">Push complete</h3>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-text text-sm font-inconsolata">{pushResult.rowCount}</div>
              <div className="text-text-dim text-[9px] uppercase tracking-wider">Total</div>
            </div>
            <div>
              <div className="text-emerald-400 text-sm font-inconsolata">{pushResult.rowsInserted}</div>
              <div className="text-text-dim text-[9px] uppercase tracking-wider">Inserted</div>
            </div>
            <div>
              <div className="text-frost text-sm font-inconsolata">{pushResult.rowsUpdated}</div>
              <div className="text-text-dim text-[9px] uppercase tracking-wider">Updated</div>
            </div>
            <div>
              <div className="text-text-dim text-sm font-inconsolata">{(pushResult.duration / 1000).toFixed(1)}s</div>
              <div className="text-text-dim text-[9px] uppercase tracking-wider">Duration</div>
            </div>
          </div>
          <button onClick={resetPush} className="btn-ghost text-xs">
            Push another file
          </button>
        </div>
      )}

      {pushState === "failed" && (
        <div className="card-norse p-6 space-y-3 border-l-2 border-l-red-500">
          <h3 className="text-red-400 text-sm font-cinzel uppercase tracking-wider">Push Failed</h3>
          <p className="text-text-dim text-xs font-inconsolata">{error}</p>
          <button onClick={resetPush} className="btn-ghost text-xs">
            Try again
          </button>
        </div>
      )}

      {/* Schema Drift UI */}
      {pushState === "drift" && validation?.resolutionOptions && (
        <SchemaDriftPanel
          diff={validation.schemaDiff as { added: Array<{name: string; type: string}>; removed: Array<{name: string; type: string}>; typeChanged: Array<{name: string; oldType: string; newType: string}> }}
          resolution={validation.resolutionOptions}
          checkedStatements={checkedStatements}
          onToggleStatement={(idx) => {
            setCheckedStatements((prev) => {
              const next = new Set(prev);
              if (next.has(idx)) next.delete(idx);
              else next.add(idx);
              return next;
            });
          }}
          onAdjustFile={resolveAdjustFile}
          onAdjustDestination={resolveAdjustDestination}
          onCancel={resetPush}
          resolving={resolving}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.csv,.tsv"
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Push History */}
      {gate.pushes.length > 0 && (
        <div>
          <h3 className="label-norse mb-3">Recent Pushes</h3>
          <div className="space-y-1">
            {gate.pushes.map((p) => (
              <div key={p.id}>
                <button
                  onClick={() => setExpandedPush(expandedPush === p.id ? null : p.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-gold/[0.02] transition-colors border-b border-[rgba(201,147,58,0.04)]"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      p.status === "SUCCESS"
                        ? "bg-emerald-400"
                        : p.status === "FAILED"
                          ? "bg-red-400"
                          : p.status === "SCHEMA_DRIFT"
                            ? "bg-amber-400"
                            : "bg-text-dim"
                    }`}
                  />
                  <span className="font-inconsolata text-text flex-1 text-left truncate">
                    {p.fileName}
                  </span>
                  {p.rowCount != null && (
                    <span className="text-text-dim font-inconsolata">
                      {p.rowCount.toLocaleString()} rows
                    </span>
                  )}
                  <span className="text-text-dim">{relativeTime(p.createdAt)}</span>
                </button>

                {expandedPush === p.id && (
                  <div className="px-3 py-2 bg-void/30 text-[10px] space-y-1 border-b border-[rgba(201,147,58,0.04)]">
                    <div className="flex gap-4">
                      <span className="text-text-dim">Status: <StatusBadge status={p.status} /></span>
                      {p.duration != null && (
                        <span className="text-text-dim">Duration: {(p.duration / 1000).toFixed(1)}s</span>
                      )}
                    </div>
                    {p.rowsInserted != null && (
                      <div className="text-text-dim">
                        Inserted: {p.rowsInserted} · Updated: {p.rowsUpdated ?? 0} · Errored: {p.rowsErrored ?? 0}
                      </div>
                    )}
                    {p.errorMessage && (
                      <div className="text-red-400 font-inconsolata">{p.errorMessage}</div>
                    )}
                    {p.status === "VALIDATED" && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setPushState("pushing");
                          try {
                            const res = await fetch(`/api/gates/${gate.id}/push/${p.id}/execute`, {
                              method: "POST",
                            });
                            const data = await res.json();
                            if (!res.ok) {
                              setError(data.error || "Push failed");
                              setPushState("failed");
                              return;
                            }
                            setPushResult(data);
                            setPushState("success");
                            toast.success(`Pushed ${data.rowCount?.toLocaleString()} rows`);
                            refreshGate();
                          } catch {
                            setError("Network error");
                            setPushState("failed");
                          }
                        }}
                        className="btn-primary text-[10px] px-3 py-1 mt-2"
                      >
                        Execute now
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schema Drift Panel ─────────────────────────────

function SchemaDriftPanel({
  diff,
  resolution,
  checkedStatements,
  onToggleStatement,
  onAdjustFile,
  onAdjustDestination,
  onCancel,
  resolving,
}: {
  diff: { added: Array<{name: string; type: string}>; removed: Array<{name: string; type: string}>; typeChanged: Array<{name: string; oldType: string; newType: string}> };
  resolution: DriftResolution;
  checkedStatements: Set<number>;
  onToggleStatement: (idx: number) => void;
  onAdjustFile: () => void;
  onAdjustDestination: () => void;
  onCancel: () => void;
  resolving: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Warning banner */}
      <div className="bg-amber-900/10 border border-amber-700/30 px-4 py-3">
        <h3 className="text-amber-400 text-sm font-cinzel uppercase tracking-wider">
          Schema Change Detected
        </h3>
      </div>

      {/* Diff visualization */}
      <div className="space-y-2">
        {diff.added.map((c) => (
          <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 bg-frost/[0.04] border border-frost/10 text-xs">
            <span className="text-frost text-[9px] uppercase tracking-wider">+ Added</span>
            <span className="font-inconsolata text-text">{c.name}</span>
            <span className="badge-neutral text-[8px]">{c.type}</span>
            <span className="text-text-dim text-[9px]">— new in file, not in destination</span>
          </div>
        ))}
        {diff.removed.map((c) => (
          <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 bg-red-900/[0.04] border border-red-700/10 text-xs">
            <span className="text-red-400 text-[9px] uppercase tracking-wider">- Missing</span>
            <span className="font-inconsolata text-text">{c.name}</span>
            <span className="badge-neutral text-[8px]">{c.type}</span>
            <span className="text-text-dim text-[9px]">— expected by destination, not in file</span>
          </div>
        ))}
        {diff.typeChanged.map((c) => (
          <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/[0.04] border border-amber-700/10 text-xs">
            <span className="text-amber-400 text-[9px] uppercase tracking-wider">~ Changed</span>
            <span className="font-inconsolata text-text">{c.name}</span>
            <span className="text-text-dim text-[9px]">{c.oldType} → {c.newType}</span>
          </div>
        ))}
      </div>

      {/* Resolution cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Adjust file */}
        <div className="card-norse p-4 space-y-3">
          <h4 className="text-text text-xs font-cinzel uppercase tracking-wider">Adjust your file</h4>
          <p className="text-text-dim text-[10px]">{resolution.adjustFile.description}</p>
          <ul className="space-y-1">
            {resolution.adjustFile.actions.map((a, i) => (
              <li key={i} className="text-text-dim text-[10px] font-inconsolata">· {a}</li>
            ))}
          </ul>
          <button
            onClick={onAdjustFile}
            disabled={resolving}
            className="btn-ghost text-xs w-full"
          >
            I&apos;ll fix my file and re-upload
          </button>
        </div>

        {/* Adjust destination */}
        <div className="card-norse p-4 space-y-3">
          <h4 className="text-text text-xs font-cinzel uppercase tracking-wider">Adjust the destination</h4>
          <p className="text-text-dim text-[10px]">{resolution.adjustDestination.description}</p>

          <div className="space-y-1 max-h-40 overflow-auto">
            {resolution.adjustDestination.statements.map((stmt, idx) => (
              <label
                key={idx}
                className={`flex items-start gap-2 text-[10px] font-inconsolata p-1.5 ${
                  stmt.isComment ? "text-text-dim" : "text-frost"
                }`}
              >
                {!stmt.isComment && (
                  <input
                    type="checkbox"
                    checked={checkedStatements.has(idx)}
                    onChange={() => onToggleStatement(idx)}
                    className="mt-0.5"
                  />
                )}
                <span className={stmt.isComment ? "italic" : ""}>{stmt.sql}</span>
              </label>
            ))}
          </div>

          {resolution.adjustDestination.warning && (
            <div className="text-ember text-[9px] bg-ember/5 border border-ember/10 px-2 py-1">
              {resolution.adjustDestination.warning}
            </div>
          )}

          <button
            onClick={onAdjustDestination}
            disabled={resolving || checkedStatements.size === 0}
            className="btn-primary text-xs w-full"
          >
            {resolving ? "Applying..." : "Apply changes & push"}
          </button>
        </div>
      </div>

      <button onClick={onCancel} className="text-text-dim text-[10px] hover:text-text transition-colors">
        Cancel this push
      </button>
    </div>
  );
}
