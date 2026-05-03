"use client";

import { useParams } from "next/navigation";
import { RestoreForm } from "@/components/backups/restore-form";

export default function PolicyRestorePage() {
  const params = useParams();
  return <RestoreForm initialPolicyId={params.id as string} />;
}
