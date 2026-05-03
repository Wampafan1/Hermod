"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";

interface MssqlPreflightCheck {
  name: string;
  status: "passed" | "failed" | "warning";
  message?: string;
}

interface MssqlPreflightPanelProps {
  policyId?: string;
  payload?: Record<string, unknown>;
}

const DOT_CLASS: Record<MssqlPreflightCheck["status"], string> = {
  passed: "bg-emerald-400",
  failed: "bg-ember",
  warning: "bg-amber-400",
};

export function MssqlPreflightPanel({ policyId, payload }: MssqlPreflightPanelProps) {
  const toast = useToast();
  const [checks, setChecks] = useState<MssqlPreflightCheck[]>([]);
  const [running, setRunning] = useState(false);

  async function runPreflight() {
    setRunning(true);
    try {
      const endpoint = policyId
        ? `/api/backups/mssql/policies/${policyId}/preflight`
        : "/api/backups/mssql/policies/preflight";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: policyId ? undefined : { "Content-Type": "application/json" },
        body: policyId ? undefined : JSON.stringify(payload ?? {}),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Preflight failed");
      setChecks(result.checks ?? []);
      if (result.ok) toast.success("SQL Server backup preflight passed");
      else toast.error("SQL Server backup preflight found issues");
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
          type="button"
          onClick={runPreflight}
          disabled={running}
          className="btn-subtle text-[0.6rem] px-3 py-1"
        >
          {running ? "Checking..." : "Run Check"}
        </button>
      </div>

      {checks.length === 0 ? (
        <p className="text-text-dim text-xs tracking-wider leading-6">
          Preflight checks connection access, database selection, recovery models, and destination settings.
        </p>
      ) : (
        <div className="space-y-2">
          {checks.map((check) => (
            <div key={`${check.name}:${check.message ?? ""}`} className="flex items-start gap-3 border border-border/50 p-3">
              <span className={`mt-1 h-2 w-2 rounded-full ${DOT_CLASS[check.status]}`} />
              <div>
                <div className="label-norse">{check.name}</div>
                <p className="text-text-dim text-xs tracking-wider leading-relaxed">
                  {check.message ?? check.status.toUpperCase()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
