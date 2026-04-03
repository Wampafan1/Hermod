"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";

/* ═══════════════════════════════════════════════════════════
   SCROLL TRIGGER — plays animation once when element is visible
   ═══════════════════════════════════════════════════════════ */

function useScrollTrigger(threshold = 0.3) {
  const ref = useRef<HTMLDivElement>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTriggered(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, triggered };
}

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, triggered } = useScrollTrigger(0.2);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: triggered ? 1 : 0,
        transform: triggered ? "translateY(0)" : "translateY(32px)",
        transition: `opacity 0.8s cubic-bezier(0.22,1,0.36,1) ${delay}s, transform 0.8s cubic-bezier(0.22,1,0.36,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED MERGE TABLE
   The headline visual — shows rows being inserted, updated, skipped
   ═══════════════════════════════════════════════════════════ */

const MERGE_ROWS = [
  { id: "SHP-4001", dest: "Dallas", status: "Delivered", action: "skip" as const },
  { id: "SHP-4002", dest: "Chicago", status: "In Transit", action: "update" as const },
  { id: "SHP-4003", dest: "Miami", status: "Delivered", action: "skip" as const },
  { id: "SHP-4004", dest: "Seattle", status: "Delivered", action: "skip" as const },
  { id: "SHP-4005", dest: "Denver", status: "Delayed", action: "update" as const },
  { id: "SHP-4006", dest: "Boston", status: "Delivered", action: "skip" as const },
  { id: "SHP-4007", dest: "Austin", status: "Processing", action: "insert" as const },
  { id: "SHP-4008", dest: "Portland", status: "Processing", action: "insert" as const },
  { id: "SHP-4009", dest: "NYC", status: "Delivered", action: "skip" as const },
  { id: "SHP-4010", dest: "Phoenix", status: "Processing", action: "insert" as const },
];

export function AnimatedMergeTable() {
  const { ref, triggered } = useScrollTrigger(0.25);
  const [phase, setPhase] = useState(0);
  // phase 0: neutral, 1: actions revealed, 2: counters visible

  useEffect(() => {
    if (!triggered) return;
    const t1 = setTimeout(() => setPhase(1), 400);
    const t2 = setTimeout(() => setPhase(2), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [triggered]);

  const actionStyles = {
    insert: { bg: "rgba(102,187,106,0.12)", border: "rgba(102,187,106,0.4)", text: "#4caf50", label: "INSERT" },
    update: { bg: "rgba(255,183,77,0.12)", border: "rgba(255,183,77,0.4)", text: "#ffb74d", label: "UPDATE" },
    skip: { bg: "transparent", border: "transparent", text: "#999", label: "—" },
  };

  const insertCount = MERGE_ROWS.filter((r) => r.action === "insert").length;
  const updateCount = MERGE_ROWS.filter((r) => r.action === "update").length;
  const skipCount = MERGE_ROWS.filter((r) => r.action === "skip").length;

  return (
    <div ref={ref} className="max-w-2xl mx-auto mt-10">
      {/* Table */}
      <div className="border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[100px_1fr_1fr_90px] bg-slate-50 border-b border-slate-200">
          {["SHIPMENT", "DESTINATION", "STATUS", "ACTION"].map((h) => (
            <div
              key={h}
              className="px-4 py-2 font-mono text-[9px] font-bold tracking-[0.2em] text-slate-400"
            >
              {h}
            </div>
          ))}
        </div>

        {/* Rows */}
        {MERGE_ROWS.map((row, i) => {
          const style = actionStyles[row.action];
          const isRevealed = phase >= 1;
          const rowDelay = i * 0.06;

          return (
            <div
              key={row.id}
              className="grid grid-cols-[100px_1fr_1fr_90px] border-b border-slate-100 last:border-b-0"
              style={{
                backgroundColor: isRevealed ? style.bg : "transparent",
                borderLeft: isRevealed ? `3px solid ${style.border}` : "3px solid transparent",
                transition: `background-color 0.5s ease ${rowDelay}s, border-color 0.5s ease ${rowDelay}s`,
              }}
            >
              <div className="px-4 py-2.5 font-mono text-xs text-[#2a2520]">{row.id}</div>
              <div className="px-4 py-2.5 text-sm text-[#4a4035]">{row.dest}</div>
              <div className="px-4 py-2.5 text-sm text-[#4a4035]">{row.status}</div>
              <div className="px-4 py-2.5 font-mono text-[10px] font-bold tracking-[0.15em]">
                <span
                  style={{
                    color: isRevealed ? style.text : "transparent",
                    transition: `color 0.5s ease ${rowDelay + 0.1}s`,
                  }}
                >
                  {style.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Counters */}
      <div
        className="flex justify-center gap-8 mt-6"
        style={{
          opacity: phase >= 2 ? 1 : 0,
          transform: phase >= 2 ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        <div className="text-center">
          <div className="font-mono text-2xl font-black text-[#4caf50]">{insertCount}</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase">Inserted</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-2xl font-black text-[#ffb74d]">{updateCount}</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase">Updated</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-2xl font-black text-slate-400">{skipCount}</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-slate-400 uppercase">Untouched</div>
        </div>
      </div>

      <p
        className="text-center text-xs mt-4 font-medium"
        style={{
          color: phase >= 2 ? "#ffb74d" : "transparent",
          transition: "color 0.6s ease 0.3s",
        }}
      >
        No duplicates. No data loss. Corrections merge cleanly.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED SCHEMA CLEANUP
   Real screenshot with animated overlay annotations
   ═══════════════════════════════════════════════════════════ */

/* Row positions as percentages of the image height — approximate based on the screenshot.
   These mark where junk rows, header row, and data rows are in the before-gl.webp image.
   Adjust these values if the screenshot crops differently. */
const ROW_OVERLAYS = [
  { top: "4.7%",  height: "4%",  type: "junk" as const, label: "Title row" },
  { top: "8.8%", height: "3.3%",  type: "junk" as const, label: "Report subtitle" },
  { top: "12.11%", height: "3.5%",  type: "junk" as const, label: "Metadata" },
  { top: "15.62%", height: "3.5%",  type: "junk" as const, label: "Blank" },
  { top: "19.12%", height: "3.5%",  type: "junk" as const, label: "Blank" },
  { top: "22.8%", height: "3.3%",  type: "header" as const, label: "Headers detected" },
  { top: "89.4%", height: "3.35%", type: "junk" as const, label: "Blank" },
  { top: "92.5%", height: "3.4%",  type: "junk" as const, label: "Totals" },
  { top: "96%",   height: "4%",    type: "junk" as const, label: "Footer" },
];

const DETECTED_TYPES_V2 = [
  { label: "INTEGER", desc: "GL Code" },
  { label: "STRING", desc: "Description" },
  { label: "STRING", desc: "Dept Code" },
  { label: "STRING", desc: "Reference" },
  { label: "TIMESTAMP", desc: "6 date formats" },
  { label: "FLOAT", desc: "Debits" },
  { label: "FLOAT", desc: "Credits" },
  { label: "STRING", desc: "Memo" },
];

export function AnimatedSchemaCleanup() {
  const { ref, triggered } = useScrollTrigger(0.15);
  const [phase, setPhase] = useState(0);
  // 0: raw screenshot, 1: junk rows get red overlay + header gets gold, 2: type badges + stats

  useEffect(() => {
    if (!triggered) return;
    const t1 = setTimeout(() => setPhase(1), 600);
    const t2 = setTimeout(() => setPhase(2), 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [triggered]);

  return (
    <div ref={ref} className="max-w-4xl mx-auto mt-10">
      {/* Screenshot with overlays */}
      <div className="relative border border-slate-300 overflow-hidden">
        <img
          src="https://hermodforge.com/illustrations/before-gl.webp"
          alt="Messy GL export with title rows, mixed date formats, raw codes"
          className="w-full h-auto block"
          loading="lazy"
        />

        {/* Animated overlays on top of the screenshot */}
        {ROW_OVERLAYS.map((row, i) => {
          const isJunk = row.type === "junk";
          const isHeader = row.type === "header";
          const delay = i * 0.08;

          return (
            <div
              key={i}
              className="absolute left-0 right-0 flex items-center"
              style={{
                top: row.top,
                height: row.height,
                backgroundColor: phase >= 1
                  ? isJunk
                    ? "rgba(239,83,80,0.18)"
                    : isHeader
                      ? "rgba(255,183,77,0.15)"
                      : "transparent"
                  : "transparent",
                borderLeft: phase >= 1
                  ? isJunk
                    ? "3px solid rgba(239,83,80,0.7)"
                    : isHeader
                      ? "3px solid rgba(255,183,77,0.9)"
                      : "none"
                  : "none",
                transition: `background-color 0.5s ease ${delay}s, border-color 0.5s ease ${delay}s`,
              }}
            >
              {/* Label that appears on the right side */}
              <span
                className="absolute right-2 font-mono text-[8px] font-bold tracking-wider px-1.5 py-0"
                style={{
                  opacity: phase >= 1 ? 1 : 0,
                  color: isJunk ? "#ef5350" : "#ffb74d",
                  backgroundColor: isJunk ? "rgba(239,83,80,0.1)" : "rgba(255,183,77,0.1)",
                  border: `1px solid ${isJunk ? "rgba(239,83,80,0.3)" : "rgba(255,183,77,0.3)"}`,
                  transition: `opacity 0.4s ease ${delay + 0.2}s`,
                }}
              >
                {isJunk ? "✕ " : "✓ "}{row.label}
              </span>

              {/* Strikethrough line for junk rows */}
              {isJunk && (
                <div
                  className="absolute left-0 top-1/2 h-[1px] bg-red-400/40"
                  style={{
                    width: phase >= 1 ? "85%" : "0%",
                    transition: `width 0.6s ease ${delay}s`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Detected types row */}
      <div
        className="grid grid-cols-4 md:grid-cols-8 gap-2 mt-4"
        style={{
          opacity: phase >= 2 ? 1 : 0,
          transform: phase >= 2 ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        {DETECTED_TYPES_V2.map((t, i) => (
          <div
            key={i}
            className="text-center"
            style={{
              opacity: phase >= 2 ? 1 : 0,
              transition: `opacity 0.4s ease ${i * 0.08}s`,
            }}
          >
            <span className="block px-2 py-1 text-[10px] font-mono font-bold tracking-wider border border-[#ffb74d]/30 text-[#ffb74d] bg-[#ffb74d]/5">
              {t.label}
            </span>
            <span className="block text-[9px] text-slate-400 mt-1 font-mono">{t.desc}</span>
          </div>
        ))}
      </div>

      {/* Stats summary */}
      <div
        className="flex justify-center gap-8 mt-6"
        style={{
          opacity: phase >= 2 ? 1 : 0,
          transition: "opacity 0.6s ease 0.4s",
        }}
      >
        <div className="text-center">
          <div className="font-mono text-xl font-black text-[#ef5350]">8</div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-slate-400 uppercase">Junk rows removed</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-xl font-black text-[#ffb74d]">1</div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-slate-400 uppercase">Header row found</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-xl font-black text-[#42a5f5]">6</div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-slate-400 uppercase">Date formats detected</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-xl font-black text-[#66bb6a]">8</div>
          <div className="font-mono text-[9px] tracking-[0.2em] text-slate-400 uppercase">Column types inferred</div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED COST CHART
   Competitor cost grows, Mjölnir stays flat
   ═══════════════════════════════════════════════════════════ */

const MONTHS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"];
const COMPETITOR_HEIGHTS = [8, 15, 22, 30, 38, 46, 54, 61, 68, 75, 82, 92];
const MJOLNIR_HEIGHT = 10;

export function AnimatedCostChart() {
  const { ref, triggered } = useScrollTrigger(0.3);

  return (
    <div ref={ref} className="max-w-lg mx-auto mt-10">
      <div className="flex items-end gap-2 h-40 mb-4">
        {MONTHS.map((m, i) => (
          <div key={m} className="flex-1 flex flex-col items-center justify-end h-full">
            <div className="w-full flex gap-[2px] items-end h-full">
              {/* Competitor bar */}
              <div
                className="flex-1 bg-slate-300"
                style={{
                  height: triggered ? `${COMPETITOR_HEIGHTS[i]}%` : "0%",
                  transition: `height 1.2s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s`,
                }}
              />
              {/* Mjölnir bar */}
              <div
                className="flex-1 bg-[#ffb74d]"
                style={{
                  height: triggered ? `${MJOLNIR_HEIGHT}%` : "0%",
                  transition: `height 0.8s cubic-bezier(0.22,1,0.36,1) ${i * 0.08 + 0.1}s`,
                }}
              />
            </div>
            <span className="font-mono text-[7px] tracking-widest text-slate-400 mt-1">{m}</span>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-8">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-slate-300" />
          <span className="font-mono text-[9px] tracking-[0.2em] text-slate-500 uppercase">
            AI-per-run tools
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-[#ffb74d]" />
          <span className="font-mono text-[9px] tracking-[0.2em] text-slate-500 uppercase">
            Mjölnir
          </span>
        </div>
      </div>

      {/* Punchline */}
      <p
        className="text-center mt-6 text-sm text-slate-500"
        style={{
          opacity: triggered ? 1 : 0,
          transition: "opacity 0.8s ease 1.4s",
        }}
      >
        10 pipelines × 365 days × $0.00 per run ={" "}
        <strong className="text-[#2a2520]">$0.00 in AI costs</strong>
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED BLUEPRINT FLOW
   Real screenshots — BEFORE messy GL export → AI Forge → AFTER clean report
   ═══════════════════════════════════════════════════════════ */

const BLUEPRINT_ANNOTATIONS = [
  { text: "Title rows removed", color: "#ef5350" },
  { text: "Headers renamed", color: "#ffb74d" },
  { text: "6 date formats → ISO", color: "#42a5f5" },
  { text: "Dept codes → names", color: "#ce93d8" },
  { text: "Currency formatted", color: "#66bb6a" },
  { text: "Returns row filtered", color: "#ef5350" },
  { text: "Net Amount calculated", color: "#ffb74d" },
  { text: "Category assigned", color: "#ce93d8" },
];

export function AnimatedBlueprintFlow() {
  const { ref, triggered } = useScrollTrigger(0.15);
  const [phase, setPhase] = useState(0);
  // 0: before visible, 1: forge scans, 2: after appears, 3: annotations, 4: punchline

  useEffect(() => {
    if (!triggered) return;
    const t1 = setTimeout(() => setPhase(1), 600);
    const t2 = setTimeout(() => setPhase(2), 1800);
    const t3 = setTimeout(() => setPhase(3), 2800);
    const t4 = setTimeout(() => setPhase(4), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [triggered]);

  return (
    <div ref={ref} className="max-w-6xl mx-auto mt-10">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_64px_1fr] gap-4 items-center">

        {/* ── BEFORE SCREENSHOT ── */}
        <div
          style={{
            opacity: triggered ? 1 : 0,
            transform: triggered ? "translateY(0)" : "translateY(24px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <div className="font-mono text-[9px] font-bold tracking-[0.3em] text-slate-400 uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-slate-400/50" />
            Raw ERP Export
          </div>
          <div
            className="border border-slate-300 overflow-hidden"
            style={{
              opacity: phase >= 2 ? 0.5 : 1,
              transition: "opacity 0.8s ease",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://hermodforge.com/illustrations/before-gl.webp"
              alt="Messy GL export with title rows, inconsistent dates, raw codes"
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
          <div className="font-mono text-[10px] text-slate-400 mt-2">
            18 rows · 6 date formats · raw dept codes · title junk · subtotals
          </div>
        </div>

        {/* ── FORGE ICON ── */}
        <div className="flex flex-col items-center justify-center gap-2">
          <div
            className="text-3xl"
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transform: phase >= 1 ? "scale(1) rotate(0deg)" : "scale(0.3) rotate(-20deg)",
              transition: "all 0.6s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            ⚒
          </div>
          {/* Scanning line */}
          {phase >= 1 && phase < 2 && (
            <div className="w-10 h-[2px] overflow-hidden">
              <div
                className="h-full bg-[#ffb74d]"
                style={{ animation: "forgeScan 0.8s ease-in-out infinite alternate" }}
              />
              <style>{`@keyframes forgeScan { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
            </div>
          )}
          <div
            className="font-mono text-[7px] tracking-[0.3em] text-[#ffb74d] uppercase font-bold whitespace-nowrap"
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transition: "opacity 0.4s ease 0.3s",
            }}
          >
            {phase < 2 ? "Analyzing..." : "Forged ✓"}
          </div>
          {/* Vertical line connecting the two */}
          <div className="hidden md:block w-[2px] h-8">
            <div
              className="w-full bg-[#ffb74d]"
              style={{
                height: phase >= 1 ? "100%" : "0%",
                transition: "height 0.6s ease 0.2s",
              }}
            />
          </div>
        </div>

        {/* ── AFTER SCREENSHOT ── */}
        <div
          style={{
            opacity: phase >= 2 ? 1 : 0,
            transform: phase >= 2 ? "translateX(0)" : "translateX(30px)",
            transition: "opacity 0.8s cubic-bezier(0.22,1,0.36,1), transform 0.8s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <div className="font-mono text-[9px] font-bold tracking-[0.3em] text-[#ffb74d] uppercase mb-2 flex items-center gap-2">
            <span className="w-2 h-2 bg-[#ffb74d]" />
            Board-Ready Report
          </div>
          <div className="border-2 border-[#ffb74d] overflow-hidden shadow-[0_0_30px_rgba(255,183,77,0.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://hermodforge.com/illustrations/after-gl.webp"
              alt="Clean board-ready report with formatted currency, ISO dates, department names"
              className="w-full h-auto block"
              loading="lazy"
            />
          </div>
          <div className="font-mono text-[10px] text-[#ffb74d] mt-2">
            17 rows · ISO dates · names not codes · formatted · calculated · filtered
          </div>
        </div>
      </div>

      {/* ── TRANSFORMATION ANNOTATIONS ── */}
      <div
        className="flex flex-wrap justify-center gap-2 mt-8"
        style={{
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? "translateY(0)" : "translateY(12px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        {BLUEPRINT_ANNOTATIONS.map((a, i) => (
          <span
            key={a.text}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 border text-[9px] font-mono tracking-wider"
            style={{
              borderColor: `${a.color}40`,
              color: a.color,
              backgroundColor: `${a.color}08`,
              opacity: phase >= 3 ? 1 : 0,
              transition: `opacity 0.4s ease ${i * 0.08}s`,
            }}
          >
            <span className="w-1.5 h-1.5 shrink-0" style={{ backgroundColor: a.color }} />
            {a.text}
          </span>
        ))}
      </div>

      {/* Punchline */}
      <p
        className="text-center text-xs font-medium mt-6"
        style={{
          color: phase >= 4 ? "#ffb74d" : "transparent",
          transition: "color 0.6s ease",
        }}
      >
        AI learned 8 transformations from two files. Every future GL export runs through this blueprint — zero AI cost.
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ANIMATED API DISCOVERY
   URL → endpoints cascade in → schemas resolve
   ═══════════════════════════════════════════════════════════ */

const DISCOVERED_ENDPOINTS = [
  { path: "/api/v3/ticker/24hr", name: "24h Price Ticker", cols: 18 },
  { path: "/api/v3/exchangeInfo", name: "Exchange Info", cols: 12 },
  { path: "/api/v3/klines", name: "Candlestick Data", cols: 11 },
  { path: "/api/v3/trades", name: "Recent Trades", cols: 7 },
  { path: "/api/v3/account", name: "Account Info", cols: 9 },
];

export function AnimatedApiDiscovery() {
  const { ref, triggered } = useScrollTrigger(0.25);
  const [visibleCount, setVisibleCount] = useState(0);
  const [showSchema, setShowSchema] = useState(false);

  useEffect(() => {
    if (!triggered) return;
    // Cascade endpoints in one by one
    const timers: ReturnType<typeof setTimeout>[] = [];
    DISCOVERED_ENDPOINTS.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleCount(i + 1), 600 + i * 300));
    });
    timers.push(
      setTimeout(() => setShowSchema(true), 600 + DISCOVERED_ENDPOINTS.length * 300 + 400),
    );
    return () => timers.forEach(clearTimeout);
  }, [triggered]);

  return (
    <div ref={ref} className="max-w-xl mx-auto mt-10">
      {/* URL Input mock */}
      <div className="border border-slate-300 bg-white px-4 py-3 flex items-center gap-3">
        <span className="font-mono text-[10px] text-slate-400 tracking-wider shrink-0">URL</span>
        <span
          className="font-mono text-sm text-[#2a2520]"
          style={{
            opacity: triggered ? 1 : 0,
            transition: "opacity 0.5s ease 0.2s",
          }}
        >
          https://api.binance.com/api/v3
        </span>
        <span
          className="ml-auto font-mono text-[9px] tracking-[0.2em] text-[#ffb74d] uppercase font-bold"
          style={{
            opacity: triggered ? 1 : 0,
            transition: "opacity 0.5s ease 0.4s",
          }}
        >
          ✦ Discovering...
        </span>
      </div>

      {/* Discovered endpoints */}
      <div className="mt-3 space-y-1.5">
        {DISCOVERED_ENDPOINTS.map((ep, i) => (
          <div
            key={ep.path}
            className="border border-slate-200 bg-white px-4 py-2.5 flex items-center gap-4"
            style={{
              opacity: i < visibleCount ? 1 : 0,
              transform: i < visibleCount ? "translateX(0)" : "translateX(-20px)",
              transition: "opacity 0.4s ease, transform 0.4s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <span className="font-mono text-[11px] text-[#2a2520] flex-1">{ep.path}</span>
            <span className="text-[11px] text-slate-500">{ep.name}</span>
            <span
              className="font-mono text-[9px] tracking-wider text-[#ffb74d] font-bold"
              style={{
                opacity: showSchema ? 1 : 0,
                transition: `opacity 0.4s ease ${i * 0.1}s`,
              }}
            >
              {ep.cols} cols ✓
            </span>
          </div>
        ))}
      </div>

      {/* Result text */}
      <p
        className="text-center text-xs font-medium mt-4"
        style={{
          color: showSchema ? "#ffb74d" : "transparent",
          transition: "color 0.6s ease 0.3s",
        }}
      >
        5 endpoints discovered · 57 columns mapped · Save to catalog →
      </p>
    </div>
  );
}
