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
  summary: string;
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
  { id: "asgard", name: "Databases", norse: "Asgard", color: "#d4af37", image: `${CDN}/asgard-v2.webp`, description: "SQL databases and data warehouses — the foundation of every delivery." },
  { id: "vanaheim", name: "Excel", norse: "Vanaheim", color: "#4a9fc4", image: `${CDN}/vanaheim-v2.webp`, description: "Formatted workbooks — styled output with frozen panes, number formats, and merged cells." },
  { id: "midgard", name: "FTP / SFTP / Email", norse: "Midgard", color: "#4a9e4e", image: `${CDN}/midgard-v2.webp`, description: "File transfer and email delivery — secure transport across network boundaries." },
  { id: "alfheim", name: "Cloud APIs", norse: "Alfheim", color: "#9a6ab5", image: `${CDN}/alfheim-v2.webp`, description: "REST APIs and SaaS platforms — 15 pre-built connectors plus a universal REST adapter." },
  { id: "jotunheim", name: "CSV & Bulk Data", norse: "J\u00f6tunheim", color: "#8a7060", image: `${CDN}/jotunheim-v2.webp`, description: "Raw flat files — streaming extraction with auto-delimiter and header detection." },
  { id: "muspelheim", name: "Real-time Triggers", norse: "Muspelheim", color: "#c44d1a", image: `${CDN}/muspelheim-v2.webp`, description: "Event-driven delivery — webhooks, database triggers, file watchers." },
  { id: "niflheim", name: "Cold Storage", norse: "Niflheim", color: "#4a9a90", image: `${CDN}/niflheim-v2.webp`, description: "Compressed, encrypted archival to cloud object storage." },
  { id: "helheim", name: "Error Recovery", norse: "Helheim", color: "#5a6a72", image: `${CDN}/helheim-v2.webp`, description: "Failed deliveries get retried automatically. Every error is logged. Nothing gets lost." },
];

const CONNECTORS: Connector[] = [
  // Asgard
  { name: "PostgreSQL", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor", auth: "Connection string", features: "Custom SQL queries, streaming extraction", summary: "Run queries against PostgreSQL and deliver results to Excel, email, SFTP, or another database." },
  { name: "SQL Server (MSSQL)", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor, rowversion", auth: "Connection string", features: "Custom SQL queries, streaming extraction", summary: "Automate SQL Server reports straight to Excel, email, or any destination on a schedule." },
  { name: "MySQL", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp, ID cursor", auth: "Connection string", features: "Custom SQL queries, streaming extraction", summary: "Query MySQL databases and deliver formatted results wherever they need to go." },
  { name: "BigQuery", realm: "asgard", realmLabel: "Asgard", source: true, dest: true, incremental: "Timestamp, ID cursor", auth: "Service account JSON", features: "MERGE upsert, schema auto-detection, chunked streaming", summary: "Pull data from BigQuery or push results back. Ideal for cloud analytics pipelines." },
  { name: "NetSuite (SuiteQL)", realm: "asgard", realmLabel: "Asgard", source: true, dest: false, incremental: "Timestamp cursor", auth: "Token-based auth", features: "SuiteQL queries, 234+ fields, cursor pagination", summary: "Extract data from NetSuite and deliver formatted reports on a schedule." },
  // Vanaheim
  { name: "Excel (.xlsx)", realm: "vanaheim", realmLabel: "Vanaheim", source: true, dest: true, incremental: null, auth: "\u2014", features: "AI header detection, multi-sheet, formula extraction, styled output", summary: "Read from or write to styled Excel workbooks with frozen panes, formulas, and multiple sheets." },
  // Midgard
  { name: "SFTP", realm: "midgard", realmLabel: "Midgard", source: true, dest: true, incremental: null, auth: "Key or password", features: "File pickup, directory watch, PGP ready", summary: "Pick up files from SFTP servers or deliver reports to partner endpoints securely." },
  { name: "Email (SMTP)", realm: "midgard", realmLabel: "Midgard", source: false, dest: true, incremental: null, auth: "Plain, OAuth2, relay", features: "Formatted report delivery with Excel attachments", summary: "Deliver formatted reports with Excel attachments directly to any inbox." },
  // Alfheim — Curated
  { name: "ShipStation", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Orders, Shipments, Products, Warehouses + 12 more", summary: "Pull orders, shipments, and product data from ShipStation on a schedule." },
  { name: "Shopify", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Orders, Products, Customers", summary: "Extract orders, products, and customer data from your Shopify store." },
  { name: "Stripe", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "API Key", features: "Charges, Customers, Invoices", summary: "Pull charges, customers, and invoice data from Stripe automatically." },
  { name: "HubSpot", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Bearer token", features: "Contacts, Companies, Deals", summary: "Extract contacts, companies, and deals from HubSpot on a schedule." },
  { name: "Airtable", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Records (any base/table)", summary: "Pull records from any Airtable base and table." },
  { name: "Monday.com", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Boards, Items", summary: "Extract boards and items from Monday.com." },
  { name: "Jira", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Issues, Projects", summary: "Pull issues and project data from Jira." },
  { name: "WooCommerce", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Basic auth", features: "Orders, Products, Customers", summary: "Extract orders, products, and customers from WooCommerce." },
  { name: "ShipBob", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Orders, Products, Inventory", summary: "Pull orders, products, and inventory data from ShipBob." },
  { name: "Cin7", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Products, Sales Orders, Stock", summary: "Extract products, sales orders, and stock levels from Cin7." },
  { name: "QuickBooks Online", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Timestamp", auth: "Bearer token", features: "Invoices, Customers, Bills, Payments", summary: "Pull invoices, customers, bills, and payments from QuickBooks." },
  { name: "Square", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Bearer token", features: "Orders, Payments, Customers, Catalog, Inventory", summary: "Extract orders, payments, customers, and inventory from Square." },
  { name: "Google Sheets", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Google OAuth", features: "Any spreadsheet (read)", summary: "Read data from any Google Sheets spreadsheet." },
  { name: "ServiceNow", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Basic auth", features: "CMDB CIs, Incidents, Problems, Changes, Users", summary: "Pull CMDB CIs, incidents, problems, changes, and users from ServiceNow." },
  { name: "SkuVault", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: null, auth: "Custom", features: "Products, Inventory, Warehouses, Purchase Orders", summary: "Extract products, inventory, and warehouse data from SkuVault." },
  { name: "REST API (Universal)", realm: "alfheim", realmLabel: "Alfheim", source: true, dest: false, incremental: "Varies", auth: "Any", features: "Any REST endpoint, auto-pagination, rate limits", summary: "Connect to any REST API endpoint. Auto-pagination and rate limit handling included." },
  // Jotunheim
  { name: "CSV", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Auto-delimiter, encoding detection, header detection", summary: "Process CSV files with automatic delimiter and header detection." },
  { name: "TSV", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Tab-separated, same capabilities as CSV", summary: "Process tab-separated files with the same capabilities as CSV." },
  { name: "Fixed-width", realm: "jotunheim", realmLabel: "J\u00f6tunheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "Positional column parsing", summary: "Parse fixed-width positional column files.", comingSoon: true },
  // Muspelheim
  { name: "Webhook Receiver", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "HMAC / secret", features: "Incoming HTTP POST triggers delivery", summary: "Trigger a delivery the moment an incoming HTTP POST arrives.", comingSoon: true },
  { name: "Database Trigger", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "pg_notify for PostgreSQL row changes", summary: "Start a delivery when rows change in PostgreSQL.", comingSoon: true },
  { name: "File Watcher", realm: "muspelheim", realmLabel: "Muspelheim", source: true, dest: false, incremental: null, auth: "\u2014", features: "SFTP directory polling for new files", summary: "Start a delivery when new files appear on an SFTP server.", comingSoon: true },
  // Niflheim
  { name: "Azure Blob Storage", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "Connection string", features: "Compressed, encrypted archival", summary: "Archive data to Azure Blob Storage with compression and encryption.", comingSoon: true },
  { name: "Amazon S3", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "IAM / access key", features: "Compressed, encrypted archival", summary: "Archive data to Amazon S3 with compression and encryption.", comingSoon: true },
  { name: "Local / NAS", realm: "niflheim", realmLabel: "Niflheim", source: false, dest: true, incremental: null, auth: "\u2014", features: "Network file system archival", summary: "Archive data to network file systems and local storage.", comingSoon: true },
];

const FILTER_PILLS = [
  { id: "all", label: "All" },
  { id: "asgard", label: "Databases" },
  { id: "vanaheim", label: "Excel" },
  { id: "midgard", label: "FTP/SFTP" },
  { id: "alfheim", label: "Cloud APIs" },
  { id: "jotunheim", label: "CSV/Bulk" },
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
          c.summary.toLowerCase().includes(q) ||
          c.features.toLowerCase().includes(q) ||
          c.auth.toLowerCase().includes(q)
      );
    }
    return result;
  }, [search, activeRealm]);

  const activeRealms = useMemo(() => {
    const realmIds = new Set(filtered.filter((c) => !c.comingSoon).map((c) => c.realm));
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
            aria-label="Search connectors"
            className="w-full max-w-xl mx-auto block px-4 py-2.5 border border-slate-300 text-sm font-mono text-[#2a2520] placeholder:text-slate-400 focus:outline-none focus:border-[#d4af37] focus:ring-1 focus:ring-[#d4af37]/30 bg-white mb-4"
          />
          <div className="flex flex-wrap justify-center gap-2">
            {FILTER_PILLS.map((pill) => (
              <button
                key={pill.id}
                onClick={() => setActiveRealm(pill.id)}
                aria-pressed={activeRealm === pill.id}
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
          const realmConnectors = filtered.filter((c) => c.realm === realm.id && !c.comingSoon);
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

              {/* Helheim info section */}
              {realm.id === "helheim" && (
                <div className="space-y-2 mb-4">
                  {[
                    "Automatic retry with increasing delays (up to 3 retries)",
                    "Error recovery queue preserves failed data (gzipped NDJSON)",
                    "Error classification: auth failures, rate limits, column mismatches",
                    "Detailed logging with full error context",
                    "Manual retry from the error recovery dashboard",
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
                  {realmConnectors.length % 3 !== 0 && (
                    <div className="hidden lg:flex bg-white/60 p-5 flex-col items-center justify-center text-center border border-dashed border-slate-300">
                      <p className="font-headline text-sm font-bold text-slate-400 mb-2">Need a connector?</p>
                      <p className="text-xs text-slate-400 mb-3">Tell us what you need and we&apos;ll prioritize it.</p>
                      <a
                        href="mailto:support@hermodforge.com?subject=Connector%20Request"
                        className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#d4af37] hover:text-[#a06800] transition-colors"
                      >
                        Request &rarr;
                      </a>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {filtered.filter((c) => !c.comingSoon).length === 0 && (
          <div className="py-20 text-center">
            <p className="text-slate-400 text-sm">No connectors match your search.</p>
          </div>
        )}
      </div>

      {/* Capabilities matrix — available connectors */}
      <section className="py-12 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <h2 id="capabilities-heading" className="font-headline text-2xl font-bold text-[#2a2520] mb-6 tracking-tight text-center">
            Capabilities Matrix
          </h2>
          <div className="overflow-x-auto border border-slate-200">
            <table className="w-full text-sm bg-white" aria-labelledby="capabilities-heading">
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
                {CONNECTORS.filter((c) => c.realm !== "helheim" && !c.comingSoon).map((conn, i) => {
                  const realm = REALMS.find((r) => r.id === conn.realm);
                  return (
                    <tr key={conn.name} className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}>
                      <td className="px-4 py-2.5 text-[#2a2520] font-medium">{conn.name}</td>
                      <td className="px-4 py-2.5" style={{ color: realm?.color }}>{conn.realmLabel}</td>
                      <td className="px-4 py-2.5 text-center">{conn.source ? <span className="text-green-600" role="img" aria-label="Yes">&#10003;</span> : <span className="text-red-300" role="img" aria-label="No">&#10007;</span>}</td>
                      <td className="px-4 py-2.5 text-center">{conn.dest ? <span className="text-green-600">&#10003;</span> : <span className="text-red-300">&#10007;</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{conn.incremental ?? <span className="text-slate-400">N/A</span>}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{conn.auth}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Coming Soon section */}
          {CONNECTORS.some((c) => c.comingSoon) && (
            <div className="mt-10">
              <h3 className="font-headline text-lg font-bold text-[#2a2520] mb-4 tracking-tight text-center">
                On Our Roadmap
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {CONNECTORS.filter((c) => c.comingSoon).map((conn) => {
                  const realm = REALMS.find((r) => r.id === conn.realm);
                  return (
                    <div key={conn.name} className="bg-white/60 border border-slate-200 px-4 py-3">
                      <p className="text-sm font-medium text-slate-400">{conn.name}</p>
                      <p className="font-mono text-[9px] tracking-[0.2em] uppercase mt-0.5" style={{ color: realm?.color, opacity: 0.6 }}>{conn.realmLabel}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Connector Card ─────────────────────────────────

function ConnectorCard({ connector: c, realmColor }: { connector: Connector; realmColor: string }) {
  return (
    <div className="bg-white p-5">
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-headline text-[15px] font-bold text-[#2a2520]">{c.name}</h3>
      </div>

      <div className="flex gap-3 mb-3">
        <span className={`text-[10px] font-mono tracking-wider uppercase ${c.source ? "text-green-600" : "text-red-300"}`}>
          Source {c.source ? "\u2713" : "\u2717"}
        </span>
        <span className={`text-[10px] font-mono tracking-wider uppercase ${c.dest ? "text-green-600" : "text-red-300"}`}>
          Destination {c.dest ? "\u2713" : "\u2717"}
        </span>
      </div>

      <p className="text-sm text-[#4a4035] leading-relaxed mb-3">{c.summary}</p>

      <details className="group">
        <summary className="font-mono text-[10px] tracking-[0.15em] uppercase text-slate-400 cursor-pointer hover:text-[#a06800] transition-colors select-none">
          <span className="group-open:hidden">&#x25B8; </span>
          <span className="hidden group-open:inline">&#x25BE; </span>
          Technical Details
        </summary>
        <div className="mt-2 space-y-1.5 text-xs text-slate-500">
          <p><span className="text-slate-400 font-mono text-[10px]">Auth:</span> {c.auth}</p>
          {c.incremental && (
            <p><span className="text-slate-400 font-mono text-[10px]">Incremental:</span> {c.incremental}</p>
          )}
          <p className="text-slate-400 leading-relaxed">{c.features}</p>
        </div>
      </details>

      <div className="mt-3 h-[2px]" style={{ background: `linear-gradient(90deg, ${realmColor}, transparent)` }} />
    </div>
  );
}
