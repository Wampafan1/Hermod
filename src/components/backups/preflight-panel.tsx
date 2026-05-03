"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";

interface PreflightCheck {
  name: string;
  ok: boolean;
  message: string;
}

export function PreflightPanel({ policyId }: { policyId: string }) {
  const toast = useToast();
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [running, setRunning] = useState(false);

  async function runPreflight() {
    setRunning(true);
    try {
      const res = await fetch(`/api/backups/policies/${policyId}/preflight`, { method: "POST" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Preflight failed");
      setChecks(result.checks ?? []);
      if (result.ok) toast.success("Preflight passed");
      else toast.error("Preflight found issues");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Preflight failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="border border-border bg-deep p-5">
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
        <h2 className="heading-norse text-xs">Preflight</h2>
        <button
          onClick={runPreflight}
          disabled={running}
          className="btn-subtle text-[0.6rem] px-3 py-1"
        >
          {running ? "Checking..." : "Run Check"}
        </button>
      </div>
      {checks.length === 0 ? (
        <p className="text-text-dim text-xs tracking-wider">No preflight results yet.</p>
      ) : (
        <div className="space-y-2">
          {checks.map((check) => (
            <div key={check.name} className="flex items-start gap-3 border border-border/50 p-3">
              <span className={`mt-1 h-2 w-2 rounded-full ${check.ok ? "bg-emerald-400" : "bg-ember"}`} />
              <div>
                <div className="label-norse">{check.name}</div>
                <p className="text-text-dim text-xs tracking-wider leading-relaxed">{check.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
