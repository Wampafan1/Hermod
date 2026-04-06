"use client";

import { memo } from "react";

interface RoutePreviewProps {
  sourceType: "NETSUITE" | "BIGQUERY";
  sourceName: string;
  destName: string;
  forgeEnabled: boolean;
  viaRaven?: boolean;
}

const REALMS = {
  alfheim: { label: "Alfheim", color: "#ce93d8", rune: "ᚨ" },
  nidavellir: { label: "Nidavellir", color: "#ffb74d", rune: "ᚾ" },
  asgard: { label: "Asgard", color: "#d4af37", rune: "ᚷ" },
};

function RealmNode({
  realm,
  sublabel,
  active,
}: {
  realm: keyof typeof REALMS;
  sublabel: string;
  active: boolean;
}) {
  const { label, color, rune } = REALMS[realm];
  return (
    <div
      className="flex flex-col items-center gap-1 transition-all duration-500"
      style={{ opacity: active ? 1 : 0.25 }}
    >
      <div
        className="w-10 h-10 flex items-center justify-center border transition-all duration-500"
        style={{
          borderColor: active ? color : "rgba(201,147,58,0.15)",
          backgroundColor: active ? `${color}15` : "transparent",
          boxShadow: active ? `0 0 12px ${color}40` : "none",
        }}
      >
        <span
          className="text-lg font-cinzel transition-colors duration-500"
          style={{ color: active ? color : "rgba(212,196,160,0.25)" }}
        >
          {rune}
        </span>
      </div>
      <span
        className="text-[0.5rem] tracking-[0.2em] uppercase font-cinzel transition-colors duration-500"
        style={{ color: active ? color : "rgba(212,196,160,0.25)" }}
      >
        {label}
      </span>
      <span className="text-[0.5rem] tracking-wider text-text-dim max-w-[100px] truncate text-center">
        {sublabel}
      </span>
    </div>
  );
}

function BifrostBridge({ active }: { active: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center relative h-10">
      {/* Base line */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-px w-full transition-all duration-500"
        style={{
          background: active
            ? "linear-gradient(90deg, #ce93d840, #d4af3780, #ffb74d40)"
            : "rgba(201,147,58,0.1)",
        }}
      />
      {/* Animated pulse */}
      {active && (
        <div
          className="absolute top-1/2 -translate-y-1/2 h-0.5 w-full bifrost-flow"
          style={{
            background:
              "linear-gradient(90deg, transparent, #d4af37, transparent)",
            animation: "bifrostFlow 2s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

export const RoutePreview = memo(function RoutePreview({
  sourceType,
  sourceName,
  destName,
  forgeEnabled,
  viaRaven,
}: RoutePreviewProps) {
  const sourceLabel = viaRaven
    ? "Data Agent"
    : sourceType === "NETSUITE"
      ? "NetSuite"
      : "BigQuery";

  return (
    <div className="border border-border bg-deep px-6 py-4">
      <div className="flex items-center gap-0">
        {/* Source realm */}
        <RealmNode
          realm="alfheim"
          sublabel={sourceName || sourceLabel}
          active
        />

        {/* Bridge to forge or dest */}
        <BifrostBridge active />

        {/* Forge realm */}
        <RealmNode
          realm="nidavellir"
          sublabel={forgeEnabled ? "Transform" : "forge off"}
          active={forgeEnabled}
        />

        {/* Bridge to destination */}
        <BifrostBridge active />

        {/* Destination realm */}
        <RealmNode
          realm="asgard"
          sublabel={destName || "BigQuery"}
          active
        />
      </div>

      {/* Route summary line */}
      <div className="text-center mt-3">
        <span className="text-[0.55rem] tracking-[0.2em] uppercase text-text-dim">
          {sourceLabel}
          {viaRaven && " (via agent)"}
          {forgeEnabled ? " → Forge → " : " → "}
          BigQuery
        </span>
      </div>
    </div>
  );
});
