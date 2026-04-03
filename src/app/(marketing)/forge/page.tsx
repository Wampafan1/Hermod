/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import {
  AnimatedMergeTable,
  AnimatedSchemaCleanup,
  AnimatedCostChart,
  AnimatedBlueprintFlow,
  AnimatedApiDiscovery,
} from "@/components/marketing/forge-visuals";

export const metadata: Metadata = {
  title: "The Forge — AI-Powered Data Pipelines | Hermod",
  description:
    "AI forges your data pipelines. You wield them forever. Zero ongoing AI cost — AI works once at setup, every run after that is pure code.",
};

const CDN = "https://hermodforge.com/illustrations";

// ─── Rune Divider ────────────────────────────────────────────
function RuneDivider() {
  return (
    <div className="flex items-center justify-center gap-4 py-2">
      <div className="h-[1px] w-full max-w-[160px] bg-[#ffb74d]/30" />
      <span className="text-[#ffb74d] text-lg select-none" aria-hidden="true">&#x2692;</span>
      <div className="h-[1px] w-full max-w-[160px] bg-[#ffb74d]/30" />
    </div>
  );
}

// ─── Section Image ───────────────────────────────────────────
function SectionImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="overflow-hidden shadow-[0_4px_24px_rgba(0,0,0,0.08)]" style={{ borderRadius: "8px" }}>
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
}

// ─── Feature Comparison Card ─────────────────────────────────
function ComparisonCard({
  title,
  items,
  variant,
}: {
  title: string;
  items: string[];
  variant: "pain" | "solution";
}) {
  const isPain = variant === "pain";
  return (
    <div
      className={`p-6 border ${
        isPain
          ? "border-slate-300 bg-slate-50"
          : "border-[#ffb74d] bg-white shadow-[0_0_24px_rgba(255,183,77,0.08)]"
      }`}
    >
      <h4
        className={`font-mono text-[10px] font-bold tracking-[0.3em] uppercase mb-4 ${
          isPain ? "text-slate-500" : "text-[#a06800]"
        }`}
      >
        {title}
      </h4>
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item} className={`text-sm leading-relaxed ${isPain ? "text-slate-600" : "text-[#2a2520]"}`}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════

export default function MjolnirPage() {
  return (
    <>
      {/* ═══ 1. Hero Banner ═══ */}
      <section className="relative h-[400px] md:h-[440px] flex items-center overflow-hidden">
        <img
          src={`${CDN}/mjolnir.webp`}
          alt="The Forge — where raw data becomes refined pipelines"
          className="absolute inset-0 w-full h-full object-cover object-[center_67%]"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a1400]/90 via-[#1a1400]/50 to-transparent" />
        <div className="relative z-10 px-8 md:px-16 max-w-5xl mx-auto w-full">
          <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-4">
            &#x2692; The Forge
          </p>
          <h1 className="font-headline text-4xl md:text-6xl font-black text-white mb-4 tracking-tight leading-[1.1]">
            Forge a Blueprint.<br />Use It Forever.
          </h1>
          <p className="text-[17px] md:text-lg text-white/90 font-light mb-2 max-w-xl leading-[1.8]">
            Show the Forge what you want &mdash; two Excel files, a messy CSV, an API endpoint.
            It builds the entire pipeline for you. No mapping screens. No field selectors. No code.
          </p>
          <p className="text-[17px] md:text-lg text-white font-bold mb-3 max-w-xl">
            Your files are the configuration.
          </p>
          <p className="font-mono text-[10px] text-white/40 tracking-wider mb-6">
            Powered by the Nidavellir Forge &mdash; where raw data becomes refined pipelines.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="/login"
              className="px-8 py-3 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#ffc870] transition-colors text-center"
            >
              Start Free
            </a>
            <a
              href="#how-it-works"
              className="px-8 py-3 border border-white/40 text-white font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-white/10 transition-colors text-center"
            >
              See It Work &darr;
            </a>
          </div>
        </div>
      </section>

      {/* ═══ 2. How the Forge Works ═══ */}
      <section id="how-it-works" className="py-14 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <RuneDivider />
          <h2 className="font-headline text-2xl md:text-3xl font-bold text-[#2a2520] mt-6 mb-4 tracking-tight text-center">
            How the Forge Works
          </h2>
          <p className="text-[#4a4035] leading-relaxed text-[15px] mb-8 max-w-2xl mx-auto text-center">
            Every other pipeline tool makes you configure everything in their UI.
            The Forge lets you show, not tell.
          </p>

          {/* Image above the cards */}
          <div className="max-w-3xl mx-auto mb-8">
            <SectionImage src={`${CDN}/forge-blueprint-table.webp`} alt="A craftsman's drafting table with a completed blueprint" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 border border-slate-200">
            {[
              { step: "1", title: "Show", desc: "Drop your files or paste your URL." },
              { step: "2", title: "Review", desc: "AI builds the blueprint. You approve it." },
              { step: "3", title: "Done", desc: "Blueprint runs as pure code. Same result every time." },
            ].map((s) => (
              <div key={s.step} className="bg-white p-8">
                <span className="block font-mono text-[#ffb74d] text-3xl font-black mb-3">{s.step}</span>
                <h3 className="font-headline text-lg font-bold text-[#2a2520] mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-[#4a4035] text-sm mt-6 text-center">
            No mapping wizards. No field selectors. No YAML files.
            Your data is the only configuration the Forge needs.
          </p>
        </div>
      </section>

      {/* ═══ 3. Upload Two Files ═══ */}
      <section id="forge-blueprints" className="py-14 px-8 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-10 items-start">
            {/* Image — left side */}
            <div className="order-1">
              <SectionImage src={`${CDN}/forge-before-after.webp`} alt="Crumpled raw document beside a crisp bound report" />
            </div>

            {/* Content — right side */}
            <div className="order-2">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; AI Forge Blueprints
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                Upload two files. AI learns the transformation.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                Show the Forge what your data looks like before and after. Upload a messy source file
                and the clean result you want. AI compares them, infers every transformation &mdash;
                column renames, date normalization, row filtering, formula logic &mdash; and generates
                a reusable blueprint. No code. No configuration screens. Just two Excel files.
              </p>
            </div>
          </div>

          <AnimatedBlueprintFlow />

          {/* Blueprint callout */}
          <div className="mt-8 p-6 bg-[#ffb74d]/[0.04] max-w-3xl" style={{ borderLeft: "3px solid #ffb74d" }}>
            <p className="font-mono text-xs font-bold tracking-[0.25em] uppercase text-[#a06800] mb-2">
              &#x2692; The Blueprint
            </p>
            <p className="text-sm text-[#4a4035] leading-relaxed">
              What the Forge produces isn&apos;t a prompt or a config file &mdash; it&apos;s real,
              auditable code. You can read it, version it, and modify it. It runs identically
              whether the next upload is tomorrow or next year.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <ComparisonCard
              title="Without the Forge"
              variant="pain"
              items={[
                "Write transformation rules by hand in a config file.",
                "Every column mapping, every formula, every format change \u2014 manually specified.",
                "Change the report? Rewrite the rules.",
              ]}
            />
            <ComparisonCard
              title="With the Forge"
              variant="solution"
              items={[
                "Upload the raw file (BEFORE) and the finished file (AFTER).",
                "AI compares them and generates every transformation step automatically.",
                "Review, confirm, done. Runs forever.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* Mid-page CTA */}
      <div className="py-8 px-8 text-center bg-[#f9f6f1]">
        <a href="#pricing" className="inline-block px-8 py-3 border-2 border-[#d4af37] text-[#8a6d00] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#d4af37] hover:text-white transition-colors">
          Start Forging Free
        </a>
      </div>

      {/* ═══ 4. Drop a Messy File ═══ */}
      <section className="py-14 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-10 items-start">
            {/* Content — left side */}
            <div className="order-2 md:order-1">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; AI Schema Detection
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                Drop a messy file. AI maps every column.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                Real-world files are messy. Title rows where headers should be. Six different date
                formats in one column. Column names that don&apos;t match your database. The Forge
                handles all of it. AI detects the actual header row, normalizes every date format,
                maps source columns to destination fields, and flags anything it&apos;s unsure about
                for your review.
              </p>
            </div>

            {/* Image — right side */}
            <div className="order-1 md:order-2">
              <SectionImage src={`${CDN}/forge-messy-desk.webp`} alt="Cluttered desk with one corner perfectly organized" />
            </div>
          </div>

          <AnimatedSchemaCleanup />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <ComparisonCard
              title="Without the Forge"
              variant="pain"
              items={[
                "Manually set header row, data start row, column types, date formats.",
                "For every file. Every time.",
                "File format changes? Start over.",
              ]}
            />
            <ComparisonCard
              title="With the Forge"
              variant="solution"
              items={[
                "Drop the file.",
                "AI finds the headers, detects data types, identifies date formats, skips junk rows. Automatically.",
                "You review and confirm.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ═══ 5. Smart Merge ═══ */}
      <section id="smart-merge" className="py-14 px-8 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-10 items-start">
            {/* Image — left side */}
            <div className="order-1">
              <SectionImage src={`${CDN}/forge-master-key.webp`} alt="Golden skeleton key on parchment" />
            </div>

            {/* Content — right side */}
            <div className="order-2">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; Smart Merge &mdash; Zero Duplicates
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                AI finds your primary key. Updates flow cleanly.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                Drop the same report next week and Hermod knows exactly what to do. AI identifies
                your unique key &mdash; invoice number, employee ID, SKU &mdash; during the first
                setup. Every future upload merges surgically:
              </p>

              {/* Merge behavior bullets */}
              <div className="space-y-3 mb-6">
                {[
                  "New rows insert",
                  "Changed rows update",
                  "Unchanged rows stay untouched",
                  "Duplicates never appear",
                ].map((line) => (
                  <p key={line} className="text-[#2a2520] text-[15px] font-medium flex items-center gap-3">
                    <span className="text-[#ffb74d]">&#x25C6;</span> {line}
                  </p>
                ))}
              </div>

              <p className="text-[#4a4035] leading-relaxed">
                No full table reloads. No &ldquo;delete everything and re-import.&rdquo;
                Just clean, incremental updates every single time.
              </p>
            </div>
          </div>

          <AnimatedMergeTable />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <ComparisonCard
              title="Without the Forge"
              variant="pain"
              items={[
                "Option A: Truncate and reload 10,000 rows every week. Wasteful. Slow.",
                "Option B: Append and get 10,000 duplicates. Then spend hours deduping.",
                "Option C: Write custom MERGE SQL. Hope you got the key right.",
              ]}
            />
            <ComparisonCard
              title="With the Forge"
              variant="solution"
              items={[
                "AI detects: shipment_id + warehouse_code is unique across all rows.",
                "Week 2: INSERT 200 new, UPDATE 50 changed, SKIP 9,750 untouched.",
                "Corrections? Just re-upload. They merge cleanly. No duplicates.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* Mid-page CTA */}
      <div className="py-8 px-8 text-center bg-[#f9f6f1]">
        <a href="#pricing" className="inline-block px-8 py-3 border-2 border-[#d4af37] text-[#8a6d00] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#d4af37] hover:text-white transition-colors">
          Start Forging Free
        </a>
      </div>

      {/* ═══ 6. Paste a URL ═══ */}
      <section className="py-14 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-10 items-start">
            {/* Content — left side */}
            <div className="order-2 md:order-1">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; AI API Discovery
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                Paste a URL. AI discovers the entire API.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                Give the Forge a base URL and credentials. AI crawls the API, discovers every
                available endpoint, maps the response schema, and identifies pagination patterns
                and rate limits. You pick which endpoints to sync. The Forge generates deterministic
                extraction code &mdash; no AI on future calls, just clean reliable pulls on your schedule.
              </p>
            </div>

            {/* Image — right side */}
            <div className="order-1 md:order-2">
              <SectionImage src={`${CDN}/forge-map-unfolding.webp`} alt="Scroll unrolling to reveal interconnected golden pathways" />
            </div>
          </div>

          <AnimatedApiDiscovery />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
            <ComparisonCard
              title="Without the Forge"
              variant="pain"
              items={[
                "Wait for a pre-built connector. Or write custom integration code. Or pay a consultant.",
                "Timeline: weeks.",
              ]}
            />
            <ComparisonCard
              title="With the Forge"
              variant="solution"
              items={[
                "Paste the API URL. AI discovers endpoints, maps schemas, detects pagination.",
                "Save to catalog \u2014 done. Timeline: 5 minutes.",
              ]}
            />
          </div>
        </div>
      </section>

      {/* ═══ 7. Incremental Sync ═══ */}
      <section className="py-14 px-8 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-10 items-start">
            {/* Image — left side */}
            <div className="order-1">
              <SectionImage src={`${CDN}/forge-precision-scale.webp`} alt="Perfectly balanced golden apothecary scale" />
            </div>

            {/* Content — right side */}
            <div className="order-2">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; Intelligent Sync
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                Never reload. Never duplicate. Automatic incremental sync.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                After the first full sync, Hermod tracks exactly where it left off. Every future run
                pulls only what&apos;s new or changed since the last execution &mdash; whether that&apos;s
                a timestamp, an auto-incrementing ID, or a modification date. No full reloads burning
                through your API rate limits. No duplicate rows cluttering your destination. Just the
                delta, every time.
              </p>
            </div>
          </div>

          {/* Incremental sync bar chart */}
          <div className="max-w-lg mx-auto space-y-3 mt-8">
            {[
              { label: "Run 1", width: "100%", rows: "10,000 rows", sub: "full load" },
              { label: "Run 2", width: "4.7%", rows: "47 rows", sub: "new + changed" },
              { label: "Run 3", width: "2.3%", rows: "23 rows", sub: "new + changed" },
              { label: "Run 4", width: "0.8%", rows: "8 rows", sub: "new + changed" },
            ].map((run) => (
              <div key={run.label} className="flex items-center gap-4">
                <span className="font-mono text-[10px] text-slate-400 w-12 text-right tracking-wider">{run.label}</span>
                <div className="flex-1 h-6 bg-slate-100 relative overflow-hidden">
                  <div className="h-full bg-[#ffb74d]/80" style={{ width: run.width }} />
                </div>
                <span className="font-mono text-[11px] text-[#2a2520] w-24">{run.rows}</span>
                <span className="font-mono text-[9px] text-slate-400 tracking-wider w-24">{run.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mid-page CTA */}
      <div className="py-8 px-8 text-center bg-[#f9f6f1]">
        <a href="#pricing" className="inline-block px-8 py-3 border-2 border-[#d4af37] text-[#8a6d00] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#d4af37] hover:text-white transition-colors">
          Start Forging Free
        </a>
      </div>

      {/* ═══ 8. Trust Line ═══ */}
      <section className="py-10 px-8 bg-[#f5f0e8]">
        <div className="max-w-3xl mx-auto text-center">
          {/* Sealed blueprint image */}
          <div className="mx-auto mb-6 w-[200px]" style={{ borderRadius: "8px", overflow: "hidden" }}>
            <img
              src={`${CDN}/forge-sealed-blueprint.webp`}
              alt="Document sealed with a golden wax stamp"
              className="w-full h-auto object-cover shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
              loading="lazy"
            />
          </div>
          <div className="border-y border-slate-300 py-6">
            <p className="text-[15px] text-[#4a4035] italic leading-relaxed" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
              &ldquo;Every blueprint is real code &mdash; auditable, versioned, and deterministic.
              Your data never touches a language model after the forge is complete.&rdquo;
            </p>
          </div>
        </div>
      </section>

      {/* ═══ 9. The Economics ═══ */}
      <section className="py-14 px-8 bg-[#fbf9f6]">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-2 tracking-tight">
            The Economics
          </h2>
          <RuneDivider />
          <p className="text-[#4a4035] leading-relaxed mt-6 mb-4 max-w-2xl mx-auto">
            Other tools charge per row, per connector, per sync &mdash; the bill grows every month.
            A Hermod blueprint costs the same to run whether it fires 10 times or 10,000 times.
          </p>
          <AnimatedCostChart />
          <p className="font-mono text-[12px] text-[#ffb74d] tracking-wider mt-6">
            Mj&ouml;lnir: $299/month flat. Unlimited pipelines. Unlimited runs. Zero AI cost after setup.
          </p>
        </div>
      </section>

      {/* ═══ 10. Pricing ═══ */}
      <section id="pricing" className="py-16 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-2 tracking-tight">
            Choose Your Weapon
          </h2>
          <RuneDivider />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10 items-start text-left">
            {/* Freya */}
            <div className="bg-[#fbf9f6] p-10 border border-slate-200">
              <p className="font-mono text-slate-400 text-[10px] tracking-[0.3em] uppercase mb-4">Free Tier</p>
              <h3 className="font-headline text-4xl font-bold text-[#2a2520] mb-2">Freya</h3>
              <p className="text-sm text-slate-500 mb-6">The full pipeline engine with manual configuration.</p>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-3xl font-headline text-[#2a2520]">$</span>
                <span className="text-6xl font-headline font-black text-[#2a2520]">0</span>
                <span className="text-slate-500 font-mono text-xs uppercase tracking-widest">/ forever</span>
              </div>
              <ul className="space-y-4 mb-10">
                {[
                  "Unlimited routes & schedules",
                  "All nine realms connected",
                  "Manual column mapping",
                  "Cron & plain-English scheduling",
                  "Error retry (Helheim)",
                  "Community support",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-[#4a4035]">
                    <span className="text-lp-primary">&#10003;</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="/login"
                className="block w-full py-4 border border-slate-300 font-mono text-xs font-bold tracking-[0.2em] uppercase text-[#4a4035] hover:bg-slate-50 transition-colors text-center"
              >
                Start Free
              </a>
            </div>

            {/* Mjölnir */}
            <div className="bg-white p-10 border-2 border-[#ffb74d] relative shadow-[0_0_40px_rgba(255,183,77,0.1)]">
              <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 bg-[#ffb74d] text-[#1a1400] font-mono text-[9px] font-black tracking-[0.3em] uppercase px-4 py-1">
                Recommended
              </div>
              <p className="font-mono text-[#ffb74d] text-[10px] tracking-[0.3em] uppercase mb-4 mt-2">Premium</p>
              <h3 className="font-headline text-4xl font-bold text-[#2a2520] mb-2">Mj&ouml;lnir</h3>
              <p className="text-sm text-slate-500 mb-6">AI-powered Forge. The pipeline builds itself.</p>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-headline text-[#2a2520]">$</span>
                <span className="text-6xl font-headline font-black text-[#2a2520]">299</span>
                <span className="text-slate-500 font-mono text-xs uppercase tracking-widest">/ month per workspace</span>
              </div>
              <p className="text-sm text-slate-500 mb-8">Everything in Freya, plus:</p>
              <ul className="space-y-4 mb-10">
                {[
                  "AI schema detection & column mapping",
                  "AI primary key discovery + MERGE",
                  "Before/after blueprint generation",
                  "AI API endpoint discovery",
                  "Smart incremental sync",
                  "Automatic watermark tracking",
                  "Priority support",
                  "Future: Data Quality Alerts",
                  "Future: Schema Evolution",
                  "Future: Natural Language Config",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-[#4a4035]">
                    <span className="text-[#ffb74d]">&#x2692;</span> {f}
                  </li>
                ))}
              </ul>
              <a
                href="/login"
                className="block w-full py-4 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#ffc870] transition-colors text-center"
              >
                Start Free Trial
              </a>
              <p className="text-center text-[11px] text-slate-400 mt-3">14 days free. No card needed.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 11. Footer CTA ═══ */}
      <section className="py-14 px-8 bg-[#2a2520] text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-black mb-4 tracking-tight">
            The forge awaits.
          </h2>
          <p className="text-white/70 leading-relaxed mb-8">
            Connect your first source. Build your first pipeline.<br />
            See AI learn your data in under two minutes.
          </p>
          <a
            href="/login"
            className="inline-block px-12 py-4 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.3em] uppercase hover:bg-[#ffc870] transition-colors"
          >
            Start Free &mdash; $0 Forever
          </a>
        </div>
      </section>
    </>
  );
}
