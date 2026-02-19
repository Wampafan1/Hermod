"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";

interface Report {
  id: string;
  name: string;
  description?: string;
  connectionName: string;
  connectionType: string;
  lastRunStatus: string | null;
  scheduled: boolean;
  scheduleEnabled: boolean;
  updatedAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  SUCCESS: "bg-green-500/10 text-green-400",
  FAILED: "bg-red-500/10 text-red-400",
  RUNNING: "bg-yellow-500/10 text-yellow-400",
};

export default function ReportsPage() {
  const router = useRouter();
  const toast = useToast();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then(setReports)
      .catch(() => toast.error("Failed to load reports"))
      .finally(() => setLoading(false));
  }, [toast]);

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
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error("Network error");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-gray-400 mt-1">
            Create and manage your SQL reports.
          </p>
        </div>
        <Link
          href="/reports/new"
          className="px-4 py-2 bg-blue-600 rounded-lg text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          New Report
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 animate-pulse h-20"
            />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500">No reports yet.</p>
          <Link
            href="/reports/new"
            className="mt-3 inline-block text-blue-400 hover:text-blue-300 text-sm"
          >
            Create your first report
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-gray-700 transition-colors cursor-pointer"
              onClick={() => router.push(`/reports/${report.id}`)}
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-medium text-white">{report.name}</h3>
                  <div className="flex items-center gap-3 text-sm text-gray-400">
                    <span>{report.connectionName}</span>
                    {report.lastRunStatus && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[report.lastRunStatus] ?? "bg-gray-700 text-gray-300"}`}
                      >
                        {report.lastRunStatus}
                      </span>
                    )}
                    {report.scheduled && (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          report.scheduleEnabled
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {report.scheduleEnabled ? "Scheduled" : "Paused"}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(report.id);
                  }}
                  className="text-gray-500 hover:text-red-400 text-sm transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
