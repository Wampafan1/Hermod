/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useRef } from "react";
import { NavBar } from "@/components/marketing/nav-bar";

const CDN = "https://hermodforge.com/illustrations";

const INTEGRATIONS = [
  "PostgreSQL", "SQL Server", "MySQL", "BigQuery", "NetSuite", "SharePoint", "Excel",
  "SFTP", "REST APIs", "CSV", "Webhooks", "Azure Blob", "S3", "Gmail", "OneDrive",
];

const REALMS = [
  { primary: "Databases & SQL", norse: "Asgard", img: `${CDN}/asgard-v2.webp`, color: "border-realm-asgard", desc: "PostgreSQL, SQL Server, MySQL, BigQuery, NetSuite. Query with SQL. Read and write." },
  { primary: "Excel & Formatted Workbooks", norse: "Vanaheim", img: `${CDN}/vanaheim-v2.webp`, color: "border-realm-vanaheim", desc: "Styled .xlsx with frozen panes, auto-fit columns, multi-sheet workbooks, and conditional formatting." },
  { primary: "FTP / SFTP / Email", norse: "Midgard", img: `${CDN}/midgard-v2.webp`, color: "border-realm-midgard", desc: "Gmail API, SMTP, SFTP endpoints. Deliver from your own email address. Watch directories for inbound files." },
  { primary: "Cloud APIs & SharePoint", norse: "Alfheim", img: `${CDN}/alfheim-v2.webp`, color: "border-realm-alfheim", desc: "REST APIs, SharePoint Online, OneDrive, S3. Secure, one-click connections to your cloud services." },
  { primary: "CSV & Bulk Data", norse: "J\u00f6tunheim", img: `${CDN}/jotunheim-v2.webp`, color: "border-realm-jotunheim", desc: "Large CSV and text files \u2014 even millions of rows \u2014 processed reliably every time." },
  { primary: "Instant Triggers", norse: "Muspelheim", img: `${CDN}/muspelheim-v2.webp`, color: "border-realm-muspelheim", desc: "Deliver data the moment it changes \u2014 when new records appear, files arrive, or another system sends a signal." },
  { primary: "Cold Storage & Archives", norse: "Niflheim", img: `${CDN}/niflheim-v2.webp`, color: "border-realm-niflheim", desc: "Long-term storage. Compress and archive data to Azure, S3, or your own network drives." },
  { primary: "Error Recovery", norse: "Helheim", img: `${CDN}/helheim-v2.webp`, color: "border-realm-helheim", desc: "Failed deliveries get retried automatically. Every error is logged. Nothing gets lost." },
];

export default function LandingPage() {
  const heroRef = useRef<HTMLElement>(null);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolledPastHero(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page font-body selection:bg-[#ffdea4] selection:text-[#261900]">
      {/* --- Sticky CTA Bar (Change 14) --- */}
      <div
        className="fixed top-0 left-0 right-0 h-12 flex items-center justify-between px-6 z-[100] border-b border-[#d4af37]/10"
        style={{
          background: "rgba(252,250,245,0.95)",
          backdropFilter: "blur(8px)",
          transform: scrolledPastHero ? "translateY(0)" : "translateY(-100%)",
          transition: "transform 0.3s ease",
        }}
      >
        <span className="font-headline text-sm font-bold tracking-[0.25em] text-[#1a1a1a]">HERMOD</span>
        <a href="/login" className="px-5 py-1.5 bg-[#d4af37] text-[#0a0b0f] font-headline text-[11px] font-semibold tracking-[0.15em] uppercase hover:bg-[#c4962a] transition-colors">
          Start Free
        </a>
      </div>

      {/* --- Top Navigation --- */}
      <NavBar anchorPrefix="#" scrolledPastHero={scrolledPastHero} />

      {/* --- Hero --- */}
      <section ref={heroRef} className="relative pt-28 pb-16 px-8 md:px-16 max-w-7xl mx-auto min-h-[85vh] flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center w-full">
          <div className="fade-up" style={{ animationDelay: "0.2s" }}>
            <p className="font-mono text-lp-primary text-[10px] font-bold tracking-[0.4em] mb-6 uppercase">
              Your Reports, On Autopilot
            </p>
            <h1 className="font-headline text-4xl md:text-6xl leading-[1.1] font-black mb-8 tracking-tighter">
              The Messenger Between Your Data and the People Who Need It.
            </h1>
            <p className="text-on-surface-variant text-[17px] leading-[1.7] mb-4 max-w-lg">
              Hermod connects your databases, spreadsheets, and APIs to the people who need them &mdash; formatted the way they expect, delivered on the schedule they depend on.
            </p>
            <p className="text-on-surface-variant text-[17px] leading-[1.7] mb-10 max-w-lg">
              SQL Server, PostgreSQL, MySQL, BigQuery, NetSuite, Excel, SFTP, SharePoint, REST APIs &mdash; if your data lives there, Hermod delivers it.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a href="/login" className="px-10 py-4 bg-lp-primary text-on-primary font-mono text-sm font-bold tracking-widest hover:bg-primary-container transition-all uppercase text-center">Start Free</a>
              <a href="#how-it-works" className="px-10 py-4 border border-outline text-lp-primary font-mono text-sm font-bold tracking-widest hover:bg-[#f5f3f0] transition-all uppercase text-center">See How It Works</a>
            </div>
            <p className="mt-6 text-on-surface-variant/60 text-sm italic max-w-lg">
              Built by someone who got tired of building the same custom delivery scripts for every company.
            </p>
          </div>
          <div className="fade-up relative" style={{ animationDelay: "0.4s" }}>
            <div className="bg-white p-1 border border-outline-variant/30 shadow-2xl rounded-[5px]">
              <img className="w-full rounded-[4px]" alt="Sunlit artisan forge workshop with golden light and data streams" src={`${CDN}/hero-forge.webp`} />
            </div>
            <div className="absolute -bottom-6 right-0 left-0 sm:left-auto sm:w-80 bg-[#e4e2df] border border-outline-variant/50 p-4 font-mono text-[10px] tracking-wider text-on-surface-variant flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[#7a5ca0]">&quot;schedule&quot;:</span>
                <span className="text-[#3a7ca5]">&quot;every monday 7:00am&quot;</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4a9e4e]" />
                <span className="uppercase font-bold">active</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Trust Banner (Change 6) --- */}
      <section className="py-8 border-y border-outline-variant/20 bg-[rgba(0,0,0,0.015)]">
        <div className="max-w-5xl mx-auto px-8">
          <p className="font-mono text-[10px] tracking-[0.3em] text-[rgba(120,100,70,0.4)] uppercase text-center mb-4">
            Forging Connections Between
          </p>
          <p className="text-center font-mono text-[11px] tracking-[0.08em] text-on-surface-variant/60 leading-[2.2] flex flex-wrap justify-center gap-x-1">
            {INTEGRATIONS.map((name, i) => (
              <span key={name}>
                {name}{i < INTEGRATIONS.length - 1 && <span className="mx-1.5 text-outline-variant/40">&middot;</span>}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* --- Setup vs Every Run --- */}
      <section className="py-16 px-8 md:px-16 max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <p className="font-mono text-lp-primary text-[10px] font-bold tracking-[0.4em] mb-3 uppercase">Set It Up Once</p>
          <h2 className="font-headline text-3xl md:text-4xl font-black tracking-tight mb-3">You Configure It. Hermod Runs It. Forever.</h2>
          <p className="text-on-surface-variant max-w-2xl mx-auto">Tell Hermod what to query, how to format it, and who gets the email. After that, it runs on schedule without you.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border border-outline-variant/20">
          {/* Setup */}
          <div className="p-10 border-b md:border-b-0 md:border-r border-outline-variant/20 bg-[#fffbf2]">
            <p className="font-mono text-lp-primary text-xs font-bold tracking-[0.25em] mb-5 uppercase">&#x2692; Tell Hermod Where and What</p>
            <ul className="space-y-4 text-sm text-on-surface-variant">
              <li className="flex items-start gap-3"><span className="text-lp-primary mt-0.5">&#x25C6;</span> Pick your source &mdash; any database, file, or API</li>
              <li className="flex items-start gap-3"><span className="text-lp-primary mt-0.5">&#x25C6;</span> Write your query or point to your data</li>
              <li className="flex items-start gap-3"><span className="text-lp-primary mt-0.5">&#x25C6;</span> Choose the format &mdash; Excel, CSV, or direct to another database</li>
              <li className="flex items-start gap-3"><span className="text-lp-primary mt-0.5">&#x25C6;</span> Set the schedule and recipients</li>
            </ul>
            <p className="mt-6 font-mono text-[10px] tracking-[0.2em] text-on-surface-variant/80">Five minutes. One time.</p>
          </div>
          {/* Every Run */}
          <div className="p-10 bg-[#f8fafe]">
            <p className="font-mono text-[#2a6a8f] text-xs font-bold tracking-[0.25em] mb-5 uppercase">&#x26A1; Hermod Delivers the Rest</p>
            <ul className="space-y-4 text-sm text-on-surface-variant">
              <li className="flex items-start gap-3"><span className="text-[#2a6a8f] mt-0.5">&#x25C6;</span> Same report, same format, every time</li>
              <li className="flex items-start gap-3"><span className="text-[#2a6a8f] mt-0.5">&#x25C6;</span> New rows added, changed rows updated</li>
              <li className="flex items-start gap-3"><span className="text-[#2a6a8f] mt-0.5">&#x25C6;</span> Delivered on schedule &mdash; email, SFTP, SharePoint, wherever</li>
              <li className="flex items-start gap-3"><span className="text-[#2a6a8f] mt-0.5">&#x25C6;</span> You never touch it again</li>
            </ul>
            <p className="mt-6 font-mono text-[10px] tracking-[0.2em] text-on-surface-variant/80">Every morning. Every week. Every month. Automatically.</p>
          </div>
        </div>
        <p className="text-center mt-6 font-mono text-[11px] tracking-[0.15em] text-lp-primary italic">
          &ldquo;The only platform where AI works once at setup &mdash; then gets out of the way&rdquo;
        </p>
      </section>

      {/* --- Three Steps (Change 9) --- */}
      <section className="py-16 px-8 md:px-16 max-w-7xl mx-auto" id="how-it-works">
        <div className="mb-12">
          <p className="font-mono text-lp-primary text-xs font-bold tracking-[0.4em] mb-3 uppercase">How It Works</p>
          <h2 className="font-headline text-4xl md:text-5xl font-black tracking-tight mb-3">Three Steps. Any Delivery.</h2>
          <div className="w-24 h-1 bg-lp-primary slide-top-bar" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-outline-variant/20">
          {[
            { step: "1", title: "Connect Your Data Sources", sub: "Databases, APIs, SFTP, Excel, cloud storage \u2014 pick your source and destination. Hermod connects to all of them out of the box.", img: `${CDN}/step-connect.webp` },
            { step: "2", title: "Set the Format Once", sub: "Choose your columns, file format, and output layout. Set it up once \u2014 manually, or let AI learn from your example files (Odin tier). Every run after that delivers the same way.", img: `${CDN}/step-forge.webp` },
            { step: "3", title: "Automatic Forever", sub: "Every scheduled delivery does exactly the same thing. New rows get added, changed rows get updated, nothing gets duplicated. No manual work. No surprises.", img: `${CDN}/step-deterministic.webp` },
          ].map((s, i) => (
            <div key={s.step} className={`p-10 group hover:bg-[#f5f3f0] transition-all ${i < 2 ? "border-b md:border-b-0 md:border-r border-outline-variant/20" : ""}`}>
              <div className="mb-6 aspect-video overflow-hidden">
                <img className="w-full h-full object-cover grayscale-[0.4] group-hover:grayscale-0 transition-all duration-700" alt={s.title} loading="lazy" src={s.img} />
              </div>
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-lp-primary text-xs font-bold tracking-widest">STEP {s.step}</span>
                {i < 2 && <span className="text-lp-primary">&rarr;</span>}
              </div>
              <h3 className="font-headline text-xl font-bold mb-3 tracking-wide uppercase">{s.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{s.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- Before/After (Change 10) --- */}
      <section className="py-16 px-8 md:px-16 bg-[#f5f3f0]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <p className="font-mono text-lp-primary text-xs font-bold tracking-[0.4em] mb-3 uppercase">Live Example</p>
            <h2 className="font-headline text-3xl md:text-4xl font-black tracking-tight">See the Forge in Action</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="border border-slate-300 bg-[#1b1c1a] p-1 shadow-lg">
                <img className="w-full h-auto" alt="Messy GL export with title rows, mixed date formats, raw codes" loading="lazy" src={`${CDN}/before-gl.webp`} />
              </div>
              <p className="font-mono text-[10px] tracking-[0.2em] text-on-surface-variant/50 uppercase mt-3 text-center">Before</p>
              <p className="text-sm text-on-surface-variant text-center mt-1">Messy GL export with title rows, mixed date formats, inconsistent headers</p>
            </div>
            <div>
              <div className="border-2 border-lp-primary bg-[#1b1c1a] p-1 shadow-lg">
                <img className="w-full h-auto" alt="Clean board-ready report with formatted currency, ISO dates" loading="lazy" src={`${CDN}/after-gl.webp`} />
              </div>
              <p className="font-mono text-[10px] tracking-[0.2em] text-lp-primary uppercase mt-3 text-center">After</p>
              <p className="text-sm text-on-surface-variant text-center mt-1">Board-ready financial report with clean headers, consistent formatting, merged totals</p>
            </div>
          </div>
          <p className="text-center mt-8 text-on-surface-variant italic text-sm max-w-2xl mx-auto leading-relaxed">
            47 columns mapped. 6 date formats fixed. Junk header rows removed &mdash; in 8 seconds. Every upload after that delivers the same way, automatically.
          </p>
        </div>
      </section>

      {/* --- The Forge � Nidavellir (Change 2, moved up) --- */}
      <section className="py-16 px-8 md:px-16 max-w-7xl mx-auto">
        <div className="realm-card-hover group bg-[#fbf9f6] p-1 border-t-4 border-realm-nidavellir">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            <img className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" alt="The Nidavellir forge — data formatting" loading="lazy" src={`${CDN}/nidavellir-v2.webp`} />
            <div className="p-12">
              <h4 className="font-headline text-3xl font-bold mb-2">The Forge &middot; Data Formatting</h4>
              <p className="text-sm text-on-surface-variant font-label uppercase tracking-widest mb-6">Cleans and reshapes your data between source and destination</p>
              <p className="text-lg text-on-surface-variant mb-8 leading-relaxed">
                Not a source. Not a destination. The forge sits between them &mdash; data passes through it to be cleansed, mapped, and reshaped before it reaches its final form.
              </p>
              <ul className="space-y-4 font-label text-xs tracking-widest text-lp-primary uppercase">
                <li className="flex items-center gap-3"><span className="w-2 h-2 bg-realm-nidavellir" /> Map and rename columns to match your destination</li>
                <li className="flex items-center gap-3"><span className="w-2 h-2 bg-realm-nidavellir" /> Fix dates, numbers, and messy formatting</li>
                <li className="flex items-center gap-3"><span className="w-2 h-2 bg-realm-nidavellir" /> AI learns your formatting rules (Odin tier)</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* --- Nine Realms (Changes 3, 4) --- */}
      <section className="py-16 px-8 md:px-16 bg-[#f5f3f0]" id="realms">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-14">
            <p className="font-mono text-lp-primary text-xs font-bold tracking-[0.4em] mb-3 uppercase">Connectors &amp; Destinations</p>
            <h2 className="font-headline text-4xl md:text-5xl font-black tracking-tight">The Nine Realms</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {REALMS.map((r) => (
              <div key={r.norse} className={`realm-card-hover group bg-[#fbf9f6] p-1 border-t-4 ${r.color}`}>
                <div className="p-6">
                  <img className="w-full aspect-[4/3] object-cover mb-5 grayscale group-hover:grayscale-0 transition-all" alt={r.primary} loading="lazy" src={r.img} />
                  <h4 className="text-[15px] font-bold text-on-surface mb-1">{r.primary}</h4>
                  <p className="text-[10px] text-[#d4af37] font-label uppercase tracking-[0.25em] mb-3">{r.norse}</p>
                  <p className="text-on-surface-variant text-sm leading-relaxed">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Data Agent Teaser --- */}
      <section className="py-16 px-8 md:px-16 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <p className="font-mono text-lp-primary text-[10px] font-bold tracking-[0.4em] mb-3 uppercase">Included with Thor &middot; $99/mo</p>
          <h2 className="font-headline text-3xl md:text-4xl font-black tracking-tight">
            Your Monday Report Is Already in Your Inbox.
          </h2>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="group">
            <div className="bg-white p-1 border border-outline-variant/30 shadow-lg">
              <img
                className="w-full grayscale-[0.4] group-hover:grayscale-0 transition-all duration-700"
                alt="Hermod Data Agent bridging on-premises databases to the cloud"
                loading="lazy"
                src={`${CDN}/raven/marketing-hero.webp`}
              />
            </div>
          </div>
          <div>
            <p className="text-on-surface-variant text-[17px] leading-[1.8] mb-8">
              That SQL Server behind your firewall? The one someone has to manually query every week? Install the Data Agent on any Windows machine with database access, and that database appears in Hermod like any cloud connection. Your reports, syncs, and feeds run on schedule &mdash; from databases that never leave your network.
            </p>
            <div className="space-y-4 mb-8">
              {[
                "Monday\u2019s GL report: in the CFO\u2019s inbox before coffee",
                "Inventory sync: every hour, no one lifts a finger",
                "EDI feeds: on schedule, to every trading partner",
                "No VPN. No firewall holes. No static IP.",
              ].map((point) => (
                <p key={point} className="text-on-surface text-[15px] font-medium flex items-center gap-3">
                  <span className="text-lp-primary">&#x25C6;</span> {point}
                </p>
              ))}
            </div>
            <div className="flex items-center gap-6">
              <a href="#pricing" className="font-mono text-[11px] tracking-[0.2em] uppercase text-lp-primary hover:text-primary-container transition-colors">
                Included in Thor &rarr;
              </a>
              <a href="/data-agent" className="font-mono text-[11px] tracking-[0.2em] uppercase text-on-surface-variant/60 hover:text-on-surface-variant transition-colors">
                Learn more &rarr;
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* --- Stats --- */}
      <section className="py-14 px-8 md:px-16 max-w-5xl mx-auto text-center">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-8 border border-outline-variant/20 bg-[#fbf9f6]">
            <div className="font-headline text-4xl font-black text-lp-primary">60 seconds</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-on-surface-variant/60 uppercase mt-2">To connect your first source</div>
          </div>
          <div className="p-8 border border-outline-variant/20 bg-[#fbf9f6]">
            <div className="font-headline text-4xl font-black text-lp-primary">$0 per delivery</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-on-surface-variant/60 uppercase mt-2">After one-time setup</div>
          </div>
          <div className="p-8 border border-outline-variant/20 bg-[#fbf9f6]">
            <div className="font-headline text-4xl font-black text-lp-primary">7:00 AM Monday</div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-on-surface-variant/60 uppercase mt-2">Your report is already there</div>
          </div>
        </div>
      </section>

      {/* --- Pricing � Three Tiers --- */}
      <section className="py-16 px-8 md:px-16 max-w-7xl mx-auto" id="pricing">
        <div className="text-center mb-12">
          <h2 className="font-headline text-5xl font-black mb-3">Three Tiers. One Engine.</h2>
          <p className="text-on-surface-variant">From first route to full automation.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {/* Heimdall */}
          <div className="bg-[#fbf9f6] p-10 border border-outline-variant/30 group hover:border-lp-primary transition-all">
            <p className="font-mono text-lp-primary text-[10px] tracking-[0.3em] uppercase mb-4">Free Tier</p>
            <h3 className="font-headline text-3xl font-bold mb-2">Heimdall</h3>
            <p className="font-mono text-[10px] tracking-[0.15em] text-on-surface-variant/50 uppercase mb-6">Guardian of the Bifrost</p>
            <div className="flex items-baseline gap-1 mb-8">
              <span className="text-2xl font-headline">$</span>
              <span className="text-5xl font-headline font-black">0</span>
              <span className="text-on-surface-variant font-label text-xs uppercase tracking-widest">/ month</span>
            </div>
            <p className="text-on-surface-variant mb-8 text-sm">Full delivery engine. Cloud-to-cloud connections. Manual configuration.</p>
            <ul className="space-y-4 mb-10">
              {["Unlimited routes & connections", "All connectors and destinations", "Manual formatting rules", "Helheim error recovery", "Only delivers new and changed data"].map((f) => (
                <li key={f} className="flex items-center gap-3 text-xs font-label uppercase tracking-widest">
                  <span className="text-lp-primary text-sm">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <a href="/login" className="block w-full py-3.5 border border-outline font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#f5f3f0] transition-all text-center">Start Free</a>
          </div>
          {/* Thor */}
          <div className="bg-white p-10 border-2 border-lp-primary relative shadow-2xl overflow-hidden">
            <div className="absolute top-0 right-0 bg-lp-primary text-on-primary font-mono text-[10px] font-black tracking-widest py-1 px-4 uppercase transform translate-x-[25%] translate-y-[50%] rotate-45">Popular</div>
            <p className="font-mono text-lp-primary text-[10px] tracking-[0.3em] uppercase mb-4">Professional</p>
            <h3 className="font-headline text-3xl font-bold mb-2">Thor</h3>
            <p className="font-mono text-[10px] tracking-[0.15em] text-on-surface-variant/50 uppercase mb-6">God of Thunder</p>
            <div className="flex items-baseline gap-1 mb-8">
              <span className="text-2xl font-headline">$</span>
              <span className="text-5xl font-headline font-black">99</span>
              <span className="text-on-surface-variant font-label text-xs uppercase tracking-widest">/ month</span>
            </div>
            <p className="text-on-surface-variant mb-8 text-sm">On-prem databases. Real-time triggers. The power to bridge any network.</p>
            <ul className="space-y-4 mb-10">
              {["Everything in Heimdall", "Data Agent for on-prem databases", "Webhook & real-time triggers", "Extended history retention", "Email support"].map((f) => (
                <li key={f} className="flex items-center gap-3 text-xs font-label uppercase tracking-widest">
                  <span className="text-lp-primary text-sm">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <a href="/login" className="block w-full py-3.5 bg-lp-primary text-on-primary font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-primary-container transition-all text-center">Start with Thor</a>
          </div>
          {/* Odin */}
          <div className="bg-[#fbf9f6] p-10 border border-outline-variant/30 group hover:border-lp-primary transition-all">
            <p className="font-mono text-lp-primary text-[10px] tracking-[0.3em] uppercase mb-4">Enterprise</p>
            <h3 className="font-headline text-3xl font-bold mb-2">Odin</h3>
            <p className="font-mono text-[10px] tracking-[0.15em] text-on-surface-variant/50 uppercase mb-6">The All-Father</p>
            <div className="flex items-baseline gap-1 mb-8">
              <span className="text-2xl font-headline">$</span>
              <span className="text-5xl font-headline font-black">299</span>
              <span className="text-on-surface-variant font-label text-xs uppercase tracking-widest">/ month</span>
            </div>
            <p className="text-on-surface-variant mb-8 text-sm">AI-powered forge. Automatic column detection. The All-Father sees all.</p>
            <ul className="space-y-4 mb-10">
              {["Everything in Thor", "AI-powered formatting (Mj\u00f6lnir)", "Upload BEFORE & AFTER Excel files", "AI learns your formatting rules", "Zero ongoing AI cost", "Automatic API connector setup", "Priority support"].map((f) => (
                <li key={f} className="flex items-center gap-3 text-xs font-label uppercase tracking-widest">
                  <span className="text-lp-primary text-sm">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <a href="/login" className="block w-full py-3.5 border-2 border-lp-primary text-lp-primary font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-lp-primary hover:text-on-primary transition-all text-center">Start with Odin</a>
            <a href="/forge" className="block w-full py-2.5 text-center font-mono text-[10px] tracking-[0.2em] uppercase text-lp-primary hover:text-primary-container transition-colors mt-1">See Mj&ouml;lnir features &rarr;</a>
          </div>
        </div>
      </section>

      {/* --- Origin Story --- */}
      <section className="py-14 px-8">
        <div className="max-w-xl mx-auto text-center">
          <div className="flex items-center justify-center gap-4 mb-6">
            <div className="h-[1px] w-full max-w-[80px] bg-outline-variant/30" />
            <span className="text-lp-primary text-sm select-none" aria-hidden="true">&#x16BA;</span>
            <div className="h-[1px] w-full max-w-[80px] bg-outline-variant/30" />
          </div>
          <p className="font-serif text-on-surface-variant/70 text-[15px] italic leading-[1.9]">
            &ldquo;I kept building the same thing &mdash; connect a database, format
            the output, deliver it on a schedule. Every client needed it.
            Every time it was a custom build. Hermod replaces all of it.&rdquo;
          </p>
          <p className="mt-4 font-mono text-[11px] tracking-[0.2em] text-on-surface-variant/40 uppercase">
            — Founder, Hermod
          </p>
        </div>
      </section>

      {/* --- Final CTA --- */}
      <section className="mt-12 bg-[#1b1c1a] text-[#fbf9f6] py-20 px-8 overflow-hidden relative">
        <div className="absolute inset-0 opacity-10">
          <div className="w-full h-full" style={{ backgroundImage: "linear-gradient(30deg, #9e7a2e 12%, transparent 12.5%, transparent 87%, #9e7a2e 87.5%, #9e7a2e), linear-gradient(150deg, #9e7a2e 12%, transparent 12.5%, transparent 87%, #9e7a2e 87.5%, #9e7a2e), linear-gradient(30deg, #9e7a2e 12%, transparent 12.5%, transparent 87%, #9e7a2e 87.5%, #9e7a2e), linear-gradient(150deg, #9e7a2e 12%, transparent 12.5%, transparent 87%, #9e7a2e 87.5%, #9e7a2e), linear-gradient(60deg, #9e7a2e77 25%, transparent 25.5%, transparent 75%, #9e7a2e77 75%, #9e7a2e77), linear-gradient(60deg, #9e7a2e77 25%, transparent 25.5%, transparent 75%, #9e7a2e77 75%, #9e7a2e77)", backgroundSize: "80px 140px", backgroundPosition: "0 0, 0 0, 40px 70px, 40px 70px, 0 0, 40px 70px" }} />
        </div>
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="font-headline text-4xl md:text-5xl font-black mb-6 tracking-tighter">Start Routing Data Today</h2>
          <p className="text-lg text-[#dbdad7]/80 mb-10 font-light leading-relaxed">Connect your first source in under two minutes. Free tier includes the full engine with unlimited routes.</p>
          <a href="/login" className="inline-block px-14 py-5 bg-lp-primary text-on-primary font-mono text-sm font-bold tracking-[0.3em] uppercase hover:bg-primary-container transition-all text-center">
            Start Free &mdash; $0 Forever
          </a>
        </div>
      </section>

      {/* --- Footer --- */}
      <footer className="bg-slate-50">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 px-12 py-16 max-w-7xl mx-auto">
          <div className="md:col-span-1">
            <div className="text-xl font-serif font-black text-amber-900 mb-6">&#x16BA; HERMOD</div>
            <p className="font-mono text-[10px] tracking-widest text-slate-500 uppercase leading-loose">
              Automated report delivery from any database to any inbox.
            </p>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Platform</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#how-it-works">How It Works</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#realms">The Realms</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/#pricing">Pricing</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Features</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/forge">The Forge</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/data-agent">Data Agent</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/connectors">Connectors</a></li>
            </ul>
          </div>
          <div>
            <h5 className="font-mono text-xs font-bold tracking-[0.3em] uppercase mb-8 text-amber-800">Company</h5>
            <ul className="space-y-4">
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/privacy">Privacy Policy</a></li>
              <li><a className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500 hover:text-amber-900 transition-all" href="/terms">Terms of Service</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-amber-900/10 py-8 px-12 text-center">
          <div className="font-serif text-amber-900/40 text-lg tracking-[2em] mb-4">&#x16A0; &#x16A2; &#x16A6; &#x16A8; &#x16B1; &#x16B2;</div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-slate-400 uppercase">
            &copy; 2026 Hermod. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
