"use client";

export interface DiscoveryStep {
  label: string;
  status: "waiting" | "running" | "done" | "error";
  detail?: string;
}

interface DiscoveryProgressProps {
  steps: DiscoveryStep[];
}

const STATUS_ICON: Record<DiscoveryStep["status"], string> = {
  waiting: "\u25CB",
  running: "\u25CF",
  done: "\u2713",
  error: "\u2717",
};

const STATUS_COLOR: Record<DiscoveryStep["status"], string> = {
  waiting: "text-text-dim",
  running: "text-gold animate-pulse",
  done: "text-emerald-400",
  error: "text-red-400",
};

export function DiscoveryProgress({ steps }: DiscoveryProgressProps) {
  return (
    <div className="border border-border bg-deep p-5 space-y-3">
      <h3 className="font-cinzel text-sm uppercase tracking-[0.12em] text-gold">
        <span className="mr-2">&#10022;</span>
        Discovering API
      </h3>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className={`text-sm ${STATUS_COLOR[step.status]}`}>
              {STATUS_ICON[step.status]}
            </span>
            <span className={`text-xs tracking-wide ${
              step.status === "waiting" ? "text-text-dim" : "text-text"
            }`}>
              {step.label}
            </span>
            {step.detail && (
              <span className="text-text-dim text-[10px] tracking-wide ml-auto uppercase">
                {step.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
