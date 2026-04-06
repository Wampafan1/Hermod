/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hermod Data Agent | Automated Reports From On-Prem Databases",
  description:
    "Install the Data Agent on any Windows machine. Your SQL Server, PostgreSQL, or MySQL databases appear in Hermod as cloud connections. Reports run on schedule — no VPN, no scripts, no manual exports.",
};

const CDN = "https://hermodforge.com/illustrations/raven";

// ─── Rune Divider ────────────────────────────────────────
function RuneDivider() {
  return (
    <div className="flex items-center justify-center gap-4 py-2">
      <div className="h-[1px] w-full max-w-[160px] bg-[#d4af37]/30" />
      <span className="text-[#d4af37] text-lg select-none" aria-hidden="true">&#x16BA;</span>
      <div className="h-[1px] w-full max-w-[160px] bg-[#d4af37]/30" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════

export default function DataAgentPage() {
  return (
    <>
      {/* ═══ 1. Hero ═══ */}
      <section className="py-20 px-8 md:px-16 bg-[#fbf9f6]">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <div>
            <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-4">
              Included with Thor &middot; $99/mo
            </p>
            <h1 className="font-headline text-4xl md:text-5xl font-black text-[#2a2520] mb-6 tracking-tight leading-[1.1]">
              Your Reports Run Themselves. Every Morning. From Your Own Databases.
            </h1>
            <p className="text-[#4a4035] text-lg leading-relaxed mb-8 max-w-lg">
              That SQL Server behind your firewall &mdash; the one somebody queries by hand
              every Monday &mdash; now delivers reports on schedule. Install the Data Agent,
              and your on-prem databases appear in Hermod like any cloud connection. No VPN.
              No scripts. Nobody has to be at their desk.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="/login"
                className="px-8 py-3 bg-[#d4af37] text-[#1a1400] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#c4962a] transition-colors text-center"
              >
                Start with Thor &mdash; $99/mo
              </a>
              <a
                href="#how-it-works"
                className="px-8 py-3 border border-slate-300 text-[#4a4035] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-slate-50 transition-colors text-center"
              >
                See How It Works &darr;
              </a>
            </div>
          </div>
          <div className="group">
            <div className="overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.08)]" style={{ borderRadius: "8px" }}>
              <img
                src={`${CDN}/marketing-hero.webp`}
                alt="Hermod Data Agent bridging on-premises databases to the cloud"
                className="w-full h-full object-cover grayscale-[0.3] group-hover:grayscale-0 transition-all duration-700"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 2. The Daily Payoff ═══ */}
      <section className="py-16 px-8 md:px-16 bg-[#f5f3f0]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] mb-3 uppercase">
              What Your Morning Looks Like
            </p>
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] tracking-tight">
              The Report Is Already There When You Arrive
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                title: "Financial Reports",
                desc: "Your GL report lands in the CFO\u2019s inbox at 7 AM. Every Monday. Queried from your SQL Server, formatted into a styled Excel workbook, delivered via email. Nobody ran a query. Nobody exported a CSV. Nobody was even awake.",
              },
              {
                title: "Inventory Syncs",
                desc: "Your warehouse inventory updates in the cloud every hour. Current stock levels, reorder points, bin locations \u2014 all from your on-prem database, all automatic. The plant manager checks the dashboard at 6 AM. The numbers are already fresh.",
              },
              {
                title: "Trading Partner Feeds",
                desc: "Your outbound EDI feeds hit every partner\u2019s SFTP on schedule. ASN files, price lists, inventory feeds \u2014 generated from live data, never stale, never late. No one remembers the last time a feed was missed.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="bg-[#fbf9f6] p-8 border-t-4 border-[#d4af37]"
              >
                {/* TODO: Add illustration — data-agent-{card.title.toLowerCase().replace(/ /g, '-')}.webp */}
                <h3 className="font-headline text-lg font-bold text-[#2a2520] mb-3">
                  {card.title}
                </h3>
                <p className="text-sm text-[#4a4035] leading-relaxed">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 3. The Pain It Eliminates ═══ */}
      <section className="py-16 px-8 md:px-16 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] mb-3 uppercase">
              The On-Prem Problem
            </p>
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] tracking-tight">
              Sound Familiar?
            </h2>
          </div>

          <div className="max-w-[720px] mx-auto p-8 bg-white" style={{ borderLeft: "3px solid #d4af37" }}>
            <div className="space-y-4 text-[15px] text-[#4a4035] leading-relaxed">
              <p>
                Someone &mdash; probably you &mdash; runs a SQL query every Monday morning.
                Copies the results into Excel. Reformats the headers, fixes the date columns,
                adds the totals row. Saves it. Opens Outlook. Attaches it. Sends it to five people.
                Takes about an hour. You&apos;ve been doing this for three years.
              </p>
              <p>
                Meanwhile, if the VPN drops, if the SFTP password rotates, if someone renames
                a column in the database &mdash; you&apos;re the one who gets the call. You can&apos;t
                take vacation without writing instructions that nobody follows.
              </p>
              <p className="text-[#2a2520] font-medium">
                The Data Agent eliminates all of it. Install it once, point it at your database,
                and Hermod takes over. Same report, same schedule, same recipients &mdash; but
                without you in the loop.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 4. How It Works ═══ */}
      <section id="how-it-works" className="py-16 px-8 md:px-16 bg-[#f5f3f0]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] mb-3 uppercase">
              Three Steps to Connect
            </p>
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] tracking-tight">
              How It Works
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-slate-200">
            {[
              {
                step: "1",
                title: "Install",
                desc: "Download the agent. Install on any Windows machine with database access. Takes 60 seconds.",
                img: `${CDN}/installer-splash.webp`,
              },
              {
                step: "2",
                title: "Connect",
                desc: "Generate an API key in Hermod. Paste it into the agent. It registers automatically.",
                img: `${CDN}/setup-flow.webp`,
              },
              {
                step: "3",
                title: "Schedule Your Delivery",
                desc: "Your on-prem databases appear in Hermod like any other connection. Pick your query, choose the output format, and set the schedule.",
                img: `${CDN}/connection-established.webp`,
              },
            ].map((s, i) => (
              <div
                key={s.step}
                className={`p-8 bg-white group hover:bg-[#f5f3f0] transition-all ${
                  i < 2 ? "border-b md:border-b-0 md:border-r border-slate-200" : ""
                }`}
              >
                <div className="mb-5 aspect-video overflow-hidden" style={{ borderRadius: "4px" }}>
                  <img
                    className="w-full h-full object-cover grayscale-[0.4] group-hover:grayscale-0 transition-all duration-700"
                    alt={s.title}
                    loading="lazy"
                    src={s.img}
                  />
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-mono text-[#d4af37] text-3xl font-black">{s.step}</span>
                  {i < 2 && <span className="text-[#d4af37]">&rarr;</span>}
                </div>
                <h3 className="font-headline text-lg font-bold text-[#2a2520] mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 5. Security & Architecture ═══ */}
      <section className="py-16 px-8 md:px-16 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <RuneDivider />
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mt-6 tracking-tight">
              Security by Design
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Image */}
            <div className="group">
              <div className="overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.08)]" style={{ borderRadius: "8px" }}>
                <img
                  src={`${CDN}/data-in-transit.webp`}
                  alt="Encrypted data flowing securely between on-premises and cloud"
                  className="w-full h-full object-cover grayscale-[0.3] group-hover:grayscale-0 transition-all duration-700"
                  loading="lazy"
                />
              </div>
            </div>

            {/* Security points */}
            <div className="space-y-6">
              {[
                {
                  title: "Pull-based",
                  desc: "The agent polls Hermod for work. Hermod never initiates connections to your network.",
                },
                {
                  title: "Read-only SQL",
                  desc: "The agent executes SELECT queries only. It cannot modify, delete, or write to your databases.",
                },
                {
                  title: "Encrypted credentials",
                  desc: "All credentials encrypted using native Windows security and industry-standard encryption.",
                },
                {
                  title: "Outbound HTTPS only",
                  desc: "Port 443 outbound. No inbound ports, no VPN, no static IP required.",
                },
                {
                  title: "Automatic updates",
                  desc: "The agent keeps itself current without manual patching or maintenance windows.",
                },
              ].map((point) => (
                <div key={point.title}>
                  <p className="text-[#2a2520] text-[15px] font-medium flex items-center gap-3 mb-1">
                    <span className="text-[#d4af37]">&#x25C6;</span> {point.title}
                  </p>
                  <p className="text-sm text-slate-500 leading-relaxed ml-6">{point.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Architecture diagram placeholder */}
          {/* TODO: Add illustration — data-agent-architecture.webp */}
        </div>
      </section>

      {/* ═══ 6. Supported Databases ═══ */}
      <section className="py-16 px-8 md:px-16 bg-[#f5f3f0]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] mb-3 uppercase">
              Compatible Sources
            </p>
            <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] tracking-tight">
              Supported Databases
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 border border-slate-200">
            {[
              {
                name: "SQL Server",
                desc: "2012 and newer. Windows Auth or SQL Auth.",
              },
              {
                name: "PostgreSQL",
                desc: "9.6+. Standard connection string.",
              },
              {
                name: "MySQL",
                desc: "5.7+. Standard connection string.",
              },
            ].map((db) => (
              <div key={db.name} className="bg-white p-8 text-center">
                <h3 className="font-headline text-xl font-bold text-[#2a2520] mb-2">{db.name}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{db.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-center mt-6 text-sm text-slate-400">
            More databases coming soon. The agent architecture supports any Node.js database driver.
          </p>
        </div>
      </section>

      {/* ═══ 7. CTA ═══ */}
      <section className="py-16 px-8 md:px-16 bg-[#2a2520] text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-black mb-4 tracking-tight">
            Your Reports Should Be Waiting When You Arrive
          </h2>
          <p className="text-white/70 leading-relaxed mb-8">
            Included with Thor. $99/month. No credit card to start.
          </p>
          <a
            href="/login"
            className="inline-block px-12 py-4 bg-[#d4af37] text-[#1a1400] font-mono text-xs font-bold tracking-[0.3em] uppercase hover:bg-[#c4962a] transition-colors"
          >
            Start with Thor
          </a>
          <div className="mt-4">
            <a
              href="/#pricing"
              className="font-mono text-[11px] tracking-[0.2em] text-white/40 uppercase hover:text-white/70 transition-colors"
            >
              See all pricing &rarr;
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
