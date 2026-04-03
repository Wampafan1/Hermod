interface Category {
  name: string;
  count: number;
}

interface CatalogSidebarProps {
  categories: Category[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
  className?: string;
}

export function CatalogSidebar({
  categories,
  activeCategory,
  onSelect,
  className = "",
}: CatalogSidebarProps) {
  const totalCount = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <nav className={className}>
      <p className="font-space-grotesk text-[10px] font-medium tracking-[0.12em] uppercase text-text-dim mb-3">
        Categories
      </p>
      <ul className="space-y-0.5">
        <li>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`w-full text-left px-3 py-1.5 text-xs font-space-grotesk uppercase tracking-[0.08em] transition-colors ${
              activeCategory === null
                ? "border-l-2 border-gold text-gold"
                : "border-l-2 border-transparent text-text-dim hover:text-text"
            }`}
          >
            All ({totalCount})
          </button>
        </li>
        {categories.map((cat) => (
          <li key={cat.name}>
            <button
              type="button"
              onClick={() => onSelect(cat.name)}
              className={`w-full text-left px-3 py-1.5 text-xs font-space-grotesk uppercase tracking-[0.08em] transition-colors ${
                activeCategory === cat.name
                  ? "border-l-2 border-gold text-gold"
                  : "border-l-2 border-transparent text-text-dim hover:text-text"
              }`}
            >
              {cat.name} ({cat.count})
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
