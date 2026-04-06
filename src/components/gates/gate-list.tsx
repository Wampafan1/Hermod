"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

// ─── Types ────���─────────────────────────────────────

interface GateItem {
  id: string;
  name: string;
  realmType: string;
  status: string;
  connectionName: string;
  connectionType: string;
  targetTable: string;
  targetSchema: string | null;
  mergeStrategy: string;
  primaryKeyColumns: unknown;
  lastPushAt: string | null;
  pushCount: number;
}

// ─── Helpers ───────��────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Gate Card ──────────────────────────────────────

function GateCard({ gate }: { gate: GateItem }) {
  const router = useRouter();
  const toast = useToast();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVanaheim = gate.realmType === "VANAHEIM";
  const realmColor = isVanaheim ? "#7eb8d4" : "#a1887f";

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      // Call push API inline, then navigate to detail for confirmation
      toast.success(`Validating file for ${gate.name}...`);
      const formData = new FormData();
      formData.append("file", file);

      try {
        const res = await fetch(`/api/gates/${gate.id}/push`, {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        if (data.status === "VALIDATED" || data.status === "SCHEMA_DRIFT") {
          // Navigate to detail page with pushId for confirmation/resolution
          router.push(`/gates/${gate.id}?pushId=${data.pushId}&pushStatus=${data.status}`);
        } else {
          toast.error(data.error || "Push validation failed");
        }
      } catch {
        toast.error("Network error during validation");
      }
    },
    [gate.id, gate.name, router, toast]
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`card-norse p-4 space-y-3 transition-all ${
        dragOver ? "ring-1" : ""
      }`}
      style={dragOver ? { borderColor: realmColor, boxShadow: `0 0 12px ${realmColor}20` } : undefined}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <Link href={`/gates/${gate.id}`} className="group">
          <h3 className="text-text text-sm font-cinzel uppercase tracking-[0.06em] group-hover:text-gold transition-colors">
            {gate.name}
          </h3>
        </Link>
        <span
          className="text-[9px] uppercase tracking-[0.15em] px-1.5 py-0.5 border"
          style={{
            color: realmColor,
            borderColor: `${realmColor}40`,
            background: `${realmColor}08`,
          }}
        >
          {isVanaheim ? "Vanaheim" : "Jotunheim"}
        </span>
      </div>

      {/* Destination */}
      <div className="font-inconsolata text-text-dim text-[11px]">
        {gate.connectionName} → {gate.targetSchema ? `${gate.targetSchema}.` : ""}
        {gate.targetTable}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-[9px] text-text-dim">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            gate.status === "ACTIVE" ? "bg-emerald-400" : gate.status === "PAUSED" ? "bg-amber-400" : "bg-gray-500"
          }`}
          title={gate.status}
        />
        <span className="badge-neutral">{gate.mergeStrategy.replace(/_/g, " ")}</span>
        {gate.pushCount > 0 && (
          <span>{gate.pushCount} push{gate.pushCount !== 1 ? "es" : ""}</span>
        )}
        {gate.lastPushAt && <span>Last: {relativeTime(gate.lastPushAt)}</span>}
      </div>

      {/* Drop zone hint */}
      <div
        className={`border border-dashed flex items-center justify-center py-2 text-[9px] uppercase tracking-[0.2em] transition-all ${
          dragOver
            ? "border-current text-current bg-current/[0.04]"
            : "border-[rgba(201,147,58,0.08)] text-text-dim/50"
        }`}
        style={dragOver ? { color: realmColor, borderColor: realmColor } : undefined}
      >
        {dragOver ? "Release to push" : "Drop file to push"}
      </div>

      <input ref={fileInputRef} type="file" className="hidden" />
    </div>
  );
}

// ─── Main Component ──���──────────────────────────────

export function GateList({ gates }: { gates: GateItem[] }) {
  if (gates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <span className="text-4xl text-text-dim mb-4">ᚷ</span>
        <h2 className="heading-norse text-base mb-2">No gates yet</h2>
        <p className="text-text-dim text-xs tracking-wide mb-6">
          Gates are on-demand file push portals. Create one to start.
        </p>
        <Link href="/gates/new" className="btn-primary">
          Create your first gate
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {gates.map((gate) => (
        <GateCard key={gate.id} gate={gate} />
      ))}
    </div>
  );
}
