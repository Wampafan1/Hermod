"use client";

import { useParams } from "next/navigation";
import { MssqlBackupHistory } from "@/components/backups/mssql/mssql-backup-history";

export default function MssqlBackupHistoryPage() {
  const params = useParams();
  const id = params.id as string;
  return <MssqlBackupHistory policyId={id} />;
}
