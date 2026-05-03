"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { BackupHistory } from "@/components/backups/backup-history";

export default function BackupHistoryPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <div>
      <Link
        href="/backups"
        className="text-text-dim text-xs tracking-wider hover:text-gold mb-4 inline-block"
      >
        &larr; Back to Backups
      </Link>
      <BackupHistory policyId={id} />
    </div>
  );
}
