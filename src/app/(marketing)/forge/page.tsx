/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import {
  AnimatedMergeTable,
  AnimatedSchemaCleanup,
  AnimatedBlueprintFlow,
} from "@/components/marketing/forge-visuals";

export const metadata: Metadata = {
  title: "Mj\u00f6lnir AI Forge | Hermod",
  description:
    "Upload a messy Excel file. AI learns your formatting. Every run after that is automatic. Included with the Odin tier \u2014 $299/month.",
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

export default function ForgePage() {
  return (
    <>
      {/* ═══ 1. Hero Banner ═══ */}
      <section className="relative h-[400px] md:h-[440px] flex items-center overflow-hidden">
        <img
          src={`${CDN}/mjolnir.webp`}
          alt="The Forge — where raw data becomes clean reports"
          className="absolute inset-0 w-full h-full object-cover object-[center_67%]"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a1400]/90 via-[#1a1400]/50 to-transparent" />
        <div className="relative z-10 px-8 md:px-16 max-w-5xl mx-auto w-full">
          <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-4">
            Included with Odin &middot; $299/mo
          </p>
          <h1 className="font-headline text-4xl md:text-6xl font-black text-white mb-4 tracking-tight leading-[1.1]">
            Forge a Blueprint.<br />Use It Forever.
          </h1>
          <p className="text-[17px] md:text-lg text-white/90 font-light mb-2 max-w-xl leading-[1.8]">
            Upload a messy Excel file. AI learns your formatting &mdash; column renames,
            date fixes, formulas, everything. Every run after that is automatic.
            Same result every time.
          </p>
          <p className="text-[17px] md:text-lg text-white font-bold mb-6 max-w-xl">
            Upload the file you have and the file you want. That&apos;s your entire configuration.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="/login"
              className="px-8 py-3 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#ffc870] transition-colors text-center"
            >
              Start with Odin
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
            Every other tool makes you configure everything in their UI.
            The Forge lets you show, not tell.
          </p>

          {/* Image above the cards */}
          <div className="max-w-3xl mx-auto mb-8">
            <SectionImage src={`${CDN}/forge-blueprint-table.webp`} alt="A craftsman's drafting table with a completed blueprint" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-slate-200 border border-slate-200">
            {[
              { step: "1", title: "Show", desc: "Drop your files. The messy one and the clean one." },
              { step: "2", title: "Review", desc: "AI builds your formatting rules into a reusable Blueprint. You review and approve." },
              { step: "3", title: "Done", desc: "The blueprint runs on schedule. Same result every time." },
            ].map((s) => (
              <div key={s.step} className="bg-white p-8">
                <span className="block font-mono text-[#ffb74d] text-3xl font-black mb-3">{s.step}</span>
                <h3 className="font-headline text-lg font-bold text-[#2a2520] mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-[#4a4035] text-sm mt-6 text-center">
            No mapping wizards. No field selectors. No config files.
            Your data is the only configuration the Forge needs.
          </p>
        </div>
      </section>

      {/* ═══ 3. Upload Two Files ═══ */}
      <section id="forge-blueprints" className="py-14 px-8 bg-[#fbf9f6]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-10 items-start">
            {/* Image */}
            <div className="order-1">
              <SectionImage src={`${CDN}/forge-before-after.webp`} alt="Crumpled raw document beside a crisp bound report" />
            </div>

            {/* Content */}
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
              auditable rules. You can read them, version them, and modify them. They run identically
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

      {/* ═══ 4. Drop a Messy File ═══ */}
      <section className="py-14 px-8 bg-[#f5f0e8]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-10 items-start">
            {/* Content */}
            <div className="order-2 md:order-1">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; Automatic Column Mapping
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

            {/* Image */}
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
            {/* Image */}
            <div className="order-1">
              <SectionImage src={`${CDN}/forge-master-key.webp`} alt="Golden skeleton key on parchment" />
            </div>

            {/* Content */}
            <div className="order-2">
              <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.35em] uppercase mb-3">
                &#x2692; Smart Merge &mdash; Zero Duplicates
              </p>
              <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mb-4 tracking-tight">
                AI finds what makes each row unique. Updates flow cleanly.
              </h2>
              <p className="text-[#4a4035] leading-relaxed mb-6">
                Drop the same report next week and Hermod knows exactly what to do. AI identifies
                what makes each row unique &mdash; invoice number, employee ID, SKU &mdash; during the first
                setup. Every future upload merges cleanly:
              </p>

              {/* Merge behavior bullets */}
              <div className="space-y-3 mb-6">
                {[
                  "New rows insert",
                  "Changed rows update",
                  "Unchanged rows stay untouched",
                  "Duplicates never appear",
                  "Only new and changed data is processed \u2014 Hermod tracks where it left off",
                ].map((line) => (
                  <p key={line} className="text-[#2a2520] text-[15px] font-medium flex items-center gap-3">
                    <span className="text-[#ffb74d]">&#x25C6;</span> {line}
                  </p>
                ))}
              </div>

              <p className="text-[#4a4035] leading-relaxed">
                No full table reloads. No &ldquo;delete everything and re-import.&rdquo;
                Only what changed gets processed &mdash; every single time.
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
                "Option C: Write and maintain complex SQL to figure out what\u2019s new, what changed, and what needs updating.",
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

      {/* ═══ 6. Included with Odin ═══ */}
      <section id="pricing" className="py-14 px-8 bg-[#f5f0e8]">
        <div className="max-w-3xl mx-auto text-center">
          <RuneDivider />
          <h2 className="font-headline text-3xl md:text-4xl font-bold text-[#2a2520] mt-6 mb-4 tracking-tight">
            Included with Odin
          </h2>
          <p className="text-[#4a4035] leading-relaxed mb-2 max-w-xl mx-auto">
            The Mj&ouml;lnir AI forge is part of the Odin tier &mdash; $299/month.
            All three Hermod tiers include the full engine and unlimited routes.
          </p>
          <p className="font-mono text-[12px] text-[#ffb74d] tracking-wider mb-8">
            $299/month flat. No per-row fees. No per-run fees. No AI cost after setup.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/#pricing"
              className="px-8 py-3 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-[#ffc870] transition-colors text-center"
            >
              See All Plans &rarr;
            </a>
            <a
              href="/login"
              className="px-8 py-3 border border-slate-300 text-[#4a4035] font-mono text-xs font-bold tracking-[0.2em] uppercase hover:bg-slate-50 transition-colors text-center"
            >
              Start Free with Heimdall &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* ═══ 7. Footer CTA ═══ */}
      <section className="py-14 px-8 bg-[#2a2520] text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-headline text-3xl md:text-4xl font-black mb-4 tracking-tight">
            The forge awaits.
          </h2>
          <p className="text-white/70 leading-relaxed mb-8">
            Connect your first source. See AI learn your data in under two minutes.
          </p>
          <a
            href="/login"
            className="inline-block px-12 py-4 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.3em] uppercase hover:bg-[#ffc870] transition-colors"
          >
            Start with Odin
          </a>
          <div className="mt-4">
            <a
              href="/login"
              className="font-mono text-[11px] tracking-[0.2em] text-white/40 uppercase hover:text-white/70 transition-colors"
            >
              Or start free with Heimdall &rarr;
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
