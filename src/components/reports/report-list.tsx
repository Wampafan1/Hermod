"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

interface Report {
  id: string;
  name: string;
  description: string | null;
  connectionName: string;
  connectionType: string;
  lastRunStatus: string | null;
  scheduled: boolean;
  scheduleEnabled: boolean;
}

const STATUS_BADGES: Record<string, string> = {
  SUCCESS: "badge-success",
  FAILED: "badge-error",
  RUNNING: "badge-running",
};

export function ReportList({ reports }: { reports: Report[] }) {
  const router = useRouter();
  const toast = useToast();

  async function handleDelete(id: string) {
    if (!confirm("Delete this report and its schedule?")) return;
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Delete failed");
        return;
      }
      toast.success("Report deleted");
      router.refresh();
    } catch {
      toast.error("Network error");
    }
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-16 bg-deep border border-border">
        <span className="text-gold/20 text-3xl font-cinzel block mb-3">ᚱ</span>
        <p className="text-text-dim text-xs tracking-wide">No reports yet.</p>
        <a href="/reports/new" className="btn-subtle mt-3 inline-block">
          Create your first report
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {reports.map((report) => (
        <Link
          key={report.id}
          href={`/reports/${report.id}`}
          className="block bg-deep border border-border p-5 hover:bg-gold/[0.02] transition-colors cursor-pointer no-underline"
        >
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <h3 className="text-text text-sm">{report.name}</h3>
              <div className="flex items-center gap-3">
                <span className="text-text-dim text-xs tracking-wide">
                  {report.connectionName}
                </span>
                {report.lastRunStatus && (
                  <span className={STATUS_BADGES[report.lastRunStatus] ?? "badge-neutral"}>
                    {report.lastRunStatus}
                  </span>
                )}
                {report.scheduled && (
                  <span
                    className={
                      report.scheduleEnabled ? "badge-success" : "badge-neutral"
                    }
                  >
                    {report.scheduleEnabled ? "Scheduled" : "Paused"}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleDelete(report.id);
              }}
              className="btn-subtle text-error hover:text-error"
            >
              Delete
            </button>
          </div>
        </Link>
      ))}
    </div>
  );
}
