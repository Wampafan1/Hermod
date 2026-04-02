"use client";

import { useState, useMemo, useCallback } from "react";

interface AuthField {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  required: boolean;
}

interface VariantDef {
  key: string;
  label: string;
  description: string;
  baseUrl: string;
  authType: string;
  fields: AuthField[];
  headerName?: string;
  tokenPrefix?: string;
  pagination: Record<string, unknown>;
  objectPrefix: string;
}

interface WizardCredentialsProps {
  connector: {
    slug: string;
    name: string;
    baseUrl: string;
    authType: string;
    authConfig: {
      fields: AuthField[];
      headerName?: string;
      tokenPrefix?: string;
      urlPlaceholders?: string[];
      variants?: VariantDef[];
    };
  };
  onComplete: (credentials: Record<string, string>, resolvedBaseUrl: string, selectedVariant?: VariantDef) => void;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success" }
  | { status: "error"; message: string };

function humanizePlaceholder(key: string): string {
  // "{store}" → "Your store name", "{domain}" → "Your domain name"
  const clean = key.replace(/[{}]/g, "");
  const words = clean.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").trim().toLowerCase();
  return `Your ${words}`;
}

export function WizardCredentials({ connector, onComplete }: WizardCredentialsProps) {
  const variants = connector.authConfig.variants;
  const hasVariants = variants && variants.length > 0;

  const [selectedVariantKey, setSelectedVariantKey] = useState<string>(
    hasVariants ? variants[0].key : "",
  );

  const activeVariant = hasVariants
    ? variants.find((v) => v.key === selectedVariantKey) ?? variants[0]
    : undefined;

  // Use variant fields if available, otherwise fall back to top-level
  const urlPlaceholders = connector.authConfig.urlPlaceholders ?? [];
  const credentialFields = activeVariant?.fields ?? connector.authConfig.fields ?? [];

  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of urlPlaceholders) {
      init[p] = "";
    }
    return init;
  });

  const [credentialValues, setCredentialValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of credentialFields) {
      init[f.key] = "";
    }
    return init;
  });

  // Reset credential values when variant changes
  const handleVariantChange = useCallback((key: string) => {
    setSelectedVariantKey(key);
    setCredentialValues({});
    setTestState({ status: "idle" });
  }, []);

  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  const resolvedBaseUrl = useMemo(() => {
    let url = activeVariant?.baseUrl ?? connector.baseUrl;
    for (const key of urlPlaceholders) {
      const value = placeholderValues[key] ?? "";
      url = url.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
    return url;
  }, [activeVariant, connector.baseUrl, urlPlaceholders, placeholderValues]);

  const allRequiredFilled = useMemo(() => {
    // All URL placeholders must be filled
    for (const key of urlPlaceholders) {
      if (!placeholderValues[key]?.trim()) return false;
    }
    // All required credential fields must be filled
    for (const field of credentialFields) {
      if (field.required && !credentialValues[field.key]?.trim()) return false;
    }
    return true;
  }, [urlPlaceholders, placeholderValues, credentialFields, credentialValues]);

  const handlePlaceholderChange = useCallback((key: string, value: string) => {
    setPlaceholderValues((prev) => ({ ...prev, [key]: value }));
    setTestState({ status: "idle" });
  }, []);

  const handleCredentialChange = useCallback((key: string, value: string) => {
    setCredentialValues((prev) => ({ ...prev, [key]: value }));
    setTestState({ status: "idle" });
  }, []);

  const handleTest = useCallback(async () => {
    setTestState({ status: "testing" });

    try {
      const allCredentials: Record<string, string> = {
        ...placeholderValues,
        ...credentialValues,
      };

      const res = await fetch(`/api/alfheim/catalog/${connector.slug}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: allCredentials }),
      });

      const data = await res.json();

      if (!res.ok) {
        setTestState({
          status: "error",
          message: data.error ?? `Request failed (${res.status})`,
        });
        return;
      }

      if (data.success) {
        setTestState({ status: "success" });
      } else {
        setTestState({
          status: "error",
          message: data.error ?? "Connection test failed",
        });
      }
    } catch (err) {
      setTestState({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }, [connector.slug, placeholderValues, credentialValues]);

  const handleNext = useCallback(() => {
    const allCredentials: Record<string, string> = {
      ...placeholderValues,
      ...credentialValues,
    };
    onComplete(allCredentials, resolvedBaseUrl, activeVariant);
  }, [placeholderValues, credentialValues, resolvedBaseUrl, activeVariant, onComplete]);

  return (
    <div className="space-y-6">
      {/* Title */}
      <h2 className="heading-norse">
        <span className="text-gold mr-2">&#10022;</span>
        Connect to {connector.name}
      </h2>

      {/* Variant Selector */}
      {hasVariants && variants && (
        <fieldset className="space-y-3">
          <legend className="label-norse mb-2">API Version</legend>
          <div className="space-y-2">
            {variants.map((v) => (
              <label
                key={v.key}
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  selectedVariantKey === v.key
                    ? "border-gold bg-gold/5"
                    : "border-border hover:border-gold-dim"
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  value={v.key}
                  checked={selectedVariantKey === v.key}
                  onChange={() => handleVariantChange(v.key)}
                  className="mt-0.5 accent-[var(--gold)]"
                />
                <div>
                  <span className="text-text text-sm font-medium">{v.label}</span>
                  <p className="text-text-dim text-xs mt-0.5">{v.description}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* URL Placeholder Fields */}
      {urlPlaceholders.length > 0 && (
        <fieldset className="space-y-4">
          <legend className="label-norse mb-2">Connection Details</legend>
          {urlPlaceholders.map((key) => (
            <div key={key}>
              <label htmlFor={`ph-${key}`} className="label-norse block mb-1">
                {humanizePlaceholder(key)}
              </label>
              <input
                id={`ph-${key}`}
                type="text"
                className="input-norse w-full"
                placeholder={key}
                value={placeholderValues[key] ?? ""}
                onChange={(e) => handlePlaceholderChange(key, e.target.value)}
              />
            </div>
          ))}
        </fieldset>
      )}

      {/* Credential Fields */}
      {credentialFields.length > 0 && (
        <fieldset className="space-y-4">
          <legend className="label-norse mb-2">Credentials</legend>
          {credentialFields.map((field) => (
            <div key={field.key}>
              <label htmlFor={`cred-${field.key}`} className="label-norse block mb-1">
                {field.label}
                {field.required && <span className="text-gold ml-1">*</span>}
              </label>
              <input
                id={`cred-${field.key}`}
                type={field.type}
                className="input-norse w-full"
                placeholder={field.placeholder ?? ""}
                value={credentialValues[field.key] ?? ""}
                onChange={(e) => handleCredentialChange(field.key, e.target.value)}
              />
            </div>
          ))}
        </fieldset>
      )}

      {/* Test + Status + Next */}
      <div className="space-y-3">
        {/* Test Connection Button */}
        <button
          type="button"
          className="btn-primary"
          disabled={!allRequiredFilled || testState.status === "testing"}
          onClick={handleTest}
        >
          {testState.status === "testing" ? (
            <span className="flex items-center gap-2">
              <span className="spinner-norse" style={{ width: 14, height: 14 }} />
              Testing...
            </span>
          ) : (
            "Test Connection"
          )}
        </button>

        {/* Status messages */}
        {testState.status === "success" && (
          <p className="text-sm text-emerald-400">
            &#10003; Connection verified
          </p>
        )}

        {testState.status === "error" && (
          <p className="text-sm text-red-400">
            {testState.message}
          </p>
        )}

        {/* Next button — only after success */}
        {testState.status === "success" && (
          <button
            type="button"
            className="btn-primary"
            onClick={handleNext}
          >
            Next &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
