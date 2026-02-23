"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import type { SheetTemplate } from "./univer-sheet";
import { ColumnConfigPanel } from "./column-config-panel";
import { ReportConfig } from "./report-config";
import { useToast } from "@/components/toast";
import { useHermodLoading } from "@/components/hermod-loading-context";
import type { ColumnConfig } from "@/lib/column-config";

const SqlEditor = dynamic(
  () => import("./sql-editor").then((m) => m.SqlEditor),
  { ssr: false, loading: () => <div className="h-full bg-deep border border-border" /> }
);

const UniverSheet = dynamic(
  () => import("./univer-sheet").then((m) => m.UniverSheet),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center bg-deep border border-border"><div className="spinner-norse" /></div> }
);
import {
  generateColumnConfig,
  reconcileColumnConfig,
  applyColumnConfig,
  migrateConfigWidths,
} from "@/lib/column-config";

const PREVIEW_ROW_LIMIT = 20;

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface ReportEditorProps {
  reportId?: string;
}

export function ReportEditor({ reportId }: ReportEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const hermod = useHermodLoading();
  const isNew = !reportId;

  const [connections, setConnections] = useState<Connection[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sql, setSql] = useState("SELECT 1;");
  const [connectionId, setConnectionId] = useState("");
  const [template, setTemplate] = useState<SheetTemplate | null>(null);

  // Raw query results (before column config mapping)
  const [rawColumns, setRawColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);

  // Column config state
  const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>([]);
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);

  // Mapped data (after column config)
  const [mappedColumns, setMappedColumns] = useState<string[]>([]);
  const [mappedRows, setMappedRows] = useState<Record<string, unknown>[]>([]);
  const [mappedConfigIds, setMappedConfigIds] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [runInfo, setRunInfo] = useState<{ rowCount: number; time: number } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [startRow, setStartRow] = useState(0);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [loaded, setLoaded] = useState(isNew);

  const templateRef = useRef<SheetTemplate | null>(null);
  const columnConfigRef = useRef<ColumnConfig[]>([]);
  const rawColumnsRef = useRef<string[]>([]);
  const rawRowsRef = useRef<Record<string, unknown>[]>([]);
  const sheetExtractRef = useRef<(() => SheetTemplate | null) | null>(null);

  // Keep refs in sync
  useEffect(() => {
    columnConfigRef.current = columnConfig;
  }, [columnConfig]);
  useEffect(() => {
    rawColumnsRef.current = rawColumns;
    rawRowsRef.current = rawRows;
  }, [rawColumns, rawRows]);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then(setConnections)
      .catch(() => toast.error("Failed to load connections"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        if (report.formatting?.snapshot) {
          const tmpl = report.formatting as SheetTemplate;
          setTemplate(tmpl);
          templateRef.current = tmpl;
          setStartRow(tmpl.startRow ?? 0);
        }
        if (report.columnConfig && Array.isArray(report.columnConfig)) {
          const migrated = migrateConfigWidths(report.columnConfig as ColumnConfig[]);
          setColumnConfig(migrated);
          columnConfigRef.current = migrated;
        }
        setLoaded(true);
      })
      .catch(() => {
        toast.error("Report not found");
        router.push("/reports");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  useEffect(() => {
    if (loaded && !isNew) setHasChanges(true);
  }, [name, description, sql, connectionId]);

  // Helper: compute and set mapped data from column config + raw data
  function updateMappedData(config: ColumnConfig[], cols: string[], rws: Record<string, unknown>[]) {
    if (cols.length === 0 || config.length === 0) {
      setMappedColumns([]);
      setMappedRows([]);
      setMappedConfigIds([]);
      return;
    }
    const { columns, rows, configIds } = applyColumnConfig(config, cols, rws);
    setMappedColumns(columns);
    setMappedRows(rows);
    setMappedConfigIds(configIds);
  }

  const handleTemplateChange = useCallback((tmpl: SheetTemplate) => {
    templateRef.current = tmpl;
    // Don't setHasChanges here — template auto-save fires every 5s and would
    // immediately re-dirty after every save. The extract-before-save ensures
    // template formatting is always captured. Only explicit user actions
    // (name, SQL, connection, column config, startRow) should mark dirty.
  }, []);

  const handleColumnConfigChange = useCallback(
    (newConfig: ColumnConfig[]) => {
      setColumnConfig(newConfig);
      setHasChanges(true);
      // Recompute mapped data synchronously using refs for raw data
      updateMappedData(newConfig, rawColumnsRef.current, rawRowsRef.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleRun = useCallback(async () => {
    if (!connectionId) {
      toast.error("Select a connection first");
      return;
    }
    setRunning(true);
    setQueryError(null);
    setRunInfo(null);
    hermod.showLoading("Forging the query results...");
    try {
      const res = await fetch("/api/query/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, sql }),
      });
      const data = await res.json();
      if (!res.ok) {
        setQueryError(data.error || "Query failed");
        setRawColumns([]);
        setRawRows([]);
        return;
      }

      setRawColumns(data.columns);
      setRawRows(data.rows);
      setRunInfo({ rowCount: data.rowCount, time: data.executionTime });

      // Reconcile or generate column config
      let finalConfig: ColumnConfig[];
      const currentConfig = columnConfigRef.current;
      if (currentConfig.length === 0) {
        // First run — auto-generate config
        finalConfig = generateColumnConfig(data.columns);
        setColumnConfig(finalConfig);
        columnConfigRef.current = finalConfig;
      } else {
        // Subsequent run — reconcile
        const { config: reconciled, warnings } = reconcileColumnConfig(
          currentConfig,
          data.columns
        );
        finalConfig = reconciled;
        setColumnConfig(reconciled);
        columnConfigRef.current = reconciled;
        setConfigWarnings(warnings);
        if (warnings.length > 0) {
          toast.error(`Column changes detected: ${warnings.length} warning(s)`);
        }
      }

      // Compute mapped data synchronously — avoids double-render from derived-state effect
      updateMappedData(finalConfig, data.columns, data.rows);
    } catch {
      setQueryError("Network error");
    } finally {
      setRunning(false);
      hermod.hideLoading();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, sql]);

  async function handleSave() {
    if (!name || !connectionId) {
      toast.error("Name and connection are required");
      return;
    }
    // Force-extract live template before saving (covers <5s auto-save gap)
    if (sheetExtractRef.current) {
      const tmpl = sheetExtractRef.current();
      if (tmpl) templateRef.current = tmpl;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        description: description || undefined,
        sqlQuery: sql,
        dataSourceId: connectionId,
        formatting: templateRef.current,
        columnConfig: columnConfigRef.current.length > 0 ? columnConfigRef.current : undefined,
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

  async function handleTestSend(recipients: string[], emailConnectionId: string) {
    if (!reportId) return;
    hermod.showLoading("Dispatching the raven...");
    try {
      const res = await fetch(`/api/reports/${reportId}/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, emailConnectionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Send failed");
        return;
      }
      toast.success(`Sent to ${recipients.length} recipient${recipients.length !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Network error");
    } finally {
      hermod.hideLoading();
    }
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="spinner-norse" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] gap-4">
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
            className="select-norse w-auto"
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
            className="btn-primary text-xs"
          >
            <span>{running ? "Running..." : "Run Query"}</span>
          </button>
          <span className="text-[0.625rem] text-text-dim tracking-widest">CTRL+ENTER</span>
          {runInfo && (
            <span className="text-[0.625rem] text-text-dim tracking-wide">
              {runInfo.rowCount} rows in {runInfo.time}ms
            </span>
          )}
        </div>

        {/* Resizable panels: SQL → Column Config → Spreadsheet */}
        <PanelGroup orientation="vertical" className="flex-1">
          <Panel defaultSize={35} minSize={15}>
            <SqlEditor value={sql} onChange={(v) => { setSql(v); setHasChanges(true); }} onRun={handleRun} />
          </Panel>
          <PanelResizeHandle className="h-px flex items-center justify-center group cursor-row-resize">
            <div className="w-12 h-px bg-border group-hover:bg-gold-dim transition-colors" />
          </PanelResizeHandle>
          <Panel defaultSize={65} minSize={20}>
            <div className="flex flex-col h-full gap-0">
              {/* Column config panel — only show after first query run */}
              {columnConfig.length > 0 && rawColumns.length > 0 && (
                <ColumnConfigPanel
                  config={columnConfig}
                  queryColumns={rawColumns}
                  onChange={handleColumnConfigChange}
                  warnings={configWarnings}
                />
              )}

              {/* Spreadsheet */}
              <div className="flex-1 min-h-0 flex flex-col">
                {queryError && (
                  <div className="px-3 py-2 bg-error-dim border border-error/30 text-error text-xs mb-2 shrink-0">
                    {queryError}
                  </div>
                )}
                {mappedColumns.length > 0 && (
                  <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-deep shrink-0">
                    <span className="text-[0.5625rem] text-text-dim tracking-[0.35em] uppercase">Header Row</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={startRow + 1}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(19, (parseInt(e.target.value) || 1) - 1));
                        setStartRow(v);
                        setHasChanges(true);
                      }}
                      className="w-12 input-norse text-center text-xs py-0.5"
                    />
                    {startRow > 0 && (
                      <span className="text-[0.5625rem] text-text-dim tracking-wide">
                        {startRow} preamble row{startRow !== 1 ? "s" : ""} above data
                      </span>
                    )}
                  </div>
                )}
                {mappedColumns.length > 0 ? (
                  <div className="flex-1 min-h-0 flex flex-col">
                    {mappedRows.length > PREVIEW_ROW_LIMIT && (
                      <div className="px-3 py-1 border-b border-border bg-deep shrink-0">
                        <span className="text-[0.5625rem] text-text-dim tracking-[0.2em] uppercase">
                          Showing {PREVIEW_ROW_LIMIT} of {mappedRows.length} rows — full data used in export
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-h-0">
                      <UniverSheet
                        columns={mappedColumns}
                        rows={mappedRows.slice(0, PREVIEW_ROW_LIMIT)}
                        configIds={mappedConfigIds}
                        startRow={startRow}
                        template={template}
                        onTemplateChange={handleTemplateChange}
                        extractRef={sheetExtractRef}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center bg-deep border border-border">
                    <span className="text-gold/10 text-4xl font-cinzel mb-3">ᚱ</span>
                    <p className="text-text-dim text-xs tracking-wide">
                      Run a query to see results
                    </p>
                  </div>
                )}
              </div>
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
          onTestSend={handleTestSend}
          saving={saving}
          hasChanges={hasChanges}
          isNew={isNew}
        />
      </div>
    </div>
  );
}
