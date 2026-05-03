interface StorageTestCheck {
  name: string;
  status: "passed" | "failed" | "warning";
  message?: string;
}

interface StorageTestResult {
  ok: boolean;
  checks: StorageTestCheck[];
  error?: string;
}

interface StorageTestPanelProps {
  result: StorageTestResult | null;
  testing?: boolean;
  onTest?: () => void;
  title?: string;
}

const CHECK_STYLE: Record<StorageTestCheck["status"], string> = {
  passed: "text-emerald-400",
  failed: "text-ember",
  warning: "text-amber-300",
};

const CHECK_MARK: Record<StorageTestCheck["status"], string> = {
  passed: "OK",
  failed: "X",
  warning: "!",
};

export function StorageTestPanel({ result, testing = false, onTest, title = "Storage Test" }: StorageTestPanelProps) {
  return (
    <div className="border border-border bg-deep p-5">
      <div className="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-border">
        <h2 className="heading-norse text-xs">{title}</h2>
        {onTest && (
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="btn-ghost px-3 py-1.5 text-[0.6rem] tracking-[0.15em] uppercase"
          >
            {testing ? "Testing..." : "Run Test"}
          </button>
        )}
      </div>

      {!result && (
        <p className="text-text-dim text-xs tracking-wide leading-6">
          Hermod will verify bucket access with a real list, write, read, and delete cycle before the target is marked active.
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${result.ok ? "bg-emerald-400" : "bg-ember status-pulse-red"}`} />
            <span className="text-xs tracking-[0.18em] uppercase text-text-dim">
              {result.ok ? "Required checks passed" : "Action needed"}
            </span>
          </div>

          {result.error && (
            <div className="border border-ember/30 bg-ember/10 p-3 text-xs tracking-wide leading-6 text-ember">
              {result.error}
            </div>
          )}

          <div className="space-y-2">
            {(result.checks ?? []).map((check) => (
              <div key={`${check.name}-${check.status}`} className="border border-border/60 bg-void/30 p-3">
                <div className="flex items-center gap-2">
                  <span className={`font-mono text-xs ${CHECK_STYLE[check.status]}`}>
                    {CHECK_MARK[check.status]}
                  </span>
                  <span className="text-text text-xs tracking-wider">{check.name}</span>
                </div>
                {check.message && (
                  <p className="text-text-dim text-[0.7rem] tracking-wide leading-5 mt-1 pl-5">
                    {check.message}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export type { StorageTestResult };
