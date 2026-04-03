"use client";

import { useState } from "react";

export interface FieldMapping {
  sourceField: string;
  sourceType: string;
  destColumn: string;
}

interface FieldMapperProps {
  fields: FieldMapping[];
  onChange: (fields: FieldMapping[]) => void;
}

/** Sanitize a field name for BigQuery: lowercase, underscores, no special chars. */
function sanitizeForBQ(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Map NetSuite type → BigQuery type for display. */
function toBqType(nsType: string): string {
  switch (nsType.toUpperCase()) {
    case "INTEGER":
      return "INT64";
    case "FLOAT":
      return "FLOAT64";
    case "BOOLEAN":
      return "BOOL";
    case "TIMESTAMP":
      return "TIMESTAMP";
    default:
      return "STRING";
  }
}

export function generateMappings(
  fields: { name: string; type: string }[]
): FieldMapping[] {
  return fields.map((f) => ({
    sourceField: f.name,
    sourceType: f.type,
    destColumn: sanitizeForBQ(f.name),
  }));
}

export function FieldMapper({ fields, onChange }: FieldMapperProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  function handleDestChange(idx: number, value: string) {
    const updated = [...fields];
    updated[idx] = { ...updated[idx], destColumn: value };
    onChange(updated);
  }

  if (fields.length === 0) {
    return (
      <p className="text-text-dim text-xs tracking-wider py-2">
        Select source fields to see the mapping
      </p>
    );
  }

  return (
    <div className="border border-border bg-deep">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-0 px-3 py-2 border-b border-border bg-void/50">
        <span className="text-[0.55rem] tracking-[0.25em] uppercase text-text-dim">
          Source Field
        </span>
        <span />
        <span className="text-[0.55rem] tracking-[0.25em] uppercase text-text-dim">
          BigQuery Column
        </span>
        <span className="text-[0.55rem] tracking-[0.25em] uppercase text-text-dim text-right">
          Type
        </span>
      </div>

      {/* Rows */}
      {fields.map((mapping, idx) => (
        <div
          key={mapping.sourceField}
          className="grid grid-cols-[1fr_auto_1fr_auto] gap-0 items-center px-3 py-1.5 border-b border-border/30 hover:bg-gold/[0.03] transition-colors"
        >
          {/* Source field */}
          <span className="text-text text-xs tracking-wider font-mono">
            {mapping.sourceField}
          </span>

          {/* Arrow */}
          <span className="text-gold/40 text-xs px-3">&#x2192;</span>

          {/* Dest column — editable */}
          {editingIdx === idx ? (
            <input
              type="text"
              value={mapping.destColumn}
              onChange={(e) => handleDestChange(idx, e.target.value)}
              onBlur={() => setEditingIdx(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape")
                  setEditingIdx(null);
              }}
              autoFocus
              aria-label={`BigQuery column name for ${mapping.sourceField}`}
              className="bg-void border border-gold/30 px-2 py-0.5 text-xs font-mono text-frost tracking-wider outline-none focus:border-gold focus:ring-1 focus:ring-gold/50"
            />
          ) : (
            <button
              onClick={() => setEditingIdx(idx)}
              aria-label={`Edit column name: ${mapping.destColumn}`}
              className="text-frost text-xs tracking-wider font-mono text-left hover:text-gold-bright transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold"
            >
              {mapping.destColumn}
            </button>
          )}

          {/* Type badge */}
          <span className="text-[0.5rem] tracking-widest uppercase text-text-dim border border-border/50 px-1.5 py-0.5 text-right ml-2">
            {toBqType(mapping.sourceType)}
          </span>
        </div>
      ))}

      {/* Footer */}
      <div className="px-3 py-1.5 text-text-dim text-[0.55rem] tracking-wider">
        {fields.length} field{fields.length !== 1 ? "s" : ""} mapped — click a column name to edit
      </div>
    </div>
  );
}
