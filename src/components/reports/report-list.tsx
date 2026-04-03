"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function executeDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget;
    setDeleteTarget(null);
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
        <span className="text-4xl font-cinzel block mb-3 animate-rune-float" style={{ color: "rgba(212,175,55,0.3)" }}>ᚠ</span>
        <p className="text-text-dim text-sm tracking-wide">No reports have been forged.</p>
        <p className="text-text-muted text-xs tracking-wide mt-1">Create your first report to query the realms.</p>
        <a href="/reports/new" className="btn-ghost mt-4 inline-block">
          New Report
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
          className="block bg-deep border border-border p-5 hover:bg-gold/[0.02] cursor-pointer no-underline hoverable-card"
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
                setDeleteTarget(report.id);
              }}
              className="btn-subtle text-error hover:text-error"
            >
              Delete
            </button>
          </div>
        </Link>
      ))}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Report"
        message="This report and its schedule will be permanently removed. This cannot be undone."
        onConfirm={executeDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
