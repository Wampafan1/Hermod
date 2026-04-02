"use client";

import { useState, useCallback } from "react";
import type { SchemaMapping } from "@/lib/alfheim/types";

export interface DiscoveredEndpoint {
  endpoint: string;
  suggestedName: string;
  responseRoot: string;
  schema: SchemaMapping;
  incrementalKey: string | null;
  primaryKey: string | null;
  confidence?: "high" | "medium" | "low";
  notes?: string[];
  pagination?: { type: string; config: Record<string, unknown> };
}

interface EndpointSelectorProps {
  endpoints: DiscoveredEndpoint[];
  onSelect: (selected: DiscoveredEndpoint[]) => void;
}

const CONFIDENCE_DOT: Record<string, string> = {
  high: "bg-emerald-400",
  medium: "bg-amber-400",
  low: "bg-red-400",
};

export function EndpointSelector({ endpoints, onSelect }: EndpointSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(endpoints.map((e) => e.endpoint)),
  );

  const toggle = useCallback((endpoint: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(endpoint)) next.delete(endpoint);
      else next.add(endpoint);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selected.size === endpoints.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(endpoints.map((e) => e.endpoint)));
    }
  }, [endpoints, selected.size]);

  const handleProceed = useCallback(() => {
    const picked = endpoints.filter((e) => selected.has(e.endpoint));
    onSelect(picked);
  }, [endpoints, selected, onSelect]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="label-norse">
          Discovered Endpoints ({endpoints.length})
        </h3>
        <button
          type="button"
          onClick={toggleAll}
          className="text-text-dim text-[10px] tracking-wide hover:text-gold transition-colors"
        >
          {selected.size === endpoints.length ? "Deselect all" : "Select all"}
        </button>
      </div>

      <div className="space-y-2">
        {endpoints.map((ep) => {
          const isSelected = selected.has(ep.endpoint);
          const colCount = ep.schema.columns.length;
          const childCount = ep.schema.childTables?.length ?? 0;

          return (
            <label
              key={ep.endpoint}
              className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                isSelected
                  ? "border-gold bg-gold/5"
                  : "border-border hover:border-gold-dim"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggle(ep.endpoint)}
                className="mt-0.5 accent-[var(--gold)]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-text text-sm font-cinzel uppercase tracking-[0.04em]">
                    {ep.suggestedName}
                  </span>
                  {ep.confidence && (
                    <span className={`inline-block w-2 h-2 ${CONFIDENCE_DOT[ep.confidence]}`} />
                  )}
                </div>
                <p className="text-text-dim text-xs font-inconsolata mt-0.5">
                  {ep.endpoint}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="badge-neutral">{colCount} column{colCount !== 1 ? "s" : ""}</span>
                  {childCount > 0 && (
                    <span className="badge-neutral">{childCount} child table{childCount !== 1 ? "s" : ""}</span>
                  )}
                  {ep.incrementalKey && (
                    <span className="text-[10px] tracking-wide font-space-grotesk uppercase px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-700/30">
                      &#x27F3; {ep.incrementalKey}
                    </span>
                  )}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleProceed}
        disabled={selected.size === 0}
        className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue with {selected.size} endpoint{selected.size !== 1 ? "s" : ""} &rarr;
      </button>
    </div>
  );
}
