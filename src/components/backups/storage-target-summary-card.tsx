interface StorageTargetSummaryCardProps {
  target: {
    id?: string;
    name: string;
    provider: string;
    accessMode: string;
    config: Record<string, unknown>;
    status?: string;
    lastTestedAt?: string | null;
    lastTestResult?: unknown;
  };
}

function value(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function lastTestSummary(result: unknown): string {
  if (!result || typeof result !== "object") return "No test recorded";
  const data = result as { ok?: boolean; checks?: Array<{ status?: string }> };
  if (data.ok) return "Passed";
  const failed = data.checks?.filter((check) => check.status === "failed").length ?? 0;
  return failed > 0 ? `${failed} failed check${failed === 1 ? "" : "s"}` : "Warnings only";
}

export function StorageTargetSummaryCard({ target }: StorageTargetSummaryCardProps) {
  const config = target.config ?? {};
  const bucket = value(config.bucket);
  const region = value(config.region ?? config.location);
  const prefix = value(config.prefix, "postgres");

  return (
    <div className="border border-border bg-deep p-5">
      <div className="flex items-start justify-between gap-4 mb-4 pb-2 border-b border-border">
        <div>
          <h2 className="heading-norse text-sm">{target.name}</h2>
          <p className="text-text-dim text-xs tracking-wide mt-1">{bucket}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${target.status === "ERROR" ? "bg-ember status-pulse-red" : target.status === "DISABLED" ? "bg-gray-600" : "bg-emerald-400"}`} />
          <span className="text-text-dim text-[0.6rem] tracking-[0.2em] uppercase">{target.status ?? "ACTIVE"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
        {[
          ["Provider", target.provider.replace(/_/g, " ")],
          ["Access", target.accessMode.replace(/_/g, " ")],
          ["Region", region],
          ["Prefix", prefix],
          ["Retention", `${value(config.retentionDays, "30")} days`],
          ["Last Test", target.lastTestedAt ? new Date(target.lastTestedAt).toLocaleString() : "Never"],
        ].map(([label, text]) => (
          <div key={label} className="bg-deep p-3">
            <span className="label-norse mb-1">{label}</span>
            <p className="text-text text-xs tracking-wide break-all">{text}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border border-border/60 bg-void/30 p-3">
        <span className="label-norse mb-1">Latest Test Result</span>
        <p className="text-text-dim text-xs tracking-wide">{lastTestSummary(target.lastTestResult)}</p>
      </div>
    </div>
  );
}
