"use client";

import { useState, useEffect, useCallback } from "react";
import { CatalogSearch } from "@/components/alfheim/catalog-search";
import { CatalogSidebar } from "@/components/alfheim/catalog-sidebar";
import { ConnectorCard } from "@/components/alfheim/connector-card";

interface Connector {
  slug: string;
  name: string;
  description: string;
  category: string;
  logoUrl?: string | null;
  docsUrl?: string | null;
  _count?: { objects: number };
}

interface Category {
  name: string;
  count: number;
}

interface CatalogResponse {
  connectors: Connector[];
  total: number;
  categories: Category[];
}

export function CatalogBrowse() {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCatalog = useCallback(async (search: string, category: string | null) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);

      const res = await fetch(`/api/alfheim/catalog?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load catalog (${res.status})`);
      }

      const data: CatalogResponse = await res.json();
      setConnectors(data.connectors);
      setCategories(data.categories);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog(searchTerm, activeCategory);
  }, [searchTerm, activeCategory, fetchCatalog]);

  function handleRetry() {
    fetchCatalog(searchTerm, activeCategory);
  }

  return (
    <div>
      <CatalogSearch
        value={searchTerm}
        onChange={setSearchTerm}
        resultCount={connectors.length}
        total={total}
      />

      <div className="flex gap-6 mt-6">
        <CatalogSidebar
          categories={categories}
          activeCategory={activeCategory}
          onSelect={setActiveCategory}
          className="w-48 shrink-0"
        />

        <div className="flex-1">
          {/* Error state */}
          {error && (
            <div className="text-center py-12 bg-deep border border-border">
              <p className="text-error text-xs tracking-wide mb-3">{error}</p>
              <button onClick={handleRetry} className="btn-ghost text-xs">
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Loading state */}
          {loading && !error && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="card-norse">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 skeleton-norse shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-24 skeleton-norse" />
                      <div className="h-3 w-16 skeleton-norse" />
                      <div className="h-3 w-full skeleton-norse mt-2" />
                      <div className="h-3 w-3/4 skeleton-norse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && connectors.length === 0 && (
            <div className="text-center py-12 bg-deep border border-border">
              <span className="text-gold/20 text-2xl font-cinzel block mb-3">&#x16B7;</span>
              <p className="text-text-dim text-xs tracking-wide">
                No connectors match your search.
              </p>
            </div>
          )}

          {/* Results grid */}
          {!loading && !error && connectors.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connectors.map((c) => (
                <ConnectorCard key={c.slug} connector={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
