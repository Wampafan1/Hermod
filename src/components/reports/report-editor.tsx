"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { SqlEditor } from "./sql-editor";
import { ResultsGrid, FormattingConfig } from "./results-grid";
import { ReportConfig } from "./report-config";
import { useToast } from "@/components/toast";

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface ReportData {
  id?: string;
  name: string;
  description: string;
  sqlQuery: string;
  dataSourceId: string;
  formatting: FormattingConfig;
}

interface ReportEditorProps {
  reportId?: string; // undefined = new report
}

const DEFAULT_FORMATTING: FormattingConfig = {
  columns: {},
  headerStyle: { bold: true, bgColor: "#1e3a5f", fontColor: "#ffffff" },
  cellStyles: {},
};

export function ReportEditor({ reportId }: ReportEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !reportId;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sql, setSql] = useState("SELECT 1;");
  const [connectionId, setConnectionId] = useState("");
  const [formatting, setFormatting] = useState<FormattingConfig>(DEFAULT_FORMATTING);

  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [runInfo, setRunInfo] = useState<{ rowCount: number; time: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  // Fetch connections
  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then(setConnections)
      .catch(() => toast.error("Failed to load connections"));
  }, [toast]);

  // Load existing report
  useEffect(() => {
    if (!reportId) return;
    fetch(`/api/reports/${reportId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((report) => {
        setName(report.name);
        setDescription(report.description ?? "");
        setSql(report.sqlQuery);
        setConnectionId(report.dataSourceId);
        setFormatting(report.formatting ?? DEFAULT_FORMATTING);
        setLoaded(true);
      })
      .catch(() => {
        toast.error("Report not found");
        router.push("/reports");
      });
  }, [reportId, router, toast]);

  // Track unsaved changes
  useEffect(() => {
    if (loaded && !isNew) setHasChanges(true);
  }, [name, description, sql, connectionId, formatting]);

  const handleRun = useCallback(async () => {
    if (!connectionId) {
      toast.error("Select a connection first");
      return;
    }
    setRunning(true);
    setQueryError(null);
    setRunInfo(null);
    try {
      const res = await fetch("/api/query/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, sql }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQueryError(data.error || "Query failed");
        setColumns([]);
        setRows([]);
        return;
      }
      setColumns(data.columns);
      setRows(data.rows);
      setRunInfo({ rowCount: data.rowCount, time: data.executionTime });
    } catch {
      setQueryError("Network error");
    } finally {
      setRunning(false);
    }
  }, [connectionId, sql, toast]);

  async function handleSave() {
    if (!name || !connectionId) {
      toast.error("Name and connection are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        description: description || undefined,
        sqlQuery: sql,
        dataSourceId: connectionId,
        formatting,
      };
      const url = isNew ? "/api/reports" : `/api/reports/${reportId}`;
      const method = isNew ? "POST" : "PUT";
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
      toast.success(isNew ? "Report created" : "Report saved");
      setHasChanges(false);
      if (isNew) {
        router.push(`/reports/${data.id}`);
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveAndSchedule() {
    handleSave().then(() => {
      if (reportId) router.push(`/reports/${reportId}/schedule`);
    });
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-gray-500">Loading report...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-3">
          <select
            value={connectionId}
            onChange={(e) => {
              setConnectionId(e.target.value);
              setHasChanges(true);
            }}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Select connection...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleRun}
            disabled={running || !connectionId}
            className="px-4 py-1.5 bg-green-600 rounded-lg text-sm font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50"
          >
            {running ? "Running..." : "Run Query"}
          </button>
          <span className="text-xs text-gray-500">Ctrl+Enter</span>
          {runInfo && (
            <span className="text-xs text-gray-400">
              {runInfo.rowCount} rows in {runInfo.time}ms
            </span>
          )}
        </div>

        {/* Resizable panels */}
        <PanelGroup orientation="vertical" className="flex-1">
          <Panel defaultSize={40} minSize={20}>
            <SqlEditor value={sql} onChange={(v) => { setSql(v); setHasChanges(true); }} onRun={handleRun} />
          </Panel>
          <PanelResizeHandle className="h-2 flex items-center justify-center group cursor-row-resize">
            <div className="w-8 h-1 rounded-full bg-gray-700 group-hover:bg-gray-500 transition-colors" />
          </PanelResizeHandle>
          <Panel defaultSize={60} minSize={20}>
            <div className="h-full flex flex-col">
              {queryError && (
                <div className="px-3 py-2 bg-red-500/10 text-red-400 text-sm rounded-lg mb-2">
                  {queryError}
                </div>
              )}
              {columns.length > 0 ? (
                <ResultsGrid
                  columns={columns}
                  rows={rows}
                  formatting={formatting}
                  onFormattingChange={(f) => {
                    setFormatting(f);
                    setHasChanges(true);
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center bg-gray-900 border border-gray-800 rounded-lg">
                  <p className="text-gray-500 text-sm">
                    Run a query to see results
                  </p>
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>

      {/* Config sidebar */}
      <div className="w-72 shrink-0">
        <ReportConfig
          name={name}
          description={description}
          connectionId={connectionId}
          connections={connections}
          onNameChange={(v) => { setName(v); setHasChanges(true); }}
          onDescriptionChange={(v) => { setDescription(v); setHasChanges(true); }}
          onConnectionChange={(v) => { setConnectionId(v); setHasChanges(true); }}
          onSave={handleSave}
          onSaveAndSchedule={handleSaveAndSchedule}
          saving={saving}
          hasChanges={hasChanges}
          isNew={isNew}
        />
      </div>
    </div>
  );
}
