"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import type { DetectedSchema, SchemaDiff } from "@/lib/file-processor";

// ─── Types ──────────────────────────────────────────

interface FileEntryData {
  id: string;
  fileName: string;
  fileSize: number;
  rowCount: number | null;
  columnCount: number | null;
  status: string;
  loadMode: string;
  error: string | null;
  schema: DetectedSchema | null;
  schemaDrift: SchemaDiff | null;
  uploadedAt: string;
  processedAt: string | null;
}

interface FileListResponse {
  entries: FileEntryData[];
  total: number;
  connectionName: string;
  baselineSchema: DetectedSchema | null;
  stats: {
    totalFiles: number;
    totalRows: number;
    lastUpload: string | null;
    avgRowsPerFile: number;
  };
}

// ─── Status Badges ──────────────────────────────────

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  LOADED:       { bg: "rgba(102,187,106,0.15)", text: "#66bb6a", label: "Loaded" },
  SCHEMA_DRIFT: { bg: "rgba(255,183,77,0.15)",  text: "#ffb74d", label: "Schema Drift" },
  FAILED:       { bg: "rgba(239,83,80,0.15)",   text: "#ef5350", label: "Failed" },
  PENDING:      { bg: "rgba(212,196,160,0.1)",   text: "#d4c4a0", label: "Pending" },
  PROCESSING:   { bg: "rgba(126,184,212,0.15)", text: "#7eb8d4", label: "Processing" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10px] font-inconsolata tracking-wider uppercase border"
      style={{ background: style.bg, color: style.text, borderColor: `${style.text}33` }}
    >
      {style.label}
    </span>
  );
}

// ─── Format Helpers ─────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Page Component ─────────────────────────────────

export default function FileSourcePage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const connectionId = params.id as string;

  const [data, setData] = useState<FileListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Schema confirmation modal
  const [pendingSchema, setPendingSchema] = useState<DetectedSchema | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Schema drift modal
  const [driftInfo, setDriftInfo] = useState<{ diff: SchemaDiff; entryId: string } | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/file-entries?connectionId=${connectionId}&limit=20&offset=${page * 20}`
      );
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId, page]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ─── Upload Handler ─────────────────────────────────

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("connectionId", connectionId);

      const res = await fetch("/api/file-entries/upload", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Upload failed");
        return;
      }

      if (result.needsConfirmation) {
        setPendingSchema(result.detectedSchema);
        toast.success("File parsed — confirm schema to continue");
      } else if (result.schemaDrift) {
        setDriftInfo({ diff: result.schemaDrift, entryId: result.fileEntry.id });
        toast.error("Schema has changed since baseline was set");
      } else {
        toast.success(`File loaded — ${result.fileEntry.rowCount?.toLocaleString() ?? 0} rows`);
      }

      fetchEntries();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      // Reset file input
      e.target.value = "";
    }
  }

  // ─── Schema Confirmation ────────────────────────────

  async function confirmSchema() {
    if (!pendingSchema) return;
    setConfirming(true);
    try {
      const res = await fetch("/api/file-entries/confirm-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, schema: pendingSchema }),
      });
      if (res.ok) {
        toast.success("Schema confirmed as baseline");
        setPendingSchema(null);
        fetchEntries();
      } else {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(data.error || "Failed to confirm schema");
      }
    } finally {
      setConfirming(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center">
        <div className="w-4 h-4 border-2 border-gold border-t-transparent animate-spin" />
        <span className="text-text-dim text-xs font-inconsolata">Loading file history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <button onClick={() => router.push("/connections")} className="btn-subtle text-xs mb-3">
          &larr; Back to Connections
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-cinzel text-lg text-text tracking-wider">
              {data?.connectionName ?? "File Source"}
            </h1>
            <p className="text-text-muted text-xs font-inconsolata mt-1">File upload history</p>
          </div>
          <label className={`btn-primary text-xs cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <span>{uploading ? "Uploading..." : "Upload File"}</span>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.tsv"
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <div className="grid grid-cols-4 gap-px bg-border">
          {[
            { label: "Total Files", value: data.stats.totalFiles.toLocaleString() },
            { label: "Total Rows", value: data.stats.totalRows.toLocaleString() },
            { label: "Last Upload", value: data.stats.lastUpload ? formatDate(data.stats.lastUpload) : "Never" },
            { label: "Avg Rows/File", value: data.stats.avgRowsPerFile.toLocaleString() },
          ].map((stat) => (
            <div key={stat.label} className="bg-deep p-3">
              <p className="text-[9px] font-space-grotesk tracking-[0.3em] uppercase text-text-muted">{stat.label}</p>
              <p className="text-sm font-inconsolata text-text mt-0.5">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Schema Section */}
      {data && (
        <div className="bg-deep border border-border p-4">
          <h3 className="label-norse !mb-2 text-gold">Baseline Schema</h3>
          {data.baselineSchema ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal tracking-wider">Column</th>
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal tracking-wider">Type</th>
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal tracking-wider">Nullable</th>
                  </tr>
                </thead>
                <tbody>
                  {data.baselineSchema.columns.map((col) => (
                    <tr key={col.name} className="border-b border-border/50">
                      <td className="py-1 px-2 font-inconsolata text-text">{col.name}</td>
                      <td className="py-1 px-2 font-inconsolata text-text-dim">{col.inferredType}</td>
                      <td className="py-1 px-2 font-inconsolata text-text-dim">{col.nullable ? "yes" : "no"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-text-dim text-xs font-inconsolata">Upload your first file to detect the schema</p>
          )}
        </div>
      )}

      {/* History Table */}
      {data && data.entries.length > 0 && (
        <div>
          <h3 className="label-norse !mb-2 text-gold">Upload History</h3>
          <div className="border border-border">
            {data.entries.map((entry) => (
              <div key={entry.id}>
                <button
                  onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-scroll/30 transition-colors border-b border-border/50"
                >
                  <span className="text-xs font-inconsolata text-text-dim w-36 shrink-0">
                    {formatDate(entry.uploadedAt)}
                  </span>
                  <span className="text-xs font-inconsolata text-text truncate flex-1">
                    {entry.fileName}
                  </span>
                  <span className="text-xs font-inconsolata text-text-dim w-20 text-right">
                    {entry.rowCount?.toLocaleString() ?? "—"} rows
                  </span>
                  <StatusBadge status={entry.status} />
                  <span className="text-xs font-inconsolata text-text-muted w-16 text-right">
                    {formatBytes(entry.fileSize)}
                  </span>
                </button>

                {expandedEntry === entry.id && (
                  <div className="px-4 py-3 bg-void border-b border-border/50 text-xs font-inconsolata space-y-1">
                    <p className="text-text-muted">Load mode: <span className="text-text">{entry.loadMode}</span></p>
                    {entry.error && <p className="text-error">Error: {entry.error}</p>}
                    {entry.schemaDrift && (
                      <div className="mt-2">
                        <p className="text-warning mb-1">Schema drift detected:</p>
                        {(entry.schemaDrift as SchemaDiff).added?.length > 0 && (
                          <p className="text-success">+ Added: {(entry.schemaDrift as SchemaDiff).added.join(", ")}</p>
                        )}
                        {(entry.schemaDrift as SchemaDiff).removed?.length > 0 && (
                          <p className="text-error">- Removed: {(entry.schemaDrift as SchemaDiff).removed.join(", ")}</p>
                        )}
                        {(entry.schemaDrift as SchemaDiff).typeChanges?.length > 0 && (
                          <div>
                            {(entry.schemaDrift as SchemaDiff).typeChanges.map((tc) => (
                              <p key={tc.column} className="text-warning">~ {tc.column}: {tc.was} → {tc.now}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {entry.processedAt && (
                      <p className="text-text-muted">Processed: {formatDate(entry.processedAt)}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {data.total > 20 && (
            <div className="flex justify-center gap-2 mt-3">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="btn-subtle text-[10px]"
              >
                Prev
              </button>
              <span className="text-text-muted text-[10px] font-inconsolata py-1">
                Page {page + 1} of {Math.ceil(data.total / 20)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * 20 >= data.total}
                className="btn-subtle text-[10px]"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Schema Confirmation Modal */}
      {pendingSchema && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-deep border border-border p-6 w-full max-w-lg space-y-4">
            <h3 className="font-cinzel text-sm text-gold tracking-wider uppercase">Confirm Schema</h3>
            <p className="text-text-dim text-xs font-inconsolata">
              This will be locked as the baseline schema. Future uploads will be checked against it.
            </p>
            <div className="overflow-x-auto max-h-64">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal">Column</th>
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal">Type</th>
                    <th className="text-left py-1 px-2 text-text-muted font-inconsolata font-normal">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSchema.columns.map((col) => (
                    <tr key={col.name} className="border-b border-border/50">
                      <td className="py-1 px-2 font-inconsolata text-text">{col.name}</td>
                      <td className="py-1 px-2 font-inconsolata text-text-dim">{col.inferredType}</td>
                      <td className="py-1 px-2 font-inconsolata text-text-muted truncate max-w-[200px]">
                        {col.sampleValues.join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={confirmSchema} disabled={confirming} className="btn-primary text-xs flex-1">
                <span>{confirming ? "Confirming..." : "Confirm Schema"}</span>
              </button>
              <button onClick={() => setPendingSchema(null)} className="btn-ghost text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schema Drift Modal */}
      {driftInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-deep border border-border p-6 w-full max-w-md space-y-4">
            <h3 className="font-cinzel text-sm text-ember tracking-wider uppercase">Schema Has Changed</h3>
            <div className="text-xs font-inconsolata space-y-1">
              {driftInfo.diff.added.length > 0 && (
                <p className="text-success">+ New columns: {driftInfo.diff.added.join(", ")}</p>
              )}
              {driftInfo.diff.removed.length > 0 && (
                <p className="text-error">- Missing columns: {driftInfo.diff.removed.join(", ")}</p>
              )}
              {driftInfo.diff.typeChanges.map((tc) => (
                <p key={tc.column} className="text-warning">~ {tc.column}: {tc.was} → {tc.now}</p>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setDriftInfo(null)} className="btn-ghost text-xs flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
