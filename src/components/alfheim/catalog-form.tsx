"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/components/toast";

interface CatalogFormProps {
  connector?: any; // Existing connector for edit mode, null for create
  onSave: () => void;
  onCancel: () => void;
}

const AUTH_TYPES = ["API_KEY", "BEARER", "BASIC", "OAUTH2", "CUSTOM"] as const;

const AUTH_CONFIG_TEMPLATES: Record<string, object> = {
  API_KEY: {
    headerName: "X-Api-Key",
    headerPrefix: "",
  },
  BEARER: {
    headerName: "Authorization",
    headerPrefix: "Bearer ",
  },
  BASIC: {
    headerName: "Authorization",
    headerPrefix: "Basic ",
  },
  OAUTH2: {
    tokenUrl: "",
    clientIdField: "client_id",
    clientSecretField: "client_secret",
    grantType: "client_credentials",
    scopes: [],
  },
  CUSTOM: {
    headers: {},
    queryParams: {},
  },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function tryParseJson(str: string): { valid: boolean; value?: unknown } {
  if (!str.trim()) return { valid: true, value: {} };
  try {
    return { valid: true, value: JSON.parse(str) };
  } catch {
    return { valid: false };
  }
}

export function CatalogForm({ connector, onSave, onCancel }: CatalogFormProps) {
  const toast = useToast();
  const isEdit = Boolean(connector);

  const [name, setName] = useState(connector?.name ?? "");
  const [slug, setSlug] = useState(connector?.slug ?? "");
  const [description, setDescription] = useState(connector?.description ?? "");
  const [category, setCategory] = useState(connector?.category ?? "");
  const [subcategory, setSubcategory] = useState(connector?.subcategory ?? "");
  const [authType, setAuthType] = useState<string>(connector?.authType ?? "API_KEY");
  const [baseUrl, setBaseUrl] = useState(connector?.baseUrl ?? "");
  const [docsUrl, setDocsUrl] = useState(connector?.docsUrl ?? "");
  const [popularity, setPopularity] = useState<number>(connector?.popularity ?? 0);
  const [authConfig, setAuthConfig] = useState(
    connector?.authConfig
      ? JSON.stringify(connector.authConfig, null, 2)
      : JSON.stringify(AUTH_CONFIG_TEMPLATES["API_KEY"], null, 2)
  );
  const [pagination, setPagination] = useState(
    connector?.pagination
      ? JSON.stringify(connector.pagination, null, 2)
      : JSON.stringify({ type: "offset", limitParam: "limit", offsetParam: "offset", defaultLimit: 100 }, null, 2)
  );
  const [rateLimiting, setRateLimiting] = useState(
    connector?.rateLimiting
      ? JSON.stringify(connector.rateLimiting, null, 2)
      : ""
  );

  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  // Auto-generate slug from name in create mode
  useEffect(() => {
    if (!isEdit) {
      setSlug(slugify(name));
    }
  }, [name, isEdit]);

  // Update authConfig template when authType changes (only if creating or field is default)
  const handleAuthTypeChange = useCallback((newType: string) => {
    setAuthType(newType);
    const template = AUTH_CONFIG_TEMPLATES[newType];
    if (template) {
      setAuthConfig(JSON.stringify(template, null, 2));
    }
  }, []);

  // Fetch existing categories for datalist
  useEffect(() => {
    fetch("/api/alfheim/catalog/categories")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCategories(data.map((c: { name: string }) => c.name));
        }
      })
      .catch(() => {});
  }, []);

  function validateJson(field: string, value: string, required: boolean): object | null {
    if (!value.trim()) {
      if (required) {
        setJsonErrors((prev) => ({ ...prev, [field]: "This field is required" }));
        return null;
      }
      return {};
    }
    const result = tryParseJson(value);
    if (!result.valid) {
      setJsonErrors((prev) => ({ ...prev, [field]: "Invalid JSON" }));
      return null;
    }
    setJsonErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    return result.value as object;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setJsonErrors({});

    const authConfigParsed = validateJson("authConfig", authConfig, true);
    const paginationParsed = validateJson("pagination", pagination, true);
    const rateLimitingParsed = validateJson("rateLimiting", rateLimiting, false);

    if (authConfigParsed === null || paginationParsed === null) return;
    if (rateLimiting.trim() && rateLimitingParsed === null) return;

    const payload: Record<string, unknown> = {
      name,
      description,
      category,
      subcategory: subcategory || undefined,
      authType,
      baseUrl,
      docsUrl: docsUrl || undefined,
      popularity,
      authConfig: authConfigParsed,
      pagination: paginationParsed,
      rateLimiting: rateLimitingParsed || undefined,
    };

    if (!isEdit) {
      payload.slug = slug;
    }

    setSaving(true);
    try {
      const url = isEdit
        ? `/api/alfheim/catalog/${connector.slug}`
        : "/api/alfheim/catalog";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} connector`);
      }

      toast.success(isEdit ? "Connector updated" : "Connector created");
      onSave();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card-norse p-5 space-y-4">
      <h3 className="heading-norse text-sm">
        {isEdit ? "Edit Connector" : "Add Connector"}
      </h3>

      {/* Row: Name + Slug */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Name</label>
          <input
            type="text"
            className="input-norse w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Stripe"
          />
        </div>
        {!isEdit && (
          <div>
            <label className="label-norse">Slug</label>
            <input
              type="text"
              className="input-norse w-full"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              placeholder="e.g. stripe"
              pattern="[a-z0-9-]+"
            />
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="label-norse">Description</label>
        <textarea
          className="input-norse w-full min-h-[60px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          placeholder="Brief description of the API connector"
        />
      </div>

      {/* Row: Category + Subcategory */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Category</label>
          <input
            type="text"
            className="input-norse w-full"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            list="catalog-categories"
            placeholder="e.g. Payments"
          />
          <datalist id="catalog-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label-norse">Subcategory</label>
          <input
            type="text"
            className="input-norse w-full"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      {/* Row: Auth Type + Base URL */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Auth Type</label>
          <select
            className="select-norse w-full"
            value={authType}
            onChange={(e) => handleAuthTypeChange(e.target.value)}
          >
            {AUTH_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-norse">Base URL</label>
          <input
            type="text"
            className="input-norse w-full"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
            placeholder="https://api.example.com/v1"
          />
        </div>
      </div>

      {/* Row: Docs URL + Popularity */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Docs URL</label>
          <input
            type="text"
            className="input-norse w-full"
            value={docsUrl}
            onChange={(e) => setDocsUrl(e.target.value)}
            placeholder="https://docs.example.com"
          />
        </div>
        <div>
          <label className="label-norse">Popularity</label>
          <input
            type="number"
            className="input-norse w-full"
            value={popularity}
            onChange={(e) => setPopularity(Number(e.target.value))}
            min={0}
          />
        </div>
      </div>

      {/* Auth Config JSON */}
      <div>
        <label className="label-norse">Auth Config (JSON)</label>
        <textarea
          className="input-norse w-full min-h-[100px] font-inconsolata text-xs"
          value={authConfig}
          onChange={(e) => setAuthConfig(e.target.value)}
          spellCheck={false}
        />
        {jsonErrors.authConfig && (
          <p className="text-error text-xs mt-1">{jsonErrors.authConfig}</p>
        )}
      </div>

      {/* Pagination JSON */}
      <div>
        <label className="label-norse">Pagination (JSON)</label>
        <textarea
          className="input-norse w-full min-h-[80px] font-inconsolata text-xs"
          value={pagination}
          onChange={(e) => setPagination(e.target.value)}
          spellCheck={false}
        />
        {jsonErrors.pagination && (
          <p className="text-error text-xs mt-1">{jsonErrors.pagination}</p>
        )}
      </div>

      {/* Rate Limiting JSON */}
      <div>
        <label className="label-norse">Rate Limiting (JSON, optional)</label>
        <textarea
          className="input-norse w-full min-h-[60px] font-inconsolata text-xs"
          value={rateLimiting}
          onChange={(e) => setRateLimiting(e.target.value)}
          spellCheck={false}
          placeholder='e.g. { "requestsPerMinute": 60 }'
        />
        {jsonErrors.rateLimiting && (
          <p className="text-error text-xs mt-1">{jsonErrors.rateLimiting}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2 border-t border-border">
        <button type="button" onClick={onCancel} className="btn-ghost text-xs">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary text-xs">
          {saving ? "Saving..." : isEdit ? "Update Connector" : "Create Connector"}
        </button>
      </div>
    </form>
  );
}
