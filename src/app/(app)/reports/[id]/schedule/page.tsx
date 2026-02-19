"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { ScheduleForm } from "@/components/schedule/schedule-form";
import { useToast } from "@/components/toast";

export default function ScheduleBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const toast = useToast();
  const reportId = params.id as string;

  const [reportName, setReportName] = useState("");
  const [existingSchedule, setExistingSchedule] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/reports/${reportId}`).then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      }),
      fetch("/api/schedules").then((r) => r.json()),
    ])
      .then(([report, schedules]) => {
        setReportName(report.name);
        const schedule = schedules.find(
          (s: any) => s.report.id === reportId
        );
        if (schedule) {
          setExistingSchedule(schedule);
        }
      })
      .catch(() => {
        toast.error("Report not found");
        router.push("/reports");
      })
      .finally(() => setLoading(false));
  }, [reportId, router, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <ScheduleForm
      reportId={reportId}
      reportName={reportName}
      existingSchedule={existingSchedule ?? undefined}
    />
  );
}
