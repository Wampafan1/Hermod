"use client";

import { useState, useMemo } from "react";

const CDN = "https://hermodforge.com/illustrations";

// ─── Data ───────────────────────────────────────────

interface Connector {
  name: string;
  realm: string;
  realmLabel: string;
  source: boolean;
  dest: boolean;
  incremental: string | null;
  auth: string;
  features: string;
  comingSoon?: boolean;
}

interface Realm {
  id: string;
  name: string;
  norse: string;
  color: string;
  image: string;
  description: string;
}

const REALMS: Realm[] = [
  { id: "asgard", name: "Databases", norse: "Asgard", color: "#d4af37", image: `${CDN}/asgard-v2.webp`, description: "SQL databases and data warehouses — the foundation of every pipeline." },
  { id: "vanaheim", name: "Excel", norse: "Vanaheim", color: "#4a9fc4", image: `${CDN}/vanaheim-v2.webp`, description: "Formatted workbooks — styled output with frozen panes, number formats, and merged cells." },
  { id: "midgard", name: "FTP / SFTP / Email", norse: "Midgard", color: "#4a9e4e", image: `${CDN}/midgard-v2.webp`, description: "File transfer and email delivery — secure transport across network boundaries." },
  { id: "alfheim", name: "Cloud APIs", norse: "Alfheim", color: "#9a6ab5", image: `${CDN}/alfheim-v2.webp`, description: "REST APIs and SaaS platforms — 15 pre-built connectors plus a universal REST adapter." },
  { id: "jotunheim", name: "CSV & Bulk Data", norse: "J\u00f6tunheim", color: "#8a7060", image: `${CDN}/jotunheim-v2.webp`, description: "Raw flat files — streaming extraction with auto-delimiter and header detection." },
  { id: "muspelheim", name: "Real-time Triggers", norse: "Muspelheim", color: "#c44d1a", image: `${CDN}/muspelheim-v2.webp`, description: "Event-driven pipeline execution — webhooks, database triggers, file watchers." },
  { id: "niflheim", name: "Cold Storage", norse: "Niflheim", color: "#4a9a90", image: `${CDN}/niflheim-v2.webp`, description: "Compressed, encrypted archival to cloud object storage." },
  { id: "helheim", name: "Error Recovery", norse: "Helheim", color: "#5a6a72", image: `${CDN}/helheim-v2.webp`, description: "Dead letter queue with automatic retry, forensic logging, and manual recovery." },
];

const CONNECTORS: Connector[] = [
  // Asgard
  { name: "PostgreSQL", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor", auth: "Connection string", features: "Custom SQL queries, streaming extraction" },
  { name: "SQL Server (MSSQL)", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor, rowversion", auth: "Connection string", features: "Custom SQL queries, streaming extraction" },
  { name: "MySQL", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor", auth: "Connection string", features: "Custom SQL queries, streaming extraction" },
  { name: "BigQuery", realm: "asgard", realmLabel: "Asgard", source: true, dest: true, incremental: "Timestamp, ID cursor", auth: "Service account JSON", features: "MERGE upsert, schema auto-detection, chunked streaming" },
  { name: "NetSuite (SuiteQL)", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp cursor", auth: "Token-based auth", features: "SuiteQL queries, 234+ fields, cursor pagination" },
  // Vanaheim
  { name: "Excel (.xlsx)", realm: "vanaheim", realmLabel: "Vanaheim", source: true, dest: true, incremental: null, auth: "\u2014", features: "AI header detection, multi-sheet, formula extraction, styled output" },
  // Midgard
  { name: "SFTP", realm: "midgard", realmLabel: "Midgard", source: true, dest: true, incremental: null, auth: "Key or password", features: "File pickup, directory watch, PGP ready" },
  { name: "Email (SMTP)", realm: "midgard", realmLabel: "Midgard", source: false, dest: true, incremental: null, auth: "Plain, OAuth2, relay", features: "Formatted report delivery with Excel attachments" },
  // Alfheim — Curated
  { name: "ShipStation", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Orders, Shipments, Products, Warehouses + 12 more" },
  { name: "Shopify", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Orders, Products, Customers" },
  { name: "Stripe", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Charges, Customers, Invoices" },
  { name: "HubSpot", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Bearer token", features: "Contacts, Companies, Deals" },
  { name: "Airtable", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Records (any base/table)" },
  { name: "Monday.com", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Boards, Items" },
  { name: "Jira", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Issues, Projects" },
  { name: "WooCommerce", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Basic auth", features: "Orders, Products, Customers" },
  { name: "ShipBob", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Orders, Products, Inventory" },
  { name: "Cin7", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Products, Sales Orders, Stock" },
  { name: "QuickBooks Online", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Bearer token", features: "Invoices, Customers, Bills, Payments" },
  { name: "Square", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Orders, Payments, Customers, Catalog, Inventory" },
  { name: "Google Sheets", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Google OAuth", features: "Any spreadsheet (read)" },
  { name: "ServiceNow", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Basic auth", features: "CMDB CIs, Incidents, Problems, Changes, Users" },
  { name: "SkuVault", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Custom", features: "Products, Inventory, Warehouses, Purchase Orders" },
  { name: "REST API (Universal)", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Varies", auth: "Any", features: "Any REST endpoint, auto-pagination, rate limits" },
  // Jotunheim
  { name: "CSV", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Auto-delimiter, encoding detection, header detection" },
  { name: "TSV", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Tab-separated, same capabilities as CSV" },
  { name: "Fixed-width", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Positional column parsing", comingSoon: true },
  // Muspelheim
  { name: "Webhook Receiver", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "HMAC / secret", features: "Incoming HTTP POST triggers pipeline", comingSoon: true },
  { name: "Database Trigger", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "pg_notify for PostgreSQL row changes", comingSoon: true },
  { name: "File Watcher", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "SFTP directory polling for new files", comingSoon: true },
  // Niflheim
  { name: "Azure Blob Storage", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "Connection string", features: "Compressed, encrypted archival", comingSoon: true },
  { name: "Amazon S3", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "IAM / access key", features: "Compressed, encrypted archival", comingSoon: true },
  { name: "Local / NAS", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "\u2014", features: "Network file system archival", comingSoon: true },
];

const FILTER_PILLS = [
  { id: "all", label: "All" },
  { id: "asgard", label: "Databases" },
  { id: "vanaheim", label: "Excel" },
  { id: "midgard", label: "FTP/SFTP" },
  { id: "alfheim", label: "Cloud APIs" },
  { id: "jotunheim", label: "CSV/Bulk" },
  { id: "muspelheim", label: "Real-time" },
  { id: "niflheim", label: "Archives" },
  { id: "helheim", label: "Errors" },
];

// ─── Component ──────────────────────────────────────

export function ConnectorGrid() {
  const [search, setSearch] = useState("");
  const [activeRealm, setActiveRealm] = useState("all");

  const filtered = useMemo(() => {
    let result = CONNECTORS;
    if (activeRealm !== "all") {
      result = result.filter((c) => c.realm === activeRealm);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.features.toLowerCase().includes(q) ||
          c.auth.toLowerCase().includes(q)
      );
    }
    return result;
  }, [search, activeRealm]);

  const activeRealms = useMemo(() => {
    const realmIds = new Set(filtered.map((c) => c.realm));
    return REALMS.filter((r) => realmIds.has(r.id));
  }, [filtered]);

  return (
    <>
      {/* Search + Filter bar */}
      <div className="sticky top-[72px] z-40 bg-[#fbf9f6]/95 backdrop-blur-sm border-b border-slate-200 px-8 py-4">
        <div className="max-w-5xl mx-auto">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connectors..."
            className="w-full max-w-xl mx-auto block px-4 py-2.5 border border-slate-300 text-sm font-mono text-[#2a2520] placeholder:text-slate-400 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/30 bg-white mb-4"
          />
          <div className="flex flex-wrap justify-center gap-2">
            {FILTER_PILLS.map((pill) => (
              <button
                key={pill.id}
                onClick={() => setActiveRealm(pill.id)}
                className={`px-3 py-1.5 font-mono text-[10px] font-bold tracking-[0.2em] uppercase border transition-colors ${
                  activeRealm === pill.id
                    ? "bg-[#d4af37] text-white border-[#d4af37]"
                    : "bg-transparent text-slate-500 border-slate-300 hover:border-[#d4af37] hover:text-[#8a6d00]"
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Realm sections */}
      <div className="max-w-5xl mx-auto px-8">
        {activeRealms.map((realm) => {
          const realmConnectors = filtered.filter((c) => c.realm === realm.id);
          if (realmConnectors.length === 0) return null;

          return (
            <section key={realm.id} id={`realm-${realm.id}`} className="py-12 border-b border-slate-200 last:border-b-0">
              {/* Realm header */}
              <div className="flex items-start gap-6 mb-8">
                <div className="w-20 h-20 shrink-0 overflow-hidden" style={{ borderRadius: "8px" }}>
                  <img
                    src={realm.image}
                    alt={realm.norse}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div>
                  <h2 className="font-headline text-2xl font-bold text-[#2a2520] tracking-tight">
                    {realm.name}
                  </h2>
                  <p className="font-mono text-[10px] tracking-[0.3em] uppercase mt-0.5" style={{ color: realm.color }}>
                    {realm.norse}
                  </p>
                  <p className="text-sm text-slate-500 mt-1 leading-relaxed max-w-xl">
                    {realm.description}
                  </p>
                </div>
              </div>

              {/* Nidavellir banner (after Alfheim) */}
              {realm.id === "alfheim" && (
                <div className="mb-8 p-6 border-2 border-[#ffb74d]/30 bg-[#ffb74d]/[0.03]">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#ffb74d] text-lg">&#x2692;</span>
                    <h3 className="font-headline text-lg font-bold text-[#2a2520]">
                      Nidavellir &mdash; The Forge
                    </h3>
                  </div>
                  <p className="text-sm text-slate-500 leading-relaxed mb-3">
                    Not a connector &mdash; the transformation layer between source and destination.
                    Data passes through the Forge to be cleansed, mapped, pivoted, and reshaped.
                    15 transformation types. Freya: manual config. Mj&ouml;lnir: AI-powered.
                  </p>
                  <a href="/forge" className="font-mono text-[11px] font-bold tracking-[0.2em] uppercase text-[#a06800] hover:text-[#d4af37] transition-colors">
                    Learn more about the Forge &rarr;
                  </a>
                </div>
              )}

              {/* Helheim info section */}
              {realm.id === "helheim" && (
                <div className="space-y-2 mb-4">
                  {[
                    "Automatic retry with exponential backoff (up to 3 retries)",
                    "Dead letter queue preserves failed data (gzipped NDJSON)",
                    "Error classification: auth failures, rate limits, schema mismatches",
                    "Forensic logging with full error details",
                    "Manual retry from the Helheim dashboard",
                  ].map((line) => (
                    <p key={line} className="text-sm text-[#4a4035] flex items-start gap-2">
                      <span className="text-[#d4af37] mt-0.5">&#x25C6;</span> {line}
                    </p>
                  ))}
                </div>
              )}

              {/* Connector cards */}
              {realm.id !== "helheim" && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200">
                  {realmConnectors.map((conn) => (
                    <ConnectorCard key={conn.name} connector={conn} realmColor={realm.color} />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-slate-400 text-sm">No connectors match your search.</p>
          </div>
        )}
      </div>

      {/* Capabilities matrix */}
      <section className="py-12 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-headline text-2xl font-bold text-[#2a2520] mb-6 tracking-tight text-center">
            Capabilities Matrix
          </h2>
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full text-sm bg-white">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Connector</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Realm</th>
                  <th className="text-center px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Source</th>
                  <th className="text-center px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Dest</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Incremental</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Auth</th>
                </tr>
              </thead>
              <tbody>
                {CONNECTORS.filter((c) => c.realm !== "helheim").map((conn, i) => {
                  const realm = REALMS.find((r) => r.id === conn.realm);
                  return (
                    <tr key={conn.name} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"} ${conn.comingSoon ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2.5 text-[#2a2520] font-medium">
                        {conn.name}
                        {conn.comingSoon && <span className="ml-2 text-[8px] font-mono tracking-widest uppercase text-[#ffb74d] border border-[#ffb74d]/30 px-1.5 py-0.5">Soon</span>}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: realm?.color }}>{conn.realmLabel}</td>
                      <td className="px-4 py-2.5 text-center">{conn.source ? <span className="text-green-600">&#10003;</span> : <span className="text-slate-300">&mdash;</span>}</td>
                      <td className="px-4 py-2.5 text-center">{conn.dest ? <span className="text-green-600">&#10003;</span> : <span className="text-slate-300">&mdash;</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{conn.incremental ?? <span className="text-slate-300">&mdash;</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{conn.auth}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

// ─── Connector Card ─────────────────────────────────

function ConnectorCard({ connector: c, realmColor }: { connector: Connector; realmColor: string }) {
  return (
    <div className={`bg-white p-5 ${c.comingSoon ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-headline text-[15px] font-bold text-[#2a2520]">{c.name}</h3>
        {c.comingSoon && (
          <span className="text-[8px] font-mono tracking-widest uppercase text-[#ffb74d] border border-[#ffb74d]/30 px-1.5 py-0.5 shrink-0">
            Soon
          </span>
        )}
      </div>

      <div className="flex gap-3 mb-3">
        <span className={`text-[10px] font-mono tracking-wider uppercase ${c.source ? "text-green-600" : "text-slate-300"}`}>
          Source {c.source ? "\u2713" : "\u2014"}
        </span>
        <span className={`text-[10px] font-mono tracking-wider uppercase ${c.dest ? "text-green-600" : "text-slate-300"}`}>
          Destination {c.dest ? "\u2713" : "\u2014"}
        </span>
      </div>

      <div className="space-y-1.5 text-xs text-slate-500">
        <p><span className="text-slate-400 font-mono text-[10px]">Auth:</span> {c.auth}</p>
        {c.incremental && (
          <p><span className="text-slate-400 font-mono text-[10px]">Incremental:</span> {c.incremental}</p>
        )}
        <p className="text-slate-400 leading-relaxed">{c.features}</p>
      </div>

      <div className="mt-3 h-[2px]" style={{ background: `linear-gradient(90deg, ${realmColor}, transparent)` }} />
    </div>
  );
}
