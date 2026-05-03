"use client";

import { useParams } from "next/navigation";
import { StorageTargetDetail } from "@/components/backups/storage-target-detail";

export default function BackupStorageTargetPage() {
  const params = useParams();
  return <StorageTargetDetail targetId={params.id as string} />;
}
