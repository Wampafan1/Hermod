import Link from "next/link";

/** Category → color tokens for avatar bg/text and badge bg/border/text */
const CATEGORY_COLORS: Record<string, { bg: string; text: string; badgeBg: string; badgeBorder: string; badgeText: string }> = {
  Shipping:              { bg: "bg-frost/15",           text: "text-frost",          badgeBg: "bg-frost/10",           badgeBorder: "border-frost/25",          badgeText: "text-frost" },
  "E-Commerce":          { bg: "bg-[#b48ead]/15",      text: "text-[#b48ead]",      badgeBg: "bg-[#b48ead]/10",      badgeBorder: "border-[#b48ead]/25",      badgeText: "text-[#b48ead]" },
  Payments:              { bg: "bg-[#a3be8c]/15",       text: "text-[#a3be8c]",      badgeBg: "bg-[#a3be8c]/10",      badgeBorder: "border-[#a3be8c]/25",      badgeText: "text-[#a3be8c]" },
  CRM:                   { bg: "bg-[#ebcb8b]/15",       text: "text-[#ebcb8b]",      badgeBg: "bg-[#ebcb8b]/10",      badgeBorder: "border-[#ebcb8b]/25",      badgeText: "text-[#ebcb8b]" },
  Productivity:          { bg: "bg-[#88c0d0]/15",       text: "text-[#88c0d0]",      badgeBg: "bg-[#88c0d0]/10",      badgeBorder: "border-[#88c0d0]/25",      badgeText: "text-[#88c0d0]" },
  "Project Management":  { bg: "bg-[#d08770]/15",       text: "text-[#d08770]",      badgeBg: "bg-[#d08770]/10",      badgeBorder: "border-[#d08770]/25",      badgeText: "text-[#d08770]" },
  Inventory:             { bg: "bg-[#8fbcbb]/15",       text: "text-[#8fbcbb]",      badgeBg: "bg-[#8fbcbb]/10",      badgeBorder: "border-[#8fbcbb]/25",      badgeText: "text-[#8fbcbb]" },
  Accounting:            { bg: "bg-[#a3be8c]/15",       text: "text-[#a3be8c]",      badgeBg: "bg-[#a3be8c]/10",      badgeBorder: "border-[#a3be8c]/25",      badgeText: "text-[#a3be8c]" },
  ITSM:                  { bg: "bg-[#bf616a]/15",       text: "text-[#bf616a]",      badgeBg: "bg-[#bf616a]/10",      badgeBorder: "border-[#bf616a]/25",      badgeText: "text-[#bf616a]" },
};

const DEFAULT_COLORS = { bg: "bg-gold/10", text: "text-gold", badgeBg: "bg-gold/10", badgeBorder: "border-gold-dim", badgeText: "text-gold" };

interface ConnectorCardProps {
  connector: {
    slug: string;
    name: string;
    description: string;
    category: string;
    logoUrl?: string | null;
    docsUrl?: string | null;
    _count?: { objects: number };
  };
}

export function ConnectorCard({ connector }: ConnectorCardProps) {
  const firstLetter = connector.name.charAt(0).toUpperCase();
  const objectCount = connector._count?.objects ?? 0;
  const colors = CATEGORY_COLORS[connector.category] ?? DEFAULT_COLORS;

  return (
    <Link
      href={`/connections/api/${connector.slug}`}
      className="card-norse block relative group hover:border-gold transition-colors"
    >
      {/* Docs link in top-right */}
      {connector.docsUrl && (
        <a
          href={connector.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 text-text-dim text-[10px] tracking-wide hover:text-gold transition-colors"
        >
          Docs &#8599;
        </a>
      )}

      <div className="flex items-start gap-3">
        {/* Avatar */}
        {connector.logoUrl ? (
          <img
            src={connector.logoUrl}
            alt={`${connector.name} logo`}
            className="w-12 h-12 object-contain shrink-0"
          />
        ) : (
          <div className={`w-12 h-12 flex items-center justify-center ${colors.bg} ${colors.text} font-cinzel text-lg shrink-0`}>
            {firstLetter}
          </div>
        )}

        <div className="min-w-0 flex-1">
          {/* Name */}
          <h3 className="font-cinzel text-sm uppercase tracking-[0.06em] text-text">
            {connector.name}
          </h3>

          {/* Category badge */}
          <span className={`mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 border text-[0.6875rem] font-medium tracking-[0.1em] uppercase font-[family-name:var(--font-space-grotesk)] ${colors.badgeBg} ${colors.badgeBorder} ${colors.badgeText}`}>
            {connector.category}
          </span>

          {/* Description */}
          <p className="text-text-dim text-xs mt-2 leading-relaxed line-clamp-3">
            {connector.description}
          </p>

          {/* Object count */}
          {objectCount > 0 && (
            <p className="text-text-dim text-[10px] tracking-wide mt-2 font-space-grotesk uppercase">
              {objectCount} object{objectCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
