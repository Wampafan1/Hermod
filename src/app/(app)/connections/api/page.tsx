import Link from "next/link";
import { CatalogBrowse } from "@/components/alfheim/catalog-browse";

export default function ApiCatalogPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-norse text-xl">Alfheim</h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Browse and connect to API services
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/connections/api/admin"
            className="text-text-dim text-xs tracking-wide hover:text-text transition-colors"
          >
            Admin
          </Link>
          <Link href="/connections" className="btn-ghost text-xs">
            <span>&larr; Back to Connections</span>
          </Link>
        </div>
      </div>
      {/* Connect Any API — Tier 2 + 3 entry points */}
      <div className="border border-border bg-deep p-6 space-y-5">
        <h2 className="font-cinzel text-sm uppercase tracking-[0.15em] text-gold-bright text-center">
          <span className="text-gold mr-2">&#10022;</span>
          Connect Any API
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/connections/api/import"
            className="border border-border p-5 hover:border-gold transition-colors group"
          >
            <h3 className="font-cinzel text-sm uppercase tracking-[0.08em] text-text group-hover:text-gold transition-colors">
              Import OpenAPI Spec
            </h3>
            <p className="text-text-dim text-xs leading-relaxed mt-2">
              Have a Swagger or OpenAPI spec? Paste the URL or upload the file.
              Endpoints, auth, and schemas auto-populate.
            </p>
            <span className="inline-block mt-3 text-gold text-xs tracking-[0.1em] uppercase font-medium">
              Import Spec &rarr;
            </span>
          </Link>
          <Link
            href="/connections/api/discover"
            className="border border-border p-5 hover:border-gold transition-colors group"
          >
            <h3 className="font-cinzel text-sm uppercase tracking-[0.08em] text-text group-hover:text-gold transition-colors">
              Discover with AI
            </h3>
            <p className="text-text-dim text-xs leading-relaxed mt-2">
              Just paste a URL. AI searches for docs, probes endpoints,
              and maps your schema automatically.
            </p>
            <span className="inline-block mt-3 text-gold text-xs tracking-[0.1em] uppercase font-medium">
              Start Discovery &rarr;
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-text-dim text-[10px] tracking-[0.2em] uppercase">
            &#10022; or pick from catalog
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      </div>

      <CatalogBrowse />
    </div>
  );
}
