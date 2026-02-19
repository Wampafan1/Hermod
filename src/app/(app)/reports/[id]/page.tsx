"use client";

import { useParams } from "next/navigation";
import { ReportEditor } from "@/components/reports/report-editor";

export default function EditReportPage() {
  const params = useParams();
  const reportId = params.id as string;
  return <ReportEditor reportId={reportId} />;
}
