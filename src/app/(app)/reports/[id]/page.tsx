import { ReportEditor } from "@/components/reports/report-editor";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReportEditor reportId={id} />;
}
