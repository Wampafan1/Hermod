"use client";

import { useParams } from "next/navigation";
import { StorageTargetWizard } from "@/components/backups/storage-target-wizard";

export default function EditBackupStorageTargetPage() {
  const params = useParams();
  return <StorageTargetWizard targetId={params.id as string} />;
}
