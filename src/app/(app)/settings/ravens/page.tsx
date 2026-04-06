"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

interface RavenSummary {
  id: string;
  name: string;
  status: string;
  statusDisplay: string;
  version: string | null;
  hostname: string | null;
  platform: string | null;
  lastHeartbeatAt: string | null;
  connections: unknown[] | null;
  jobCount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: "#66bb6a",
  stale: "#ffb74d",
  disconnected: "#ef5350",
  revoked: "rgba(232, 224, 208, 0.3)",
  pending: "rgba(232, 224, 208, 0.5)",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  stale: "Stale",
  disconnected: "Disconnected",
  revoked: "Revoked",
  pending: "Pending",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function RavensPage() {
  const router = useRouter();
  const toast = useToast();
  const [ravens, setRavens] = useState<RavenSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRavens = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ravens");
      if (!res.ok) throw new Error("Failed to load Ravens");
      setRavens(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load Ravens");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRavens();
    // Refresh every 30s to keep heartbeat status current
    const interval = setInterval(fetchRavens, 30_000);
    return () => clearInterval(interval);
  }, [fetchRavens]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="font-cinzel text-gold-bright uppercase tracking-[0.25em] text-lg"
          >
            Ravens
          </h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            On-premises data agents connected to your Hermod instance
          </p>
        </div>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // TODO: replace with actual download URL
            toast.info("Raven download will be available soon");
          }}
          className="btn-primary text-xs"
        >
          Download Raven
        </a>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-text-dim text-xs tracking-wide text-center py-16">
          Loading Ravens...
        </div>
      ) : ravens.length === 0 ? (
        <div
          className="border border-gold-dim/20 p-12 text-center"
          style={{ background: "rgba(4,6,15,0.9)" }}
        >
          <div className="text-4xl mb-4 opacity-30">ᚱ</div>
          <p className="text-text-dim text-sm tracking-wide">
            No Ravens connected
          </p>
          <p className="text-text-dim/60 text-xs tracking-wide mt-2 max-w-md mx-auto">
            Download and install a Raven agent to bridge your on-premises
            databases to Hermod
          </p>
        </div>
      ) : (
        <div className="grid gap-px bg-gold-dim/10">
          {ravens.map((raven) => (
            <button
              key={raven.id}
              onClick={() => router.push(`/settings/ravens/${raven.id}`)}
              className="w-full text-left p-4 hover:bg-gold-dim/5 transition-colors duration-300"
              style={{ background: "rgba(4,6,15,0.9)" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Status dot */}
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        STATUS_COLORS[raven.statusDisplay] ?? STATUS_COLORS.pending,
                    }}
                  />
                  <div>
                    <div className="text-text text-sm tracking-wide">
                      {raven.name}
                    </div>
                    <div className="text-text-dim text-xs tracking-wide mt-0.5 flex items-center gap-3">
                      {raven.hostname && (
                        <span className="font-mono">{raven.hostname}</span>
                      )}
                      <span>
                        {STATUS_LABELS[raven.statusDisplay] ?? "Unknown"}
                      </span>
                      <span>
                        Heartbeat {relativeTime(raven.lastHeartbeatAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-text-dim text-xs tracking-wide">
                  {raven.version && <span>v{raven.version}</span>}
                  <span>
                    {Array.isArray(raven.connections)
                      ? raven.connections.length
                      : 0}{" "}
                    conn
                  </span>
                  <span>{raven.jobCount} jobs</span>
                  <span className="text-gold-dim">&#x276F;</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
