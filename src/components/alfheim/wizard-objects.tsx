"use client";

import { useState, useCallback, useMemo } from "react";

interface ObjectSchema {
  columns: { jsonPath: string; columnName: string; dataType: string; nullable: boolean }[];
  childTables?: { jsonPath: string; tableName: string; columns: { columnName: string; dataType: string }[] }[];
}

interface ApiObject {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  endpoint: string;
  incrementalKey?: string | null;
  schema: ObjectSchema;
}

interface WizardObjectsProps {
  connectorSlug: string;
  objects: ApiObject[];
  onComplete: (selectedObjectSlugs: string[]) => void;
  onBack: () => void;
}

export function WizardObjects({ connectorSlug, objects, onComplete, onBack }: WizardObjectsProps) {
  const [selectedSlugs, setSelectedSlugs] = useState<Set<string>>(new Set());
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());

  const allSelected = objects.length > 0 && selectedSlugs.size === objects.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedSlugs(new Set());
    } else {
      setSelectedSlugs(new Set(objects.map((o) => o.slug)));
    }
  }, [allSelected, objects]);

  const toggleObject = useCallback((slug: string) => {
    setSelectedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const toggleSchema = useCallback((slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  const handleNext = useCallback(() => {
    onComplete(Array.from(selectedSlugs));
  }, [onComplete, selectedSlugs]);

  const selectedCount = selectedSlugs.size;

  return (
    <div>
      {/* Header */}
      <h2 className="heading-norse text-lg">Select Data Objects</h2>
      <p className="text-text-dim text-xs tracking-wide mt-1">
        Choose which data to sync from {connectorSlug}
      </p>

      {/* Select All */}
      <label className="flex items-center gap-2 mt-6 mb-4 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleSelectAll}
          className="accent-gold w-4 h-4"
        />
        <span className="label-norse">
          Select All ({objects.length})
        </span>
      </label>

      {/* Object list */}
      <div className="space-y-2">
        {objects.map((obj) => {
          const isSelected = selectedSlugs.has(obj.slug);
          const isExpanded = expandedSlugs.has(obj.slug);
          const columnCount = obj.schema.columns.length;

          return (
            <div
              key={obj.slug}
              className={`card-norse transition-colors ${
                isSelected ? "border-l-2 border-l-gold bg-gold/[0.04]" : ""
              }`}
            >
              {/* Main row */}
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => toggleObject(obj.slug)}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleObject(obj.slug)}
                  onClick={(e) => e.stopPropagation()}
                  className="accent-gold w-4 h-4 shrink-0"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-cinzel text-sm text-text uppercase tracking-[0.06em]">
                      {obj.name}
                    </span>

                    <span className="badge-neutral">{columnCount} column{columnCount !== 1 ? "s" : ""}</span>

                    {obj.incrementalKey && (
                      <span className="text-[10px] tracking-wide font-space-grotesk uppercase px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 border border-emerald-700/30">
                        &#x27F3; Incremental
                      </span>
                    )}
                  </div>

                  {obj.description && (
                    <p className="text-text-dim text-xs mt-1 leading-relaxed line-clamp-2">
                      {obj.description}
                    </p>
                  )}
                </div>

                {/* Schema toggle */}
                <button
                  type="button"
                  onClick={(e) => toggleSchema(obj.slug, e)}
                  className="text-text-dim text-[10px] tracking-wide font-space-grotesk uppercase hover:text-gold transition-colors shrink-0 px-2 py-1"
                >
                  {isExpanded ? "Hide Schema \u25B4" : "Show Schema \u25BE"}
                </button>
              </div>

              {/* Expanded schema */}
              {isExpanded && (
                <div className="mt-3 border-t border-border pt-3">
                  <table className="w-full text-xs font-inconsolata">
                    <thead>
                      <tr className="text-text-dim text-left">
                        <th className="pb-1 pr-4 font-normal tracking-wide uppercase text-[10px]">Column</th>
                        <th className="pb-1 pr-4 font-normal tracking-wide uppercase text-[10px]">Type</th>
                        <th className="pb-1 font-normal tracking-wide uppercase text-[10px]">Nullable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {obj.schema.columns.map((col) => (
                        <tr key={col.jsonPath} className="text-text-dim">
                          <td className="py-0.5 pr-4 text-text">{col.columnName}</td>
                          <td className="py-0.5 pr-4">{col.dataType}</td>
                          <td className="py-0.5">{col.nullable ? "yes" : "no"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {obj.schema.childTables && obj.schema.childTables.length > 0 && (
                    <div className="mt-2">
                      <p className="text-text-dim text-[10px] tracking-wide font-space-grotesk uppercase mb-1">
                        Child Tables
                      </p>
                      {obj.schema.childTables.map((child) => (
                        <div key={child.jsonPath} className="ml-3 mb-1">
                          <span className="text-gold text-xs font-inconsolata">{child.tableName}</span>
                          <span className="text-text-dim text-[10px] ml-2">
                            ({child.columns.length} column{child.columns.length !== 1 ? "s" : ""})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <button type="button" onClick={onBack} className="btn-ghost">
          &#8592; Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={selectedCount === 0}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next &#8594;
        </button>
      </div>
    </div>
  );
}
