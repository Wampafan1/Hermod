"use client";

import { useState, useCallback } from "react";
import type { SchemaMapping, ColumnMapping, ChildTableMapping } from "@/lib/alfheim/types";

/* ───────────────────────── Types ───────────────────────── */

interface SchemaReviewProps {
  schema: SchemaMapping;
  suggestedTableName: string;
  suggestedPrimaryKey?: string | null;
  suggestedIncrementalKey?: string | null;
  confidence?: "high" | "medium" | "low";
  notes?: string[];
  onSchemaChange: (schema: SchemaMapping) => void;
  onTableNameChange: (name: string) => void;
  onPrimaryKeyChange: (key: string | null) => void;
  onIncrementalKeyChange: (key: string | null) => void;
}

const DATA_TYPES: ColumnMapping["dataType"][] = [
  "STRING", "INTEGER", "FLOAT", "BOOLEAN", "TIMESTAMP", "JSON",
];

const CONFIDENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high:   { bg: "bg-emerald-900/30", text: "text-emerald-400", label: "High Confidence" },
  medium: { bg: "bg-amber-900/30",   text: "text-amber-400",  label: "Medium Confidence" },
  low:    { bg: "bg-red-900/30",     text: "text-red-400",    label: "Low Confidence" },
};

/* ───────────────────────── Component ──────────────────── */

export function SchemaReview({
  schema,
  suggestedTableName,
  suggestedPrimaryKey,
  suggestedIncrementalKey,
  confidence,
  notes,
  onSchemaChange,
  onTableNameChange,
  onPrimaryKeyChange,
  onIncrementalKeyChange,
}: SchemaReviewProps) {
  const [expandedChild, setExpandedChild] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  // Track which columns are excluded (by columnName)
  const [excludedColumns, setExcludedColumns] = useState<Set<string>>(new Set());

  const toggleColumn = useCallback((columnName: string) => {
    setExcludedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(columnName)) next.delete(columnName);
      else next.add(columnName);
      return next;
    });
    // Update schema — filter excluded columns
    const updated: SchemaMapping = {
      ...schema,
      columns: schema.columns.map((c) =>
        c.columnName === columnName ? { ...c, nullable: !excludedColumns.has(columnName) ? true : c.nullable } : c
      ),
    };
    onSchemaChange(updated);
  }, [schema, excludedColumns, onSchemaChange]);

  const updateColumnType = useCallback((columnName: string, dataType: ColumnMapping["dataType"]) => {
    const updated: SchemaMapping = {
      ...schema,
      columns: schema.columns.map((c) =>
        c.columnName === columnName ? { ...c, dataType } : c
      ),
    };
    onSchemaChange(updated);
  }, [schema, onSchemaChange]);

  const updateColumnName = useCallback((oldName: string, newName: string) => {
    const sanitized = newName.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const updated: SchemaMapping = {
      ...schema,
      columns: schema.columns.map((c) =>
        c.columnName === oldName ? { ...c, columnName: sanitized } : c
      ),
    };
    onSchemaChange(updated);
  }, [schema, onSchemaChange]);

  const activeColumns = schema.columns.filter((c) => !excludedColumns.has(c.columnName));
  const confidenceStyle = confidence ? CONFIDENCE_STYLES[confidence] : null;

  return (
    <div className="space-y-5">
      {/* Confidence Badge + Notes */}
      {confidenceStyle && (
        <div className={`${confidenceStyle.bg} border border-current/20 p-3`}>
          <div className="flex items-center justify-between">
            <span className={`${confidenceStyle.text} text-xs tracking-[0.1em] uppercase font-medium`}>
              {confidenceStyle.label}
            </span>
            {notes && notes.length > 0 && (
              <button
                type="button"
                onClick={() => setShowNotes(!showNotes)}
                className="text-text-dim text-[10px] tracking-wide hover:text-text transition-colors"
              >
                {showNotes ? "Hide notes" : `${notes.length} note${notes.length !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
          {showNotes && notes && (
            <ul className="mt-2 space-y-1">
              {notes.map((note, i) => (
                <li key={i} className="text-text-dim text-xs leading-relaxed">
                  &mdash; {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Table Name */}
      <div>
        <label className="label-norse block mb-1">Table Name</label>
        <input
          type="text"
          value={suggestedTableName}
          onChange={(e) => onTableNameChange(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
          className="input-norse w-full max-w-sm"
        />
      </div>

      {/* Key Selectors */}
      <div className="flex gap-6">
        <div className="flex-1">
          <label htmlFor="pk-select" className="label-norse block mb-1">Primary Key</label>
          <select
            id="pk-select"
            value={suggestedPrimaryKey ?? ""}
            onChange={(e) => onPrimaryKeyChange(e.target.value || null)}
            className="input-norse w-full"
          >
            <option value="">None</option>
            {activeColumns.map((c) => (
              <option key={c.columnName} value={c.columnName}>{c.columnName}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label htmlFor="ik-select" className="label-norse block mb-1">Incremental Key</label>
          <select
            id="ik-select"
            value={suggestedIncrementalKey ?? ""}
            onChange={(e) => onIncrementalKeyChange(e.target.value || null)}
            className="input-norse w-full"
          >
            <option value="">None (full reload)</option>
            {activeColumns.map((c) => (
              <option key={c.columnName} value={c.columnName}>{c.columnName}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Column Table */}
      <div>
        <h3 className="label-norse mb-2">
          Columns ({activeColumns.length} / {schema.columns.length})
        </h3>
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-void/50">
                <th scope="col" className="px-3 py-2 text-left text-text-dim tracking-wide uppercase w-8" />
                <th scope="col" className="px-3 py-2 text-left text-text-dim tracking-wide uppercase">JSON Path</th>
                <th scope="col" className="px-3 py-2 text-left text-text-dim tracking-wide uppercase">Column Name</th>
                <th scope="col" className="px-3 py-2 text-left text-text-dim tracking-wide uppercase w-32">Type</th>
                <th scope="col" className="px-3 py-2 text-left text-text-dim tracking-wide uppercase w-16">Nullable</th>
              </tr>
            </thead>
            <tbody>
              {schema.columns.map((col) => {
                const excluded = excludedColumns.has(col.columnName);
                return (
                  <tr
                    key={col.columnName}
                    className={`border-b border-border/50 ${excluded ? "opacity-40" : ""}`}
                  >
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        checked={!excluded}
                        onChange={() => toggleColumn(col.columnName)}
                        className="accent-[var(--gold)]"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-text-dim font-inconsolata">{col.jsonPath}</td>
                    <td className="px-3 py-1.5">
                      <input
                        type="text"
                        value={col.columnName}
                        onChange={(e) => updateColumnName(col.columnName, e.target.value)}
                        className="bg-transparent text-text font-inconsolata border-b border-transparent focus:border-gold outline-none w-full"
                        disabled={excluded}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <select
                        value={col.dataType}
                        onChange={(e) => updateColumnType(col.columnName, e.target.value as ColumnMapping["dataType"])}
                        className="input-norse text-xs py-0.5 w-full"
                        disabled={excluded}
                      >
                        {DATA_TYPES.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5 text-center text-text-dim">
                      {col.nullable ? "yes" : "no"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Child Tables */}
      {schema.childTables && schema.childTables.length > 0 && (
        <div className="space-y-2">
          <h3 className="label-norse">
            Child Tables ({schema.childTables.length})
          </h3>
          {schema.childTables.map((child) => (
            <div key={child.tableName} className="border border-border">
              <button
                type="button"
                onClick={() => setExpandedChild(expandedChild === child.tableName ? null : child.tableName)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-gold/5 transition-colors"
              >
                <span className="text-text font-inconsolata">{child.tableName}</span>
                <span className="text-text-dim">
                  {child.columns.length} col{child.columns.length !== 1 ? "s" : ""}{" "}
                  {expandedChild === child.tableName ? "\u25B4" : "\u25BE"}
                </span>
              </button>
              {expandedChild === child.tableName && (
                <div className="border-t border-border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-void/50">
                        <th scope="col" className="px-3 py-1.5 text-left text-text-dim tracking-wide uppercase">JSON Path</th>
                        <th scope="col" className="px-3 py-1.5 text-left text-text-dim tracking-wide uppercase">Column</th>
                        <th scope="col" className="px-3 py-1.5 text-left text-text-dim tracking-wide uppercase w-32">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border/50 text-gold/60">
                        <td className="px-3 py-1 font-inconsolata" colSpan={2}>FK: {child.foreignKey}</td>
                        <td className="px-3 py-1">INTEGER</td>
                      </tr>
                      {child.columns.map((col) => (
                        <tr key={col.columnName} className="border-b border-border/50">
                          <td className="px-3 py-1 text-text-dim font-inconsolata">{col.jsonPath}</td>
                          <td className="px-3 py-1 text-text font-inconsolata">{col.columnName}</td>
                          <td className="px-3 py-1 text-text-dim">{col.dataType}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
