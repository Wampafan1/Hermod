"use client";

import { useParams } from "next/navigation";
import { RestoreStatusCard } from "@/components/backups/restore-status-card";

export default function RestoreStatusPage() {
  const params = useParams();
  return <RestoreStatusCard restoreId={params.id as string} />;
}
