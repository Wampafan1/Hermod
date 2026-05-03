import type { AwsS3WizardState, StorageSetupMethod } from "./storage-wizard-types";

interface AwsS3SetupWizardProps {
  value: AwsS3WizardState;
  setupMethod: StorageSetupMethod;
  onChange: (value: AwsS3WizardState) => void;
}

function update<K extends keyof AwsS3WizardState>(
  value: AwsS3WizardState,
  key: K,
  next: AwsS3WizardState[K],
  onChange: (value: AwsS3WizardState) => void
) {
  onChange({ ...value, [key]: next });
}

export function AwsS3SetupWizard({ value, setupMethod, onChange }: AwsS3SetupWizardProps) {
  const roleMode = value.accessMode === "AWS_ASSUME_ROLE";
  const accessKeyMode = value.accessMode === "AWS_ACCESS_KEY";
  const runtimeMode = value.accessMode === "AWS_RUNTIME_ROLE";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-norse text-sm mb-1">AWS S3 Target</h2>
        <p className="text-text-dim text-xs tracking-wide leading-6">
          {setupMethod === "PROVISIONED"
            ? "Hermod can create the bucket with the runtime AWS role attached to this deployment."
            : "Configure the dedicated backup bucket and the access Hermod should use for backup artifacts."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Storage Target Name</label>
          <input
            value={value.name}
            onChange={(event) => update(value, "name", event.target.value, onChange)}
            className="input-norse"
            placeholder="Production S3 Backups"
          />
        </div>
        <div>
          <label className="label-norse">Bucket Name</label>
          <input
            value={value.bucket}
            onChange={(event) => update(value, "bucket", event.target.value, onChange)}
            className="input-norse font-mono text-xs"
            placeholder="hermod-backups-acme-prod"
          />
        </div>
        <div>
          <label className="label-norse">Region</label>
          <input
            value={value.region}
            onChange={(event) => update(value, "region", event.target.value, onChange)}
            className="input-norse"
            placeholder="us-east-1"
          />
        </div>
        <div>
          <label className="label-norse">Default Prefix</label>
          <input
            value={value.prefix}
            onChange={(event) => update(value, "prefix", event.target.value, onChange)}
            className="input-norse font-mono text-xs"
            placeholder="postgres"
          />
          <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
            Used for storage tests, lifecycle rules, and default organization. AWS object access is bucket-wide so policies can choose their own artifact paths.
          </p>
        </div>
        <div>
          <label className="label-norse">Retention Days</label>
          <input
            type="number"
            min={1}
            max={3650}
            value={value.retentionDays}
            onChange={(event) => update(value, "retentionDays", Number(event.target.value), onChange)}
            className="input-norse"
          />
        </div>
        <div>
          <label className="label-norse">Encryption</label>
          <select
            value={value.encryption}
            onChange={(event) => update(value, "encryption", event.target.value as AwsS3WizardState["encryption"], onChange)}
            className="select-norse"
          >
            <option value="SSE_S3">SSE-S3</option>
            <option value="SSE_KMS">SSE-KMS</option>
          </select>
        </div>
      </div>

      {value.encryption === "SSE_KMS" && (
        <div>
          <label className="label-norse">KMS Key ARN</label>
          <input
            value={value.kmsKeyArn}
            onChange={(event) => update(value, "kmsKeyArn", event.target.value, onChange)}
            className="input-norse font-mono text-xs"
            placeholder="arn:aws:kms:us-east-1:123456789012:key/..."
          />
        </div>
      )}

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.versioningEnabled}
          onChange={(event) => update(value, "versioningEnabled", event.target.checked, onChange)}
          className="accent-gold"
        />
        <span className="text-text-dim text-xs tracking-wider">Enable bucket versioning</span>
      </label>

      <div>
        <label className="label-norse">Access Mode</label>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
          {[
            {
              value: "AWS_ASSUME_ROLE",
              label: "Assume Role",
              badge: "Recommended",
              copy: "Create a role in your AWS account that Hermod can assume with ExternalId.",
            },
            {
              value: "AWS_RUNTIME_ROLE",
              label: "Runtime Role",
              badge: "Self-hosted",
              copy: "Use the EC2, ECS, EKS, or container role already attached to Hermod.",
            },
            {
              value: "AWS_ACCESS_KEY",
              label: "Access Key",
              badge: "Fallback",
              copy: "Use long-lived keys only when role-based access is not available.",
            },
          ].map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => update(value, "accessMode", mode.value as AwsS3WizardState["accessMode"], onChange)}
              className={`bg-deep p-4 text-left transition-colors hover:bg-gold/[0.04] ${
                value.accessMode === mode.value ? "outline outline-1 outline-gold" : ""
              }`}
            >
              <span className="label-norse mb-1">{mode.badge}</span>
              <span className="block text-text text-xs tracking-wider uppercase">{mode.label}</span>
              <span className="block text-text-dim text-[0.7rem] leading-5 tracking-wide mt-2">{mode.copy}</span>
            </button>
          ))}
        </div>
      </div>

      {roleMode && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label-norse">Role ARN</label>
            <input
              value={value.roleArn}
              onChange={(event) => update(value, "roleArn", event.target.value, onChange)}
              className="input-norse font-mono text-xs"
              placeholder="arn:aws:iam::123456789012:role/HermodBackupRole"
            />
          </div>
          <div>
            <label className="label-norse">ExternalId</label>
            <input
              value={value.externalId}
              onChange={(event) => update(value, "externalId", event.target.value, onChange)}
              className="input-norse font-mono text-xs"
              placeholder="hrm_ext_..."
            />
          </div>
        </div>
      )}

      {accessKeyMode && (
        <div className="border border-gold/40 bg-void/50 p-4 space-y-4">
          <p className="text-text text-xs tracking-wide leading-6">
            Access keys are a fallback. Hermod encrypts them at rest, never returns them from API reads, and never uses them in generated commands.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label-norse">Access Key ID</label>
              <input
                value={value.accessKeyId}
                onChange={(event) => update(value, "accessKeyId", event.target.value, onChange)}
                className="input-norse font-mono text-xs"
              />
            </div>
            <div>
              <label className="label-norse">Secret Access Key</label>
              <input
                type="password"
                value={value.secretAccessKey}
                onChange={(event) => update(value, "secretAccessKey", event.target.value, onChange)}
                className="input-norse font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label className="label-norse">Session Token</label>
            <input
              type="password"
              value={value.sessionToken}
              onChange={(event) => update(value, "sessionToken", event.target.value, onChange)}
              className="input-norse font-mono text-xs"
              placeholder="Optional"
            />
          </div>
        </div>
      )}

      {runtimeMode && (
        <div className="border border-frost/30 bg-frost/10 p-4">
          <p className="text-frost text-xs tracking-wide leading-6">
            Runtime role access stores no credentials in Hermod. The worker and web process must run with an AWS role that can use this backup bucket.
          </p>
        </div>
      )}
    </div>
  );
}
