"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { canBeSource, canBeDestination } from "@/lib/providers/capabilities";
import type { ConnectionType } from "@/lib/providers/types";
import { DaySelector } from "@/components/schedule/day-selector";
import { COMMON_TIMEZONES, OTHER_TIMEZONES } from "@/lib/timezones";

interface DataSourceOption {
  id: string;
  name: string;
  type: string;
  folderId?: string | null;
}

interface FolderOption {
  id: string;
  name: string;
  color: string;
  connectionCount: number;
}

interface BlueprintOption {
  id: string;
  name: string;
  status: string;
}

interface NetSuiteRecordType {
  name: string;
  label: string;
  category: string;
}

interface NetSuiteField {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
  isCustom?: boolean;
  isReference?: boolean;
}

interface RouteEditorProps {
  routeId?: string; // undefined = create mode
}

// Source/dest filtering now uses capability-based helpers from providers/capabilities

const WRITE_DISPOSITIONS = [
  { value: "WRITE_APPEND", label: "Append", description: "Add rows to existing data" },
  { value: "WRITE_TRUNCATE", label: "Truncate", description: "Replace all data in table" },
  { value: "WRITE_EMPTY", label: "Empty Only", description: "Only write if table is empty" },
];

const SUB_DAILY = ["EVERY_15_MIN", "EVERY_30_MIN", "HOURLY", "EVERY_4_HOURS", "EVERY_12_HOURS"];

const FREQUENCIES = [
  { value: "", label: "No schedule" },
  { value: "EVERY_15_MIN", label: "Every 15 minutes" },
  { value: "EVERY_30_MIN", label: "Every 30 minutes" },
  { value: "HOURLY", label: "Hourly" },
  { value: "EVERY_4_HOURS", label: "Every 4 hours" },
  { value: "EVERY_12_HOURS", label: "Every 12 hours" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Biweekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
];


export function RouteEditor({ routeId }: RouteEditorProps) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!routeId;

  // Form state
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [incrementalKey, setIncrementalKey] = useState("");

  // NetSuite source config
  const [nsRecordType, setNsRecordType] = useState("");
  const [nsFields, setNsFields] = useState<string[]>([]);
  const [nsReferenceFields, setNsReferenceFields] = useState<string[]>([]);
  const [nsFilter, setNsFilter] = useState("");
  const [nsRecordTypes, setNsRecordTypes] = useState<NetSuiteRecordType[]>([]);
  const [nsFieldList, setNsFieldList] = useState<NetSuiteField[]>([]);
  const [nsRecordSearch, setNsRecordSearch] = useState("");
  const [nsLoadingRecords, setNsLoadingRecords] = useState(false);
  const [nsLoadingFields, setNsLoadingFields] = useState(false);
  const [destId, setDestId] = useState("");
  const [destDataset, setDestDataset] = useState("");
  const [destTable, setDestTable] = useState("");
  const [writeDisposition, setWriteDisposition] = useState("WRITE_APPEND");
  const [autoCreateTable, setAutoCreateTable] = useState(false);
  const [transformEnabled, setTransformEnabled] = useState(false);
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Monday
  const [dayOfMonth, setDayOfMonth] = useState<number | null>(1);
  const [timeHour, setTimeHour] = useState(7);
  const [timeMinute, setTimeMinute] = useState(0);
  const [timezone, setTimezone] = useState("America/Chicago");

  // Preserve cursorConfig across edits (loaded from DB, passed through on save)
  const [cursorConfig, setCursorConfig] = useState<Record<string, unknown> | null>(null);

  // Schema evolution: track original fields + query for change detection
  const originalFieldsRef = useRef<string[] | null>(null);
  const originalQueryRef = useRef<string | null>(null);
  const [showReloadConfirm, setShowReloadConfirm] = useState(false);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);

  // Reference data
  const [dataSources, setDataSources] = useState<DataSourceOption[]>([]);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [destFolderId, setDestFolderId] = useState<string | "">("");
  const [blueprints, setBlueprints] = useState<BlueprintOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Derived: selected source type
  const selectedSource = dataSources.find((ds) => ds.id === sourceId);
  const isNetSuiteSource = selectedSource?.type === "NETSUITE";

  // Derived: generated SuiteQL preview
  const generatedSuiteQL = useMemo(() => {
    if (!isNetSuiteSource || !nsRecordType) return "";
    // Reference fields for BUILTIN.DF() wrapping. Primary source: nsReferenceFields
    // (persisted in sourceConfig, survives page reloads). Fallback: derive from
    // nsFieldList (populated by async catalog fetch). This handles legacy routes
    // that don't have referenceFields saved yet.
    const refFromState = nsReferenceFields.length > 0
      ? nsReferenceFields
      : nsFieldList.filter((f) => f.isReference).map((f) => f.name);
    const refFields = new Set(refFromState.map((f) => f.toLowerCase()));
    const fieldExprs = nsFields.length > 0
      ? nsFields.map((f) => {
          const col = f.toLowerCase();
          return refFields.has(col) ? `BUILTIN.DF(${col}) as ${col}` : col;
        }).join(", ")
      : "*";
    let sql = `SELECT ${fieldExprs} FROM ${nsRecordType}`;
    if (nsFilter.trim()) sql += ` WHERE ${nsFilter.trim()}`;
    sql += " ORDER BY id ASC";
    return sql;
  }, [isNetSuiteSource, nsRecordType, nsFields, nsFilter, nsReferenceFields, nsFieldList]);

  // Fetch NetSuite record types when a NetSuite source is selected
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
      .catch(() => toast.error("Failed to load NetSuite record types"))
      .finally(() => setNsLoadingRecords(false));
  }, [sourceId, isNetSuiteSource]);

  // Fetch NetSuite fields when a record type is selected
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
          // Persist reference field names for BUILTIN.DF() wrapping
          setNsReferenceFields(
            data.filter((f: NetSuiteField) => f.isReference).map((f: NetSuiteField) => f.name)
          );
          // Auto-check mandatory fields
          const mandatory = data
            .filter((f: NetSuiteField) => f.mandatory)
            .map((f: NetSuiteField) => f.name);
          setNsFields((prev) => {
            const merged = new Set([...prev, ...mandatory]);
            return [...merged];
          });
        }
      })
      .catch(() => toast.error("Failed to load record fields"))
      .finally(() => setNsLoadingFields(false));
  }, [sourceId, isNetSuiteSource, nsRecordType]);

  // Load reference data
  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((data) => setDataSources(data))
      .catch(() => toast.error("Failed to load connections"));

    fetch("/api/connection-folders")
      .then((r) => r.json())
      .then((data) => setFolders(data))
      .catch(() => {/* folders are optional */});

    fetch("/api/mjolnir/blueprints")
      .then((r) => r.json())
      .then((data) =>
        setBlueprints(
          (data as BlueprintOption[]).filter(
            (b) => b.status === "VALIDATED" || b.status === "ACTIVE"
          )
        )
      )
      .catch(() => toast.error("Failed to load blueprints"));
  }, []);

  // Load existing route in edit mode
  useEffect(() => {
    if (!routeId) return;
    fetch(`/api/bifrost/routes/${routeId}`)
      .then((r) => r.json())
      .then((route) => {
        setName(route.name);
        setSourceId(route.sourceId);
        const sc = route.sourceConfig as any;
        setQuery(sc?.query ?? "");
        originalQueryRef.current = sc?.query ?? "";
        setIncrementalKey(sc?.incrementalKey ?? "");
        // Restore NetSuite structured config if present
        if (sc?.recordType) setNsRecordType(sc.recordType);
        if (sc?.fields) {
          setNsFields(sc.fields);
          originalFieldsRef.current = [...sc.fields];
        }
        if (sc?.referenceFields) setNsReferenceFields(sc.referenceFields);
        if (sc?.filter) setNsFilter(sc.filter);
        setDestId(route.destId);
        const dc = route.destConfig as any;
        setDestDataset(dc?.dataset ?? "");
        setDestTable(dc?.table ?? "");
        setWriteDisposition(dc?.writeDisposition ?? "WRITE_APPEND");
        setAutoCreateTable(dc?.autoCreateTable ?? false);
        setTransformEnabled(route.transformEnabled);
        setBlueprintId(route.blueprintId);
        setFrequency(route.frequency ?? "");
        setDaysOfWeek(route.daysOfWeek ?? [1]);
        setDayOfMonth(route.dayOfMonth);
        setTimeHour(route.timeHour);
        setTimeMinute(route.timeMinute);
        setTimezone(route.timezone);
        setCursorConfig(route.cursorConfig ?? null);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Failed to load route");
        setLoading(false);
      });
  }, [routeId, toast]);

  function buildPayload(needsFullReload = false): Record<string, unknown> {
    // Build source config — for NetSuite, include structured fields + generated SuiteQL
    const sourceConfig: Record<string, unknown> = isNetSuiteSource
      ? {
          query: generatedSuiteQL,
          recordType: nsRecordType,
          fields: nsFields.map((f) => f.toLowerCase()),
          referenceFields: nsReferenceFields.length > 0
            ? nsReferenceFields
            : nsFieldList.filter((f) => f.isReference).map((f) => f.name),
          ...(nsFilter.trim() && { filter: nsFilter.trim() }),
          ...(incrementalKey && { incrementalKey }),
        }
      : {
          query,
          ...(incrementalKey && { incrementalKey }),
        };

    return {
      name,
      sourceId,
      sourceConfig,
      destId,
      destConfig: {
        dataset: destDataset,
        table: destTable,
        writeDisposition,
        autoCreateTable,
      },
      transformEnabled,
      blueprintId: transformEnabled ? blueprintId : null,
      frequency: frequency || null,
      daysOfWeek,
      dayOfMonth,
      timeHour,
      timeMinute,
      timezone,
      // Preserve existing cursorConfig — editing a route must not destroy
      // incremental sync configuration set during creation or via API.
      ...(cursorConfig !== null && { cursorConfig }),
      ...(needsFullReload && { needsFullReload: true }),
    };
  }

  /** Detect whether NS fields or query changed compared to original saved state. */
  function detectFieldChanges(): { changed: boolean; added: number; removed: number; queryChanged: boolean } {
    if (!originalFieldsRef.current) return { changed: false, added: 0, removed: 0, queryChanged: false };
    const originalSet = new Set(originalFieldsRef.current);
    const currentSet = new Set(nsFields);
    const added = nsFields.filter((f) => !originalSet.has(f)).length;
    const removed = originalFieldsRef.current.filter((f) => !currentSet.has(f)).length;
    const currentQuery = isNetSuiteSource ? generatedSuiteQL : query;
    const queryChanged = originalQueryRef.current !== null && currentQuery !== originalQueryRef.current;
    return { changed: added > 0 || removed > 0 || queryChanged, added, removed, queryChanged };
  }

  async function submitPayload(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      const url = isEdit ? `/api/bifrost/routes/${routeId}` : "/api/bifrost/routes";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || result.suggestion || "Save failed");
      }

      toast.success(isEdit ? "Route updated" : "Route forged");
      router.push("/bifrost");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    // When editing an existing route with NetSuite source, check for field changes
    console.log("[SchemaEvolution] handleSave debug:", {
      isEdit,
      isNetSuiteSource,
      selectedSourceType: selectedSource?.type,
      originalFields: originalFieldsRef.current,
      currentFields: nsFields,
      detection: detectFieldChanges(),
    });
    if (isEdit && isNetSuiteSource) {
      const { changed } = detectFieldChanges();
      if (changed) {
        pendingPayloadRef.current = buildPayload(true);
        setShowReloadConfirm(true);
        return;
      }
    }

    await submitPayload(buildPayload());
  }


  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading...</span>
      </div>
    );
  }

  const sourceSources = dataSources.filter((ds) => canBeSource(ds.type as ConnectionType));
  const allDestSources = dataSources.filter((ds) => canBeDestination(ds.type as ConnectionType));
  const destSources = destFolderId
    ? allDestSources.filter((ds) => ds.folderId === destFolderId)
    : allDestSources;

  // Filtered record types for search
  const filteredRecordTypes = nsRecordSearch
    ? nsRecordTypes.filter((rt) =>
        rt.name.toLowerCase().includes(nsRecordSearch.toLowerCase())
      )
    : nsRecordTypes;

  // Valid source query check
  const hasValidSourceQuery = isNetSuiteSource
    ? !!nsRecordType && nsFields.length > 0
    : !!query;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="heading-norse text-lg mb-8">
        {isEdit ? "Edit Route" : "Forge New Route"}
      </h1>

      {/* Section 1: Identity */}
      <Section title="Route Identity">
        <Label text="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NetSuite Customer Sync"
            className="input-norse"
          />
        </Label>
      </Section>

      {/* Section 2: Source */}
      <Section title="Source Configuration">
        <Label text="Connection">
          <select
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              // Reset NetSuite state when switching source
              setNsRecordType("");
              setNsFields([]);
              setNsFilter("");
              setNsFieldList([]);
              setNsRecordSearch("");
            }}
            className="select-norse"
          >
            <option value="">Select a source connection...</option>
            {sourceSources.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.type})
              </option>
            ))}
          </select>
        </Label>

        {/* BigQuery source: SQL textarea */}
        {selectedSource && !isNetSuiteSource && (
          <>
            <Label text="SQL Query">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SELECT * FROM `dataset.table` WHERE updated_at > @last_run"
                rows={6}
                className="input-norse font-mono text-xs"
              />
            </Label>

            <Label text="Incremental Key (optional)">
              <input
                type="text"
                value={incrementalKey}
                onChange={(e) => setIncrementalKey(e.target.value)}
                placeholder="updated_at"
                className="input-norse"
              />
              <p className="text-text-dim text-[0.6rem] tracking-wider mt-1">
                Column name used as @last_run parameter for incremental loads
              </p>
            </Label>
          </>
        )}

        {/* NetSuite source: Record type browser + field picker */}
        {isNetSuiteSource && (
          <>
            {/* Record Type Browser */}
            <Label text="Record Type">
              {nsLoadingRecords ? (
                <p className="text-text-dim text-xs tracking-widest py-2">
                  Loading record types...
                </p>
              ) : nsRecordTypes.length > 0 ? (
                <div>
                  <input
                    type="text"
                    value={nsRecordSearch}
                    onChange={(e) => setNsRecordSearch(e.target.value)}
                    placeholder="Search record types..."
                    className="input-norse mb-2"
                  />
                  <div className="border border-border max-h-48 overflow-y-auto bg-deep">
                    {filteredRecordTypes.length === 0 ? (
                      <p className="text-text-dim text-xs px-3 py-2 tracking-wider">
                        No matching records
                      </p>
                    ) : (
                      filteredRecordTypes.map((rt) => (
                        <button
                          key={rt.name}
                          onClick={() => {
                            setNsRecordType(rt.name);
                            setNsFields([]);
                            setNsRecordSearch("");
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs tracking-wider border-b border-border/30 transition-colors cursor-pointer ${
                            nsRecordType === rt.name
                              ? "bg-gold/10 text-gold-bright"
                              : "text-text hover:bg-gold/[0.04]"
                          }`}
                        >
                          {rt.name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-text-dim text-xs tracking-wider py-2">
                  Select a NetSuite connection to browse record types
                </p>
              )}
            </Label>

            {/* Field Picker */}
            {nsRecordType && (
              <Label text={`Fields — ${nsRecordType}`}>
                {nsLoadingFields ? (
                  <p className="text-text-dim text-xs tracking-widest py-2">
                    Loading fields...
                  </p>
                ) : nsFieldList.length > 0 ? (
                  <div>
                    <div className="flex gap-3 mb-2">
                      <button
                        onClick={() =>
                          setNsFields(nsFieldList.map((f) => f.name))
                        }
                        className="text-gold text-[0.6rem] tracking-widest uppercase hover:text-gold-bright transition-colors cursor-pointer"
                      >
                        Select All
                      </button>
                      <button
                        onClick={() =>
                          setNsFields(
                            nsFieldList
                              .filter((f) => f.mandatory)
                              .map((f) => f.name)
                          )
                        }
                        className="text-gold text-[0.6rem] tracking-widest uppercase hover:text-gold-bright transition-colors cursor-pointer"
                      >
                        Mandatory Only
                      </button>
                    </div>
                    <div className="border border-border max-h-64 overflow-y-auto bg-deep">
                      {nsFieldList.map((field) => {
                        const checked = nsFields.includes(field.name);
                        const isMandatory = !!field.mandatory;
                        return (
                          <label
                            key={field.name}
                            className={`flex items-center gap-2 px-3 py-1.5 border-b border-border/30 cursor-pointer transition-colors ${
                              checked
                                ? "bg-gold/[0.06]"
                                : "hover:bg-gold/[0.03]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isMandatory}
                              onChange={() => {
                                if (isMandatory) return;
                                setNsFields((prev) =>
                                  checked
                                    ? prev.filter((f) => f !== field.name)
                                    : [...prev, field.name]
                                );
                              }}
                              className="accent-gold"
                            />
                            <span className="text-text text-xs tracking-wider flex-1">
                              {field.name}
                              {field.label && field.label !== field.name && (
                                <span className="text-text-dim ml-2">
                                  {field.label}
                                </span>
                              )}
                            </span>
                            <span className="text-[0.55rem] tracking-widest uppercase text-text-dim border border-border/50 px-1.5 py-0.5">
                              {field.type}
                            </span>
                            {isMandatory && (
                              <span className="text-[0.55rem] tracking-widest uppercase text-ember">
                                req
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-text-dim text-[0.6rem] tracking-wider mt-1">
                      {nsFields.length} field{nsFields.length !== 1 ? "s" : ""}{" "}
                      selected
                    </p>
                  </div>
                ) : (
                  <p className="text-text-dim text-xs tracking-wider py-2">
                    No fields found for this record type
                  </p>
                )}
              </Label>
            )}

            {/* Optional Filter */}
            {nsRecordType && (
              <Label text="Filter (optional)">
                <input
                  type="text"
                  value={nsFilter}
                  onChange={(e) => setNsFilter(e.target.value)}
                  placeholder="isinactive = 'F' AND datecreated > @last_run"
                  className="input-norse font-mono text-xs"
                />
                <p className="text-text-dim text-[0.6rem] tracking-wider mt-1">
                  SuiteQL WHERE clause — use @last_run for incremental loads
                </p>
              </Label>
            )}

            {/* Incremental Key */}
            {nsRecordType && (
              <Label text="Incremental Key (optional)">
                <input
                  type="text"
                  value={incrementalKey}
                  onChange={(e) => setIncrementalKey(e.target.value)}
                  placeholder="lastmodifieddate"
                  className="input-norse"
                />
                <p className="text-text-dim text-[0.6rem] tracking-wider mt-1">
                  Column name used as @last_run parameter for incremental loads
                </p>
              </Label>
            )}

            {/* SuiteQL Preview */}
            {generatedSuiteQL && (
              <div>
                <label className="label-norse">Generated SuiteQL</label>
                <pre className="bg-void border border-border px-3 py-2 text-xs font-mono text-frost whitespace-pre-wrap break-all">
                  {generatedSuiteQL}
                </pre>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Section 3: Destination */}
      <Section title="Destination Configuration">
        {folders.length > 0 && (
          <Label text="Folder">
            <select
              value={destFolderId}
              onChange={(e) => {
                setDestFolderId(e.target.value);
                setDestId(""); // reset connection when folder changes
              }}
              className="select-norse"
            >
              <option value="">All folders</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.connectionCount})
                </option>
              ))}
            </select>
          </Label>
        )}

        <Label text="Connection">
          <select
            value={destId}
            onChange={(e) => setDestId(e.target.value)}
            className="select-norse"
          >
            <option value="">Select a destination connection...</option>
            {destSources.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.name} ({ds.type})
              </option>
            ))}
          </select>
        </Label>

        <div className="grid grid-cols-2 gap-4">
          <Label text="Dataset">
            <input
              type="text"
              value={destDataset}
              onChange={(e) => setDestDataset(e.target.value)}
              placeholder="dest_dataset"
              className="input-norse"
            />
          </Label>
          <Label text="Table">
            <input
              type="text"
              value={destTable}
              onChange={(e) => setDestTable(e.target.value)}
              placeholder="dest_table"
              className="input-norse"
            />
          </Label>
        </div>

        <Label text="Write Disposition">
          <div className="flex gap-2">
            {WRITE_DISPOSITIONS.map((wd) => (
              <button
                key={wd.value}
                onClick={() => setWriteDisposition(wd.value)}
                aria-pressed={writeDisposition === wd.value}
                className={`flex-1 px-3 py-2 text-[0.65rem] tracking-wider uppercase border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold ${
                  writeDisposition === wd.value
                    ? "border-gold bg-gold/10 text-gold-bright"
                    : "border-border text-text-dim hover:border-gold/30"
                }`}
              >
                {wd.label}
              </button>
            ))}
          </div>
        </Label>

        <label className="flex items-center gap-2 cursor-pointer mt-2">
          <input
            type="checkbox"
            checked={autoCreateTable}
            onChange={(e) => setAutoCreateTable(e.target.checked)}
            className="accent-gold"
          />
          <span className="text-text-dim text-xs tracking-wider">
            Auto-create destination table if it doesn't exist
          </span>
        </label>
      </Section>

      {/* Section 4: Transform */}
      <Section title="Nidavellir Forge (Optional)">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={transformEnabled}
            onChange={(e) => setTransformEnabled(e.target.checked)}
            className="accent-gold"
          />
          <span className="text-text text-xs tracking-wider">
            Apply Nidavellir forge transformation
          </span>
        </label>

        {transformEnabled && (
          <Label text="Blueprint">
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
            <p className="text-text-dim text-[0.6rem] tracking-wider mt-1">
              Only stateless steps (rename, filter, calculate) are supported for streaming routes
            </p>
          </Label>
        )}
      </Section>

      {/* Section 5: Schedule */}
      <Section title="Schedule">
        <Label text="Frequency">
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
        </Label>

        {frequency && (
          <>
            {SUB_DAILY.includes(frequency) && (
              <p className="text-text-dim text-[0.6rem] tracking-wider">
                Runs on a fixed interval — no time-of-day configuration needed.
              </p>
            )}

            {(frequency === "WEEKLY" || frequency === "BIWEEKLY") && (
              <Label text="Days of Week">
                <DaySelector selected={daysOfWeek} onChange={setDaysOfWeek} />
              </Label>
            )}

            {(frequency === "MONTHLY" || frequency === "QUARTERLY") && (
              <Label text="Day of Month">
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={dayOfMonth ?? 1}
                  onChange={(e) => setDayOfMonth(Number(e.target.value) || null)}
                  className="input-norse w-24"
                />
                <span className="text-text-dim text-[0.6rem] tracking-wider ml-2">
                  0 = last day of month
                </span>
              </Label>
            )}

            {!SUB_DAILY.includes(frequency) && (
            <div className="grid grid-cols-3 gap-4">
              <Label text="Hour (0-23)">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={timeHour}
                  onChange={(e) => setTimeHour(Number(e.target.value))}
                  className="input-norse"
                />
              </Label>
              <Label text="Minute (0-59)">
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={timeMinute}
                  onChange={(e) => setTimeMinute(Number(e.target.value))}
                  className="input-norse"
                />
              </Label>
              <Label text="Timezone">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="select-norse"
                >
                  <optgroup label="Common">
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, " ")}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="All Timezones">
                    {OTHER_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Label>
            </div>
            )}
          </>
        )}
      </Section>

      {/* Save */}
      <div className="flex justify-end gap-3 mt-8 mb-16">
        <button
          onClick={() => router.push("/bifrost")}
          className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !name || !sourceId || !hasValidSourceQuery || !destId || !destDataset || !destTable}
          className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase disabled:opacity-40"
        >
          {saving ? "Saving..." : isEdit ? "Update Route" : "Forge Route"}
        </button>
      </div>

      {/* Schema evolution confirmation dialog */}
      <ConfirmDialog
        open={showReloadConfirm}
        title="Schema Change Detected"
        message={(() => {
          const { added, removed, queryChanged } = detectFieldChanges();
          const parts: string[] = [];
          if (added > 0) parts.push(`added ${added} field(s)`);
          if (removed > 0) parts.push(`removed ${removed} field(s)`);
          if (queryChanged && parts.length === 0) parts.push("changed the query structure");
          const delta = parts.join(" and ");
          return (
            `You've ${delta}. This requires a full reload of the destination table. ` +
            `The existing data will be dropped and reloaded on the next run. Continue?`
          );
        })()}
        confirmLabel="Continue"
        cancelLabel="Cancel"
        onConfirm={() => {
          setShowReloadConfirm(false);
          if (pendingPayloadRef.current) {
            submitPayload(pendingPayloadRef.current);
            pendingPayloadRef.current = null;
          }
        }}
        onCancel={() => {
          setShowReloadConfirm(false);
          pendingPayloadRef.current = null;
        }}
      />
    </div>
  );
}

// ─── Shared Components ───────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label-norse">{text}</label>
      {children}
    </div>
  );
}
