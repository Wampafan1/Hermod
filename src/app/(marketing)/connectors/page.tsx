/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import { ConnectorGrid } from "@/components/marketing/connector-grid";

export const metadata: Metadata = {
  title: "Connectors & Integrations | Hermod",
  description:
    "Browse every database, API, file system, and cloud connector Hermod supports. PostgreSQL, BigQuery, NetSuite, ShipStation, Shopify, CSV, Excel, SFTP, and more.",
};

export default function ConnectorsPage() {
  return (
    <>
      {/* ═══ Hero ═══ */}
      <section className="py-16 px-8 bg-[#f5f0e8] text-center">
        <h1 className="font-headline text-4xl md:text-5xl font-bold text-[#2a2520] tracking-tight mb-4">
          Every Source. Every Destination.
        </h1>
        <p className="text-[#4a4035] text-lg leading-relaxed max-w-2xl mx-auto mb-8">
          Databases, APIs, file systems, cloud storage &mdash; browse every connector
          Hermod supports and see exactly what each one can do.
        </p>
      </section>

      {/* ═══ Connector Grid (client component with search + filters) ═══ */}
      <ConnectorGrid />

      {/* ═══ CTA ═══ */}
      <section className="py-16 px-8 bg-[#2a2520] text-white text-center">
        <h2 className="font-headline text-3xl font-bold mb-4 tracking-tight">
          Don&apos;t see your connector?
        </h2>
        <p className="text-white/70 leading-relaxed max-w-xl mx-auto mb-8">
          Hermod&apos;s universal REST connector works with any API.
          On the Odin tier, AI can discover endpoints and map fields automatically.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="/login"
            className="inline-block px-12 py-4 bg-[#ffb74d] text-[#1a1400] font-mono text-xs font-bold tracking-[0.3em] uppercase hover:bg-[#ffc870] transition-colors"
          >
            Start Free &mdash; $0 Forever
          </a>
          <a
            href="/#pricing"
            className="font-mono text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white/80 transition-colors"
          >
            See all plans &rarr;
          </a>
        </div>
      </section>
    </>
  );
}
