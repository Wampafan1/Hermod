"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { WizardCredentials } from "./wizard-credentials";
import { WizardObjects } from "./wizard-objects";
import { WizardDestination } from "./wizard-destination";
import type { DestinationConfig } from "./wizard-destination";
import { WizardReview } from "./wizard-review";

/* ───────────────────────── Types ───────────────────────── */

interface ApiObject {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  endpoint: string;
  incrementalKey?: string | null;
  schema: {
    columns: { jsonPath: string; columnName: string; dataType: string; nullable: boolean }[];
    childTables?: { jsonPath: string; tableName: string; columns: { columnName: string; dataType: string }[] }[];
  };
}

interface ConnectionWizardProps {
  connector: {
    slug: string;
    name: string;
    baseUrl: string;
    authType: string;
    authConfig: any;
    objects: ApiObject[];
  };
}

const STEP_LABELS = ["Credentials", "Objects", "Destination", "Review"] as const;

/* ───────────────────────── Component ──────────────────── */

export function ConnectionWizard({ connector }: ConnectionWizardProps) {
  const router = useRouter();

  /* ── Step tracking ── */
  const [currentStep, setCurrentStep] = useState(1);

  /* ── Accumulated wizard data ── */
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [resolvedBaseUrl, setResolvedBaseUrl] = useState("");
  const [selectedObjectSlugs, setSelectedObjectSlugs] = useState<string[]>([]);
  const [destinationConfig, setDestinationConfig] =
    useState<DestinationConfig | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<{
    key: string; label: string; objectPrefix: string;
    authType: string; baseUrl: string; pagination: Record<string, unknown>;
  } | undefined>(undefined);

  /* ── Filter objects by variant prefix (if a variant was selected) ── */
  const availableObjects = useMemo(() => {
    if (!selectedVariant?.objectPrefix) return connector.objects;
    return connector.objects.filter((o) =>
      o.slug.startsWith(selectedVariant.objectPrefix),
    );
  }, [connector.objects, selectedVariant]);

  /* ── Resolved selected objects (full data, not just slugs) ── */
  const selectedObjects = useMemo(
    () =>
      connector.objects.filter((o) => selectedObjectSlugs.includes(o.slug)),
    [connector.objects, selectedObjectSlugs],
  );

  /* ── Step handlers ── */
  const handleCredentialsComplete = useCallback(
    (creds: Record<string, string>, baseUrl: string, variant?: { key: string; label: string; objectPrefix: string; authType: string; baseUrl: string; pagination: Record<string, unknown> }) => {
      setCredentials(creds);
      setResolvedBaseUrl(baseUrl);
      setSelectedVariant(variant);
      setCurrentStep(2);
    },
    [],
  );

  const handleObjectsComplete = useCallback((slugs: string[]) => {
    setSelectedObjectSlugs(slugs);
    setCurrentStep(3);
  }, []);

  const handleDestinationComplete = useCallback((config: DestinationConfig) => {
    setDestinationConfig(config);
    setCurrentStep(4);
  }, []);

  const handleFinalComplete = useCallback(() => {
    router.push("/bifrost");
  }, [router]);

  const handleBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(1, prev - 1));
  }, []);

  /* ── Render ── */
  return (
    <div>
      {/* Horizontal stepper */}
      <nav className="flex items-center gap-1 mb-8" aria-label="Wizard progress">
        {STEP_LABELS.map((label, idx) => {
          const stepNum = idx + 1;
          const isCompleted = stepNum < currentStep;
          const isCurrent = stepNum === currentStep;

          return (
            <div key={label} className="flex items-center flex-1">
              {/* Step indicator */}
              <div className="flex items-center gap-2 flex-1">
                <span
                  className={`
                    inline-flex items-center justify-center w-7 h-7 text-xs font-space-grotesk
                    border transition-colors shrink-0
                    ${
                      isCurrent
                        ? "border-gold bg-gold/10 text-gold"
                        : isCompleted
                          ? "border-emerald-600 bg-emerald-900/30 text-emerald-400"
                          : "border-border text-text-dim"
                    }
                  `}
                >
                  {isCompleted ? "\u2713" : stepNum}
                </span>
                <span
                  className={`
                    text-[10px] font-space-grotesk uppercase tracking-[0.12em] whitespace-nowrap
                    ${
                      isCurrent
                        ? "text-gold"
                        : isCompleted
                          ? "text-emerald-400"
                          : "text-text-dim"
                    }
                  `}
                >
                  {label}
                </span>
              </div>

              {/* Connector line (not after last step) */}
              {idx < STEP_LABELS.length - 1 && (
                <div
                  className={`h-px flex-1 mx-2 ${
                    stepNum < currentStep
                      ? "bg-emerald-600/50"
                      : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* Step content */}
      {currentStep === 1 && (
        <WizardCredentials
          connector={connector}
          onComplete={handleCredentialsComplete}
        />
      )}

      {currentStep === 2 && (
        <WizardObjects
          connectorSlug={connector.slug}
          objects={availableObjects}
          onComplete={handleObjectsComplete}
          onBack={handleBack}
        />
      )}

      {currentStep === 3 && (
        <WizardDestination
          selectedObjects={selectedObjects.map((o) => ({
            slug: o.slug,
            name: o.name,
            incrementalKey: o.incrementalKey,
          }))}
          onComplete={handleDestinationComplete}
          onBack={handleBack}
        />
      )}

      {currentStep === 4 && destinationConfig && (
        <WizardReview
          connector={connector}
          credentials={credentials}
          resolvedBaseUrl={resolvedBaseUrl}
          selectedObjects={selectedObjects}
          destinationConfig={destinationConfig}
          selectedVariant={selectedVariant}
          onComplete={handleFinalComplete}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
