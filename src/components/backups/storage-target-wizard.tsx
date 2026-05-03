"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { AwsS3SetupWizard } from "./aws-s3-setup-wizard";
import { GcsSetupWizard } from "./gcs-setup-wizard";
import { CloudFormationLaunchCard } from "./cloudformation-launch-card";
import { GeneratedCommandsCard } from "./generated-commands-card";
import { StoragePermissionsReview } from "./storage-permissions-review";
import { StorageTestPanel, type StorageTestResult } from "./storage-test-panel";
import { StorageTargetSummaryCard } from "./storage-target-summary-card";
import type {
  AwsS3WizardState,
  GcsWizardState,
  ProvisioningGuidance,
  StorageProviderChoice,
  StorageSetupMethod,
} from "./storage-wizard-types";

interface StorageTargetWizardProps {
  targetId?: string;
}

interface StorageTargetResponse {
  id: string;
  name: string;
  provider: StorageProviderChoice;
  accessMode: AwsS3WizardState["accessMode"] | GcsWizardState["accessMode"];
  config: Record<string, unknown>;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: StorageTestResult | null;
}

interface RuntimeCheck {
  available: boolean;
  message: string;
  accountId?: string;
  arn?: string;
  projectId?: string;
}

const STEPS = [
  "Provider",
  "Method",
  "Settings",
  "Permissions",
  "Provision",
  "Test",
  "Save",
];

const DEFAULT_AWS: AwsS3WizardState = {
  name: "",
  bucket: "",
  region: "us-east-1",
  prefix: "postgres",
  retentionDays: 30,
  encryption: "SSE_S3",
  kmsKeyArn: "",
  versioningEnabled: true,
  accessMode: "AWS_ASSUME_ROLE",
  roleArn: "",
  externalId: "",
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
};

const DEFAULT_GCP: GcsWizardState = {
  name: "",
  bucket: "",
  projectId: "",
  location: "us-central1",
  prefix: "postgres",
  retentionDays: 30,
  uniformBucketLevelAccess: true,
  accessMode: "GCP_APPLICATION_DEFAULT",
  serviceAccountJson: "",
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function intValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function queryFromRecord(record: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(record).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}

export function StorageTargetWizard({ targetId }: StorageTargetWizardProps) {
  const isEdit = !!targetId;
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [provider, setProvider] = useState<StorageProviderChoice>("AWS_S3");
  const [setupMethod, setSetupMethod] = useState<StorageSetupMethod>("EXISTING");
  const [aws, setAws] = useState<AwsS3WizardState>(DEFAULT_AWS);
  const [gcp, setGcp] = useState<GcsWizardState>(DEFAULT_GCP);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [runtimeCheck, setRuntimeCheck] = useState<RuntimeCheck | null>(null);
  const [guidance, setGuidance] = useState<ProvisioningGuidance>({});
  const [testResult, setTestResult] = useState<StorageTestResult | null>(null);
  const [loadedTarget, setLoadedTarget] = useState<StorageTargetResponse | null>(null);

  useEffect(() => {
    if (!targetId) return;

    fetch(`/api/backups/storage-targets/${targetId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load storage target");
        return data as StorageTargetResponse;
      })
      .then((target) => {
        const config = target.config ?? {};
        setLoadedTarget(target);
        setProvider(target.provider);
        setTestResult(target.lastTestResult);

        if (target.provider === "AWS_S3") {
          setAws({
            ...DEFAULT_AWS,
            name: target.name,
            bucket: text(config.bucket),
            region: text(config.region, "us-east-1"),
            prefix: text(config.prefix, "postgres"),
            retentionDays: intValue(config.retentionDays, 30),
            encryption: config.encryption === "SSE_KMS" ? "SSE_KMS" : "SSE_S3",
            kmsKeyArn: text(config.kmsKeyArn),
            versioningEnabled: boolValue(config.versioningEnabled, true),
            accessMode: target.accessMode as AwsS3WizardState["accessMode"],
          });
        } else {
          setGcp({
            ...DEFAULT_GCP,
            name: target.name,
            bucket: text(config.bucket),
            projectId: text(config.projectId),
            location: text(config.location, "us-central1"),
            prefix: text(config.prefix, "postgres"),
            retentionDays: intValue(config.retentionDays, 30),
            uniformBucketLevelAccess: boolValue(config.uniformBucketLevelAccess, true),
            accessMode: target.accessMode as GcsWizardState["accessMode"],
          });
        }
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load storage target"))
      .finally(() => setLoading(false));
  }, [targetId, toast]);

  const activeName = provider === "AWS_S3" ? aws.name : gcp.name;
  const activeBucket = provider === "AWS_S3" ? aws.bucket : gcp.bucket;
  const activePrefix = provider === "AWS_S3" ? aws.prefix : gcp.prefix;
  const activeAccessMode = provider === "AWS_S3" ? aws.accessMode : gcp.accessMode;

  const activeSummary = useMemo(() => ({
    id: targetId,
    name: activeName || "New Storage Target",
    provider,
    accessMode: activeAccessMode,
    status: testResult?.ok ? "ACTIVE" : loadedTarget?.status ?? "ACTIVE",
    lastTestedAt: loadedTarget?.lastTestedAt ?? null,
    lastTestResult: testResult,
    config: provider === "AWS_S3"
      ? {
          bucket: aws.bucket,
          region: aws.region,
          prefix: aws.prefix,
          retentionDays: aws.retentionDays,
          encryption: aws.encryption,
          versioningEnabled: aws.versioningEnabled,
        }
      : {
          bucket: gcp.bucket,
          projectId: gcp.projectId,
          location: gcp.location,
          prefix: gcp.prefix,
          retentionDays: gcp.retentionDays,
          uniformBucketLevelAccess: gcp.uniformBucketLevelAccess,
        },
  }), [activeAccessMode, activeName, aws, gcp, loadedTarget, provider, targetId, testResult]);

  const canProceed = useMemo(() => {
    if (step === 0) return !!provider;
    if (step === 1) return !!setupMethod;
    if (step === 2) return !!activeName && !!activeBucket;
    return true;
  }, [activeBucket, activeName, provider, setupMethod, step]);

  const hasRequiredCredentials = useMemo(() => {
    if (provider === "AWS_S3") {
      if (aws.accessMode === "AWS_RUNTIME_ROLE") return true;
      if (aws.accessMode === "AWS_ACCESS_KEY") {
        return (!!aws.accessKeyId && !!aws.secretAccessKey) || isEdit;
      }
      return (!!aws.roleArn && !!aws.externalId) || isEdit;
    }
    if (gcp.accessMode === "GCP_APPLICATION_DEFAULT") return true;
    if (gcp.accessMode === "GCP_WORKLOAD_IDENTITY") return false;
    return !!gcp.serviceAccountJson || isEdit;
  }, [aws, gcp, isEdit, provider]);

  const canSaveActive = !!testResult?.ok && hasRequiredCredentials;
  const canSaveError = !!testResult && !testResult.ok && hasRequiredCredentials;

  function awsProvisioningInput(createTarget = false) {
    return {
      name: aws.name || undefined,
      bucket: aws.bucket,
      region: aws.region,
      prefix: aws.prefix,
      retentionDays: aws.retentionDays,
      encryption: aws.encryption,
      kmsKeyArn: aws.kmsKeyArn || null,
      versioningEnabled: aws.versioningEnabled,
      accessMode: aws.accessMode === "AWS_RUNTIME_ROLE" ? "AWS_RUNTIME_ROLE" : "AWS_ASSUME_ROLE",
      externalId: aws.externalId || undefined,
      createTarget,
    };
  }

  function gcpProvisioningInput(createTarget = false) {
    return {
      name: gcp.name || undefined,
      bucket: gcp.bucket,
      projectId: gcp.projectId || undefined,
      location: gcp.location,
      prefix: gcp.prefix,
      retentionDays: gcp.retentionDays,
      uniformBucketLevelAccess: gcp.uniformBucketLevelAccess,
      accessMode: "GCP_APPLICATION_DEFAULT",
      createTarget,
    };
  }

  const buildPayload = useCallback((status: "ACTIVE" | "ERROR" | "DISABLED") => {
    if (provider === "AWS_S3") {
      let credentials: Record<string, string | undefined> | null | undefined;
      if (aws.accessMode === "AWS_ACCESS_KEY") {
        credentials = aws.accessKeyId || aws.secretAccessKey || aws.sessionToken
          ? {
              accessKeyId: aws.accessKeyId || undefined,
              secretAccessKey: aws.secretAccessKey || undefined,
              sessionToken: aws.sessionToken || undefined,
            }
          : undefined;
      } else if (aws.accessMode === "AWS_ASSUME_ROLE") {
        credentials = aws.roleArn || aws.externalId
          ? {
              roleArn: aws.roleArn || undefined,
              externalId: aws.externalId || undefined,
            }
          : undefined;
      } else {
        credentials = null;
      }

      const payload: Record<string, unknown> = {
        name: aws.name,
        provider,
        accessMode: aws.accessMode,
        config: {
          bucket: aws.bucket,
          region: aws.region,
          prefix: aws.prefix,
          retentionDays: aws.retentionDays,
          encryption: aws.encryption,
          kmsKeyArn: aws.kmsKeyArn || null,
          versioningEnabled: aws.versioningEnabled,
        },
        status,
      };
      if (credentials !== undefined) payload.credentials = credentials;
      return payload;
    }

    const gcpCredentials = gcp.accessMode === "GCP_SERVICE_ACCOUNT_JSON"
      ? gcp.serviceAccountJson
        ? { serviceAccountKey: gcp.serviceAccountJson }
        : undefined
      : null;

    const payload: Record<string, unknown> = {
      name: gcp.name,
      provider,
      accessMode: gcp.accessMode,
      config: {
        bucket: gcp.bucket,
        projectId: gcp.projectId || undefined,
        location: gcp.location,
        prefix: gcp.prefix,
        retentionDays: gcp.retentionDays,
        uniformBucketLevelAccess: gcp.uniformBucketLevelAccess,
      },
      status,
    };
    if (gcpCredentials !== undefined) payload.credentials = gcpCredentials;
    return payload;
  }, [aws, gcp, provider]);

  async function generateGuidance() {
    setGenerating(true);
    try {
      if (provider === "AWS_S3") {
        const query = queryFromRecord(awsProvisioningInput(false));
        const res = await fetch(`/api/backups/storage-targets/provisioning/aws/template?${query}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to generate AWS setup");
        setGuidance({
          commands: data.commands ?? [],
          templateJson: data.templateJson,
          launchUrl: data.launchUrl,
          externalId: data.externalId,
        });
        if (!aws.externalId && data.externalId) {
          setAws((current) => ({ ...current, externalId: data.externalId }));
        }
      } else {
        const query = queryFromRecord(gcpProvisioningInput(false));
        const res = await fetch(`/api/backups/storage-targets/provisioning/gcp/commands?${query}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to generate GCP setup");
        setGuidance({ commands: data.commands ?? [] });
      }
      toast.success("Setup guidance generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate setup guidance");
    } finally {
      setGenerating(false);
    }
  }

  async function checkRuntimeCredentials() {
    try {
      const endpoint = provider === "AWS_S3"
        ? "/api/backups/storage-targets/provisioning/aws/runtime-check"
        : "/api/backups/storage-targets/provisioning/gcp/runtime-check";
      const body = provider === "AWS_S3"
        ? { region: aws.region }
        : { projectId: gcp.projectId || undefined };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setRuntimeCheck(data);
      if (data.available) toast.success("Runtime credentials are available");
      else toast.error(data.message || "Runtime credentials are unavailable");
    } catch {
      toast.error("Runtime credential check failed");
    }
  }

  async function provisionBucket() {
    setProvisioning(true);
    try {
      const endpoint = provider === "AWS_S3"
        ? "/api/backups/storage-targets/provisioning/aws/create"
        : "/api/backups/storage-targets/provisioning/gcp/create";
      const payload = provider === "AWS_S3"
        ? awsProvisioningInput(false)
        : gcpProvisioningInput(false);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Provisioning failed");
      toast.success("Storage bucket provisioned");
      if (provider === "AWS_S3") {
        setAws((current) => ({ ...current, accessMode: "AWS_RUNTIME_ROLE" }));
      } else {
        setGcp((current) => ({ ...current, accessMode: "GCP_APPLICATION_DEFAULT" }));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Provisioning failed");
    } finally {
      setProvisioning(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const usesSavedSecret = isEdit &&
        ((provider === "AWS_S3" && (
          (aws.accessMode === "AWS_ACCESS_KEY" && !aws.accessKeyId && !aws.secretAccessKey) ||
          (aws.accessMode === "AWS_ASSUME_ROLE" && !aws.roleArn && !aws.externalId)
        )) ||
        (provider === "GCP_GCS" && gcp.accessMode === "GCP_SERVICE_ACCOUNT_JSON" && !gcp.serviceAccountJson));

      const res = usesSavedSecret
        ? await fetch(`/api/backups/storage-targets/${targetId}/test`, { method: "POST" })
        : await fetch("/api/backups/storage-targets/test-unsaved", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildPayload("ACTIVE")),
          });
      const data = await res.json();
      setTestResult(data);
      if (data.ok) toast.success("Storage target test passed");
      else toast.error(data.error || "Storage target test failed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storage target test failed");
    } finally {
      setTesting(false);
    }
  }

  async function save(status: "ACTIVE" | "ERROR") {
    if (!hasRequiredCredentials) {
      toast.error("Required credential fields are missing");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/backups/storage-targets/${targetId}` : "/api/backups/storage-targets", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(status)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save storage target");
      toast.success(isEdit ? "Storage target updated" : "Storage target created");
      router.push(`/backups/storage/${data.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save storage target");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-text-dim text-sm tracking-widest uppercase">Loading storage target...</span>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/backups/storage" className="text-text-dim text-xs tracking-wider hover:text-gold">
            &larr; Storage Targets
          </Link>
          <h1 className="heading-norse text-xl mt-3">{isEdit ? "Edit Storage Target" : "Storage Target Setup"}</h1>
          <div className="realm-line mt-2 w-44" />
        </div>
        <Link href="/backups" className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase">
          Niflheim
        </Link>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((label, index) => (
          <div key={label} className="flex items-center gap-1 min-w-fit">
            <button
              type="button"
              onClick={() => setStep(index)}
              className={`w-7 h-7 flex items-center justify-center text-[0.65rem] border transition-colors ${
                index < step
                  ? "bg-gold text-void border-gold"
                  : index === step
                    ? "bg-gold-dim border-gold text-gold-bright"
                    : "bg-deep border-border text-text-dim"
              }`}
              aria-label={`Go to ${label}`}
            >
              {index < step ? "✓" : index + 1}
            </button>
            <span className={`text-[0.58rem] tracking-widest uppercase ${index <= step ? "text-text" : "text-text-dim"}`}>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <div className={`h-px w-8 ${index < step ? "bg-gold" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
        <div className="space-y-6">
          {step === 0 && (
            <div className="border border-border bg-deep p-5">
              <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Choose Provider</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
                {[
                  {
                    value: "AWS_S3",
                    title: "AWS S3",
                    copy: "Use an S3 bucket with role-based access, runtime role access, or encrypted access-key fallback.",
                  },
                  {
                    value: "GCP_GCS",
                    title: "Google Cloud Storage",
                    copy: "Use a GCS bucket with Application Default Credentials or encrypted service account JSON fallback.",
                  },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setProvider(item.value as StorageProviderChoice)}
                    className={`bg-deep p-5 text-left transition-colors hover:bg-gold/[0.04] ${
                      provider === item.value ? "outline outline-1 outline-gold" : ""
                    }`}
                  >
                    <span className="text-gold text-xl block mb-3">{item.value === "AWS_S3" ? "ᚨ" : "ᚷ"}</span>
                    <span className="heading-norse text-sm block">{item.title}</span>
                    <span className="text-text-dim text-xs tracking-wide leading-6 block mt-2">{item.copy}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="border border-border bg-deep p-5">
              <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Choose Setup Method</h2>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
                {[
                  {
                    value: "EXISTING",
                    title: "I Already Have A Bucket",
                    badge: "Fastest",
                    copy: "Enter an existing bucket, choose access mode, then run Hermod's write/read/delete test.",
                  },
                  {
                    value: "GUIDED",
                    title: "Guide Me Through It",
                    badge: "Recommended",
                    copy: "Generate CloudFormation or gcloud setup with dedicated-bucket permissions and validation.",
                  },
                  {
                    value: "PROVISIONED",
                    title: "Let Hermod Create It",
                    badge: "Runtime Role",
                    copy: "Use runtime AWS or GCP credentials already attached to the deployment. Hermod does not store admin credentials.",
                  },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setSetupMethod(item.value as StorageSetupMethod)}
                    className={`bg-deep p-5 text-left transition-colors hover:bg-gold/[0.04] ${
                      setupMethod === item.value ? "outline outline-1 outline-gold" : ""
                    }`}
                  >
                    <span className="label-norse mb-2">{item.badge}</span>
                    <span className="heading-norse text-sm block">{item.title}</span>
                    <span className="text-text-dim text-xs tracking-wide leading-6 block mt-2">{item.copy}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="border border-border bg-deep p-5">
              {provider === "AWS_S3" ? (
                <AwsS3SetupWizard value={aws} setupMethod={setupMethod} onChange={(value) => {
                  setAws(value);
                  setTestResult(null);
                }} />
              ) : (
                <GcsSetupWizard value={gcp} setupMethod={setupMethod} onChange={(value) => {
                  setGcp(value);
                  setTestResult(null);
                }} />
              )}
            </div>
          )}

          {step === 3 && (
            <StoragePermissionsReview
              provider={provider}
              bucket={activeBucket}
              prefix={activePrefix}
              accessMode={activeAccessMode}
              kmsKeyArn={provider === "AWS_S3" && aws.encryption === "SSE_KMS" ? aws.kmsKeyArn : null}
            />
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div className="border border-border bg-deep p-5">
                <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">Guided Provisioning</h2>
                {setupMethod === "EXISTING" && (
                  <p className="text-text-dim text-xs tracking-wide leading-6">
                    This path uses your existing bucket. Review permissions, enter the access details, then run the storage test.
                  </p>
                )}

                {setupMethod === "GUIDED" && (
                  <div className="space-y-4">
                    <p className="text-text-dim text-xs tracking-wide leading-6">
                      Generate setup artifacts an administrator can run outside Hermod. Commands never include secret access keys or private keys.
                    </p>
                    <button
                      type="button"
                      onClick={generateGuidance}
                      disabled={generating || !activeBucket}
                      className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase"
                    >
                      {generating ? "Generating..." : "Generate Setup"}
                    </button>
                  </div>
                )}

                {setupMethod === "PROVISIONED" && (
                  <div className="space-y-4">
                    <p className="text-text-dim text-xs tracking-wide leading-6">
                      Hermod will check runtime cloud credentials, create the bucket, configure encryption and retention, then leave those runtime credentials unstored.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={checkRuntimeCredentials}
                        className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase"
                      >
                        Check Runtime
                      </button>
                      <button
                        type="button"
                        onClick={provisionBucket}
                        disabled={provisioning || !activeBucket}
                        className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase"
                      >
                        {provisioning ? "Creating..." : "Create Bucket"}
                      </button>
                    </div>
                    {runtimeCheck && (
                      <div className={`border p-3 text-xs tracking-wide leading-6 ${
                        runtimeCheck.available
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                          : "border-ember/30 bg-ember/10 text-ember"
                      }`}>
                        <p>{runtimeCheck.message}</p>
                        {runtimeCheck.accountId && <p>Account: {runtimeCheck.accountId}</p>}
                        {runtimeCheck.arn && <p className="break-all">ARN: {runtimeCheck.arn}</p>}
                        {runtimeCheck.projectId && <p>Project: {runtimeCheck.projectId}</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {guidance.templateJson && (
                <CloudFormationLaunchCard
                  templateJson={guidance.templateJson}
                  launchUrl={guidance.launchUrl}
                  externalId={guidance.externalId}
                />
              )}
              {guidance.commands && (
                <GeneratedCommandsCard
                  title={provider === "AWS_S3" ? "AWS CLI Commands" : "gcloud Commands"}
                  commands={guidance.commands}
                  note={provider === "AWS_S3"
                    ? "These commands create bucket settings. Use CloudFormation for the role and ExternalId path when possible."
                    : "These commands set up the bucket, lifecycle rule, and a fallback service account without printing private keys."}
                />
              )}
            </div>
          )}

          {step === 5 && (
            <StorageTestPanel
              result={testResult}
              testing={testing}
              onTest={runTest}
              title={isEdit ? "Test Storage Target" : "Test Before Saving"}
            />
          )}

          {step === 6 && (
            <div className="border border-border bg-deep p-5 space-y-5">
              <h2 className="heading-norse text-xs pb-2 border-b border-border">Save Target</h2>
              <p className="text-text-dim text-xs tracking-wide leading-6">
                Hermod will save bucket configuration and only the selected access credentials. Saved credentials are encrypted and are never returned by storage target reads.
              </p>
              {!testResult && (
                <div className="border border-gold/40 bg-void/50 p-3 text-text text-xs tracking-wide leading-6">
                  Run the storage test before saving an active target.
                </div>
              )}
              {testResult && !testResult.ok && (
                <div className="border border-ember/30 bg-ember/10 p-3 text-ember text-xs tracking-wide leading-6">
                  The test failed. You can save the target in ERROR status, but backup policies should use it only after the test passes.
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/backups/storage")}
                  className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase"
                >
                  Cancel
                </button>
                {canSaveError && (
                  <button
                    type="button"
                    onClick={() => save("ERROR")}
                    disabled={saving}
                    className="btn-ghost px-6 py-2 text-xs tracking-[0.15em] uppercase text-ember border-ember/40"
                  >
                    {saving ? "Saving..." : "Save As Error"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => save("ACTIVE")}
                  disabled={!canSaveActive || saving}
                  className="btn-primary px-6 py-2 text-xs tracking-[0.15em] uppercase"
                >
                  {saving ? "Saving..." : isEdit ? "Update Target" : "Save Active Target"}
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
              className="btn-ghost px-4 py-2 text-xs tracking-[0.15em] uppercase"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep((current) => Math.min(STEPS.length - 1, current + 1))}
              disabled={!canProceed || step === STEPS.length - 1}
              className="btn-primary px-4 py-2 text-xs tracking-[0.15em] uppercase"
            >
              Continue
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <StorageTargetSummaryCard target={activeSummary} />
          <div className="border border-border bg-deep p-5">
            <h2 className="heading-norse text-xs mb-3 pb-2 border-b border-border">Safety Notes</h2>
            <ul className="space-y-2 text-text-dim text-xs tracking-wide leading-6">
              <li>Hermod never asks for AWS root credentials.</li>
              <li>Provisioning credentials are runtime-only and are not stored.</li>
              <li>Access keys and service account JSON are encrypted when saved.</li>
              <li>Saved credentials are never returned to the frontend.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
