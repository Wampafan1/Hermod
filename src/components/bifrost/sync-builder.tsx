"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { RoutePreview } from "./route-preview";
import {
  FieldMapper,
  generateMappings,
  type FieldMapping,
} from "./field-mapper";
import { buildSuiteQL } from "@/lib/providers/netsuite.provider";
import { canBeSource, canBeDestination } from "@/lib/providers/capabilities";
import type { ConnectionType } from "@/lib/providers/types";

// ─── Types ──────────────────────────────────────────────

interface DataSourceOption {
  id: string;
  name: string;
  type: string;
}

interface BlueprintOption {
  id: string;
  name: string;
  status: string;
}

interface NetSuiteRecordType {
  name: string;
  href: string;
}

interface NetSuiteField {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
}

// ─── Constants ──────────────────────────────────────────

// Source/dest filtering now uses capability-based helpers from providers/capabilities

const WRITE_DISPOSITIONS = [
  { value: "WRITE_APPEND", label: "Append", desc: "Add rows to existing data" },
  { value: "WRITE_TRUNCATE", label: "Truncate", desc: "Replace all data" },
  { value: "WRITE_EMPTY", label: "Empty Only", desc: "Write if table is empty" },
];

const FREQUENCIES = [
  { value: "", label: "No schedule" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Component ──────────────────────────────────────────

export function SyncBuilder() {
  const router = useRouter();
  const toast = useToast();

  // ── Route identity ──
  const [name, setName] = useState("");

  // ── Source state ──
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState(""); // BigQuery SQL
  const [incrementalKey, setIncrementalKey] = useState("");

  // NetSuite source config
  const [nsRecordType, setNsRecordType] = useState("");
  const [nsFields, setNsFields] = useState<string[]>([]);
  const [nsFilter, setNsFilter] = useState("");
  const [nsRecordTypes, setNsRecordTypes] = useState<NetSuiteRecordType[]>([]);
  const [nsFieldList, setNsFieldList] = useState<NetSuiteField[]>([]);
  const [nsRecordSearch, setNsRecordSearch] = useState("");
  const [nsLoadingRecords, setNsLoadingRecords] = useState(false);
  const [nsLoadingFields, setNsLoadingFields] = useState(false);

  // NetSuite field mapping overrides (preserves user edits to dest column names)
  const [nsDestOverrides, setNsDestOverrides] = useState<Record<string, string>>({});

  // ── Forge state ──
  const [transformEnabled, setTransformEnabled] = useState(false);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);

  // ── Destination state ──
  const [destId, setDestId] = useState("");
  const [destDataset, setDestDataset] = useState("");
  const [destTable, setDestTable] = useState("");
  const [writeDisposition, setWriteDisposition] = useState("WRITE_APPEND");
  const [autoCreateTable, setAutoCreateTable] = useState(true);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);

  // ── Schedule state ──
  const [frequency, setFrequency] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]);
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(1);
  const [timeHour, setTimeHour] = useState(7);
  const [timeMinute, setTimeMinute] = useState(0);
  const [timezone, setTimezone] = useState("America/Chicago");

  // ── Reference data ──
  const [dataSources, setDataSources] = useState<DataSourceOption[]>([]);
  const [blueprints, setBlueprints] = useState<BlueprintOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);

  // ── Derived ──
  const selectedSource = dataSources.find((ds) => ds.id === sourceId);
  const isNetSuiteSource = selectedSource?.type === "NETSUITE";
  const selectedDest = dataSources.find((ds) => ds.id === destId);

  const { sourceSources, destSources } = useMemo(() => {
    const src: DataSourceOption[] = [];
    const dest: DataSourceOption[] = [];
    for (const ds of dataSources) {
      if (canBeSource(ds.type as ConnectionType)) src.push(ds);
      if (canBeDestination(ds.type as ConnectionType)) dest.push(ds);
    }
    return { sourceSources: src, destSources: dest };
  }, [dataSources]);

  const filteredRecordTypes = useMemo(() => {
    if (!nsRecordSearch) return nsRecordTypes;
    const needle = nsRecordSearch.toLowerCase();
    return nsRecordTypes.filter((rt) => rt.name.toLowerCase().includes(needle));
  }, [nsRecordTypes, nsRecordSearch]);

  // O(1) lookup for selected NS fields (used in field picker checkboxes)
  const nsFieldsSet = useMemo(() => new Set(nsFields), [nsFields]);

  // O(1) lookup for NS field metadata (used in derivedFieldMappings)
  const nsFieldMap = useMemo(
    () => new Map(nsFieldList.map((f) => [f.name, f])),
    [nsFieldList]
  );

  const generatedSuiteQL = useMemo(() => {
    if (!isNetSuiteSource || !nsRecordType) return "";
    return buildSuiteQL({
      recordType: nsRecordType,
      fields: nsFields,
      filter: nsFilter.trim() || null,
    });
  }, [isNetSuiteSource, nsRecordType, nsFields, nsFilter]);

  const hasValidSource = isNetSuiteSource
    ? !!nsRecordType && nsFields.length > 0
    : !!query;

  // ── Derive field mappings from NS fields, merging user dest column overrides ──
  const derivedFieldMappings = useMemo(() => {
    if (!isNetSuiteSource || nsFields.length === 0) return [];
    const base = generateMappings(
      nsFields.map((name) => ({
        name,
        type: nsFieldMap.get(name)?.type ?? "STRING",
      }))
    );
    // Merge any user-edited dest column names
    if (Object.keys(nsDestOverrides).length === 0) return base;
    return base.map((m) => ({
      ...m,
      destColumn: nsDestOverrides[m.sourceField] ?? m.destColumn,
    }));
  }, [nsFields, nsFieldMap, isNetSuiteSource, nsDestOverrides]);

  // Merge: use derived for NS, manual state for user edits
  const activeFieldMappings = isNetSuiteSource ? derivedFieldMappings : fieldMappings;

  // ── Fetch reference data ──
  useEffect(() => {
    Promise.all([
      fetch("/api/connections").then((r) => r.json()),
      fetch("/api/mjolnir/blueprints")
        .then((r) => r.json())
        .catch(() => []),
    ])
      .then(([connections, bps]) => {
        setDataSources(connections);
        setBlueprints(
          (bps as BlueprintOption[]).filter(
            (b) => b.status === "VALIDATED" || b.status === "ACTIVE"
          )
        );
      })
      .catch(() => toast.error("Failed to load connections"))
      .finally(() => setLoadingData(false));
  }, []);

  // ── Fetch NS record types ──
  useEffect(() => {
    if (!isNetSuiteSource || !sourceId) {
      setNsRecordTypes([]);
      return;
    }
    setNsLoadingRecords(true);
    fetch(`/api/bifrost/netsuite/record-types?connectionId=${sourceId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNsRecordTypes(data);
      })
      .catch(() => toast.error("Failed to load record types"))
      .finally(() => setNsLoadingRecords(false));
  }, [sourceId, isNetSuiteSource]);

  // ── Fetch NS fields ──
  useEffect(() => {
    if (!isNetSuiteSource || !sourceId || !nsRecordType) {
      setNsFieldList([]);
      return;
    }
    setNsLoadingFields(true);
    fetch(
      `/api/bifrost/netsuite/fields?connectionId=${sourceId}&recordType=${encodeURIComponent(nsRecordType)}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setNsFieldList(data);
          const mandatory = data
            .filter((f: NetSuiteField) => f.mandatory)
            .map((f: NetSuiteField) => f.name);
          setNsFields((prev) => [...new Set([...prev, ...mandatory])]);
        }
      })
      .catch(() => toast.error("Failed to load fields"))
      .finally(() => setNsLoadingFields(false));
  }, [sourceId, isNetSuiteSource, nsRecordType]);

  // ── Save ──
  async function handleSave() {
    setSaving(true);
    try {
      // Build field mapping record
      const fieldMap: Record<string, string> = {};
      for (const m of activeFieldMappings) {
        fieldMap[m.sourceField] = m.destColumn;
      }

      const sourceConfig: Record<string, unknown> = isNetSuiteSource
        ? {
            query: generatedSuiteQL,
            recordType: nsRecordType,
            fields: nsFields,
            ...(nsFilter.trim() && { filter: nsFilter.trim() }),
            ...(incrementalKey && { incrementalKey }),
          }
        : {
            query,
            ...(incrementalKey && { incrementalKey }),
          };

      const payload = {
        name,
        sourceId,
        sourceConfig,
        destId,
        destConfig: {
          dataset: destDataset,
          table: destTable,
          writeDisposition,
          autoCreateTable,
          ...(activeFieldMappings.length > 0 && { fieldMapping: fieldMap }),
        },
        transformEnabled,
        blueprintId: transformEnabled ? blueprintId : null,
        frequency: frequency || null,
        daysOfWeek,
        dayOfMonth,
        timeHour,
        timeMinute,
        timezone,
      };

      const res = await fetch("/api/bifrost/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || result.suggestion || "Save failed");
      }

      toast.success("Route forged");
      router.push("/bifrost");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  function handleNsFieldMappingChange(updated: FieldMapping[]) {
    const overrides: Record<string, string> = {};
    for (const m of updated) {
      overrides[m.sourceField] = m.destColumn;
    }
    setNsDestOverrides((prev) => ({ ...prev, ...overrides }));
  }

  function resetSourceState() {
    setNsRecordType("");
    setNsFields([]);
    setNsFilter("");
    setNsFieldList([]);
    setNsRecordSearch("");
    setNsDestOverrides({});
    setQuery("");
    setFieldMappings([]);
  }

  // ─── Render ───────────────────────────────────────────

  if (loadingData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="heading-norse text-xl">Sync Builder</h1>
          <p className="text-text-dim text-xs tracking-wider mt-1">
            Loading connections...
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-deep p-4 min-h-[300px] animate-pulse">
              <div className="h-4 bg-border/30 w-24 mb-4" />
              <div className="space-y-3">
                <div className="h-8 bg-border/20" />
                <div className="h-8 bg-border/20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Sync Builder</h1>
          <p className="text-text-dim text-xs tracking-wider mt-1">
            Chart a new course through the realms
          </p>
        </div>
        <button
          onClick={() => router.push("/bifrost")}
          className="btn-ghost"
        >
          <span>Back to Routes</span>
        </button>
      </div>

      {/* Route Name */}
      <div>
        <label className="label-norse">Route Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme NetSuite Customer Sync"
          className="input-norse"
        />
      </div>

      {/* ═══ Three-Column Pipeline ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
        {/* ── Source Panel (Alfheim) ── */}
        <PanelCard
          title="Source"
          realm="Alfheim"
          realmColor="#ce93d8"
          rune="ᚨ"
        >
          <div className="space-y-3">
            <div>
              <label className="label-norse">Connection</label>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  resetSourceState();
                }}
                className="select-norse"
              >
                <option value="">Select source...</option>
                {sourceSources.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} ({ds.type})
                  </option>
                ))}
              </select>
            </div>

            {/* BigQuery: SQL textarea */}
            {selectedSource && !isNetSuiteSource && (
              <>
                <div>
                  <label className="label-norse">SQL Query</label>
                  <textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="SELECT * FROM `dataset.table`"
                    rows={8}
                    className="input-norse font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="label-norse">Incremental Key</label>
                  <input
                    type="text"
                    value={incrementalKey}
                    onChange={(e) => setIncrementalKey(e.target.value)}
                    placeholder="updated_at"
                    className="input-norse"
                  />
                </div>
              </>
            )}

            {/* NetSuite: Record browser */}
            {isNetSuiteSource && (
              <>
                {/* Record Type Browser */}
                <div>
                  <label className="label-norse">Record Type</label>
                  {nsLoadingRecords ? (
                    <LoadingText>Loading record types...</LoadingText>
                  ) : nsRecordTypes.length > 0 ? (
                    <>
                      <input
                        type="text"
                        value={nsRecordSearch}
                        onChange={(e) => setNsRecordSearch(e.target.value)}
                        placeholder="Search..."
                        className="input-norse mb-1"
                      />
                      <div className="border border-border max-h-40 overflow-y-auto bg-void/50">
                        {filteredRecordTypes.length === 0 ? (
                          <EmptyText>No matching records</EmptyText>
                        ) : (
                          filteredRecordTypes.map((rt) => (
                            <button
                              key={rt.name}
                              onClick={() => {
                                setNsRecordType(rt.name);
                                setNsFields([]);
                                setNsRecordSearch("");
                              }}
                              aria-pressed={nsRecordType === rt.name}
                              className={`w-full text-left px-3 py-1.5 text-xs tracking-wider border-b border-border/20 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold ${
                                nsRecordType === rt.name
                                  ? "bg-[#ce93d8]/10 text-[#ce93d8]"
                                  : "text-text hover:bg-gold/[0.04]"
                              }`}
                            >
                              {rt.name}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <EmptyText>
                      Select a connection to browse records
                    </EmptyText>
                  )}
                </div>

                {/* Field Picker */}
                {nsRecordType && (
                  <div>
                    <label className="label-norse">
                      Fields — {nsRecordType}
                    </label>
                    {nsLoadingFields ? (
                      <LoadingText>Loading fields...</LoadingText>
                    ) : nsFieldList.length > 0 ? (
                      <>
                        <div className="flex gap-2 mb-1">
                          <MiniBtn
                            onClick={() =>
                              setNsFields(nsFieldList.map((f) => f.name))
                            }
                          >
                            All
                          </MiniBtn>
                          <MiniBtn
                            onClick={() =>
                              setNsFields(
                                nsFieldList
                                  .filter((f) => f.mandatory)
                                  .map((f) => f.name)
                              )
                            }
                          >
                            Required
                          </MiniBtn>
                          <MiniBtn onClick={() => setNsFields([])}>
                            None
                          </MiniBtn>
                        </div>
                        <div className="border border-border max-h-52 overflow-y-auto bg-void/50">
                          {nsFieldList.map((field) => {
                            const checked = nsFieldsSet.has(field.name);
                            const req = !!field.mandatory;
                            return (
                              <label
                                key={field.name}
                                className={`flex items-center gap-2 px-2 py-1 border-b border-border/20 cursor-pointer text-xs transition-colors ${
                                  checked
                                    ? "bg-[#ce93d8]/[0.06]"
                                    : "hover:bg-gold/[0.03]"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={req}
                                  onChange={() => {
                                    if (req) return;
                                    setNsFields((prev) =>
                                      checked
                                        ? prev.filter((f) => f !== field.name)
                                        : [...prev, field.name]
                                    );
                                  }}
                                  className="accent-[#ce93d8]"
                                />
                                <span className="text-text tracking-wider flex-1 truncate">
                                  {field.name}
                                </span>
                                <TypeBadge type={field.type} />
                                {req && (
                                  <span className="text-[0.5rem] text-ember tracking-widest">
                                    REQ
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-text-dim text-[0.55rem] tracking-wider mt-1">
                          {nsFields.length} selected
                        </p>
                      </>
                    ) : (
                      <EmptyText>No fields found</EmptyText>
                    )}
                  </div>
                )}

                {/* Filter */}
                {nsRecordType && (
                  <div>
                    <label className="label-norse">
                      Filter (optional)
                    </label>
                    <input
                      type="text"
                      value={nsFilter}
                      onChange={(e) => setNsFilter(e.target.value)}
                      placeholder="isinactive = 'F'"
                      className="input-norse font-mono text-xs"
                    />
                  </div>
                )}

                {/* Incremental Key */}
                {nsRecordType && (
                  <div>
                    <label className="label-norse">
                      Incremental Key
                    </label>
                    <input
                      type="text"
                      value={incrementalKey}
                      onChange={(e) => setIncrementalKey(e.target.value)}
                      placeholder="lastmodifieddate"
                      className="input-norse"
                    />
                  </div>
                )}

                {/* SuiteQL Preview */}
                {generatedSuiteQL && (
                  <div>
                    <label className="label-norse">
                      Generated SuiteQL
                    </label>
                    <pre className="bg-void border border-border px-2 py-1.5 text-[0.65rem] font-mono text-frost whitespace-pre-wrap break-all leading-relaxed">
                      {generatedSuiteQL}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </PanelCard>

        {/* ── Forge Panel (Nidavellir) ── */}
        <PanelCard
          title="Forge"
          realm="Nidavellir"
          realmColor="#ffb74d"
          rune="ᚾ"
        >
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={transformEnabled}
                onChange={(e) => setTransformEnabled(e.target.checked)}
                className="accent-[#ffb74d]"
              />
              <span className="text-text text-xs tracking-wider">
                Route through the Forge
              </span>
            </label>

            {transformEnabled ? (
              <>
                <p className="text-text-dim text-[0.6rem] tracking-wider leading-relaxed">
                  Data will pass through Nidavellir for transformation before
                  reaching the destination.
                </p>

                <div>
                  <label className="label-norse">Blueprint</label>
                  <select
                    value={blueprintId ?? ""}
                    onChange={(e) => setBlueprintId(e.target.value || null)}
                    className="select-norse"
                  >
                    <option value="">Select a blueprint...</option>
                    {blueprints.map((bp) => (
                      <option key={bp.id} value={bp.id}>
                        {bp.name} ({bp.status})
                      </option>
                    ))}
                  </select>
                  <p className="text-text-dim text-[0.55rem] tracking-wider mt-1">
                    Stateless steps only (rename, filter, calculate)
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center py-8 text-center">
                <span className="text-[#ffb74d]/20 text-4xl font-cinzel mb-3">
                  ᚾ
                </span>
                <p className="text-text-dim text-[0.6rem] tracking-wider leading-relaxed max-w-[200px]">
                  Data flows directly from source to destination without
                  transformation
                </p>
              </div>
            )}
          </div>
        </PanelCard>

        {/* ── Destination Panel (Asgard) ── */}
        <PanelCard
          title="Destination"
          realm="Asgard"
          realmColor="#d4af37"
          rune="ᚷ"
        >
          <div className="space-y-3">
            <div>
              <label className="label-norse">Connection</label>
              <select
                value={destId}
                onChange={(e) => setDestId(e.target.value)}
                className="select-norse"
              >
                <option value="">Select destination...</option>
                {destSources.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name} ({ds.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label-norse">Dataset</label>
                <input
                  type="text"
                  value={destDataset}
                  onChange={(e) => setDestDataset(e.target.value)}
                  placeholder="my_dataset"
                  className="input-norse"
                />
              </div>
              <div>
                <label className="label-norse">Table</label>
                <input
                  type="text"
                  value={destTable}
                  onChange={(e) => setDestTable(e.target.value)}
                  placeholder="my_table"
                  className="input-norse"
                />
              </div>
            </div>

            <div>
              <label className="label-norse">Write Mode</label>
              <div className="flex gap-1">
                {WRITE_DISPOSITIONS.map((wd) => (
                  <button
                    key={wd.value}
                    onClick={() => setWriteDisposition(wd.value)}
                    aria-pressed={writeDisposition === wd.value}
                    className={`flex-1 px-2 py-2 text-[0.55rem] tracking-wider uppercase border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold ${
                      writeDisposition === wd.value
                        ? "border-gold bg-gold/10 text-gold-bright"
                        : "border-border text-text-dim hover:border-gold/30"
                    }`}
                  >
                    {wd.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCreateTable}
                onChange={(e) => setAutoCreateTable(e.target.checked)}
                className="accent-gold"
              />
              <span className="text-text-dim text-xs tracking-wider">
                Auto-create table
              </span>
            </label>

            {/* Field Mapping */}
            {activeFieldMappings.length > 0 && (
              <div>
                <label className="label-norse">Field Mapping</label>
                <FieldMapper
                  fields={activeFieldMappings}
                  onChange={isNetSuiteSource ? handleNsFieldMappingChange : setFieldMappings}
                />
              </div>
            )}
          </div>
        </PanelCard>
      </div>

      {/* ═══ Route Preview ═══ */}
      <RoutePreview
        sourceType={isNetSuiteSource ? "NETSUITE" : "BIGQUERY"}
        sourceName={selectedSource?.name ?? ""}
        destName={selectedDest?.name ?? ""}
        forgeEnabled={transformEnabled}
      />

      {/* ═══ Schedule ═══ */}
      <div className="border border-border bg-deep p-5">
        <h3 className="heading-norse text-xs mb-4 pb-2 border-b border-border">
          Schedule
        </h3>
        <div className="space-y-3">
          <div>
            <label className="label-norse">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="select-norse"
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {frequency && (
            <>
              {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
                <div>
                  <label className="label-norse">Days of Week</label>
                  <div className="flex gap-1">
                    {DAYS.map((day, i) => (
                      <button
                        key={i}
                        onClick={() => toggleDay(i)}
                        aria-pressed={daysOfWeek.includes(i)}
                        className={`px-3 py-2 text-[0.55rem] tracking-wider border cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold ${
                          daysOfWeek.includes(i)
                            ? "border-gold bg-gold/10 text-gold-bright"
                            : "border-border text-text-dim hover:border-gold/30"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
                <div>
                  <label className="label-norse">Day of Month</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={31}
                      value={dayOfMonth ?? 1}
                      onChange={(e) =>
                        setDayOfMonth(Number(e.target.value) || null)
                      }
                      className="input-norse w-20"
                    />
                    <span className="text-text-dim text-[0.55rem] tracking-wider">
                      0 = last day
                    </span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-norse">Hour</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={23}
                    value={timeHour}
                    onChange={(e) => setTimeHour(Number(e.target.value))}
                    className="input-norse"
                  />
                </div>
                <div>
                  <label className="label-norse">Minute</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    value={timeMinute}
                    onChange={(e) => setTimeMinute(Number(e.target.value))}
                    className="input-norse"
                  />
                </div>
                <div>
                  <label className="label-norse">Timezone</label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="input-norse"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ═══ Actions ═══ */}
      <div className="flex justify-end gap-3 pb-12">
        <button
          onClick={() => router.push("/bifrost")}
          className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={
            saving ||
            !name ||
            !sourceId ||
            !hasValidSource ||
            !destId ||
            !destDataset ||
            !destTable
          }
          className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase disabled:opacity-40"
        >
          {saving ? "Forging..." : "Forge Route"}
        </button>
      </div>
    </div>
  );
}

// ─── Shared Sub-Components ────────────────────────────────

function PanelCard({
  title,
  realm,
  realmColor,
  rune,
  children,
}: {
  title: string;
  realm: string;
  realmColor: string;
  rune: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-deep p-4 min-h-[300px]">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-border">
        <span
          className="text-lg font-cinzel"
          style={{ color: `${realmColor}80` }}
        >
          {rune}
        </span>
        <div>
          <h3
            className="text-[0.65rem] tracking-[0.2em] uppercase font-cinzel"
            style={{ color: realmColor }}
          >
            {title}
          </h3>
          <span className="text-[0.5rem] tracking-[0.15em] uppercase text-text-dim">
            {realm}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="text-[0.45rem] tracking-widest uppercase text-text-dim border border-border/40 px-1 py-px">
      {type}
    </span>
  );
}

function MiniBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-[#ce93d8] text-[0.55rem] tracking-widest uppercase hover:text-[#ce93d8]/80 transition-colors cursor-pointer px-2 py-1 min-h-[28px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#ce93d8]"
    >
      {children}
    </button>
  );
}

function LoadingText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-text-dim text-xs tracking-widest py-2">{children}</p>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-text-dim text-xs tracking-wider py-2">{children}</p>
  );
}
