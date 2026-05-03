"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/toast";
import { StorageTargetSummaryCard } from "./storage-target-summary-card";
import { StorageTestPanel, type StorageTestResult } from "./storage-test-panel";

interface StorageTargetDetailProps {
  targetId: string;
}

interface StorageTargetDetailItem {
  id: string;
  name: string;
  provider: string;
  accessMode: string;
  config: Record<string, unknown>;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: StorageTestResult | null;
}

export function StorageTargetDetail({ targetId }: StorageTargetDetailProps) {
  const toast = useToast();
  const [target, setTarget] = useState<StorageTargetDetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<StorageTestResult | null>(null);

  const loadTarget = useCallback(async () => {
    try {
      const res = await fetch(`/api/backups/storage-targets/${targetId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load storage target");
      setTarget(data);
      setTestResult(data.lastTestResult ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load storage target");
    } finally {
      setLoading(false);
    }
  }, [targetId, toast]);

  useEffect(() => {
    loadTarget();
  }, [loadTarget]);

  async function runTest() {
    setTesting(true);
    try {
      const res = await fetch(`/api/backups/storage-targets/${targetId}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult(data);
      if (!res.ok) throw new Error(data.error || "Storage test failed");
      if (data.ok) toast.success("Storage test passed");
      else toast.error(data.error || "Storage test failed");
      loadTarget();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storage test failed");
      loadTarget();
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading storage target...</span>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="border border-border bg-deep p-12 text-center">
        <p className="text-text-dim text-sm tracking-wide">Storage target not found.</p>
        <Link href="/backups/storage" className="btn-ghost mt-4 inline-block">Back To Storage</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/backups/storage" className="text-text-dim text-xs tracking-wider hover:text-gold">
            &larr; Storage Targets
          </Link>
          <h1 className="heading-norse text-xl mt-3">Storage Target</h1>
          <div className="realm-line mt-2 w-40" />
        </div>
        <Link href={`/backups/storage/${targetId}/edit`} className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase">
          Edit
        </Link>
      </div>

      <StorageTargetSummaryCard target={{ ...target, lastTestResult: testResult }} />
      <StorageTestPanel result={testResult} testing={testing} onTest={runTest} />
    </div>
  );
}
