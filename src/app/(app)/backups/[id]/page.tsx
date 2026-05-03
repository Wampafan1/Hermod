"use client";

import { useParams } from "next/navigation";
import { BackupPolicyForm } from "@/components/backups/backup-policy-form";
import { PreflightPanel } from "@/components/backups/preflight-panel";

export default function BackupPolicyDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <div className="space-y-6">
      <BackupPolicyForm policyId={id} />
      <div className="max-w-5xl mx-auto">
        <PreflightPanel policyId={id} />
      </div>
    </div>
  );
}
