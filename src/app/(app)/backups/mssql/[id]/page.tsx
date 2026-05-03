"use client";

import { useParams } from "next/navigation";
import { MssqlBackupPolicyForm } from "@/components/backups/mssql/mssql-backup-policy-form";

export default function MssqlBackupPolicyPage() {
  const params = useParams();
  const id = params.id as string;
  return <MssqlBackupPolicyForm policyId={id} />;
}
