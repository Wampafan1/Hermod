import type { GcsWizardState, StorageSetupMethod } from "./storage-wizard-types";

interface GcsSetupWizardProps {
  value: GcsWizardState;
  setupMethod: StorageSetupMethod;
  onChange: (value: GcsWizardState) => void;
}

function update<K extends keyof GcsWizardState>(
  value: GcsWizardState,
  key: K,
  next: GcsWizardState[K],
  onChange: (value: GcsWizardState) => void
) {
  onChange({ ...value, [key]: next });
}

export function GcsSetupWizard({ value, setupMethod, onChange }: GcsSetupWizardProps) {
  const serviceAccountMode = value.accessMode === "GCP_SERVICE_ACCOUNT_JSON";
  const applicationDefaultMode = value.accessMode === "GCP_APPLICATION_DEFAULT";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="heading-norse text-sm mb-1">Google Cloud Storage Target</h2>
        <p className="text-text-dim text-xs tracking-wide leading-6">
          {setupMethod === "PROVISIONED"
            ? "Hermod can create the bucket with Application Default Credentials when this deployment already runs in GCP."
            : "Configure a GCS bucket and the credentials Hermod should use to store database backup artifacts."}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label-norse">Storage Target Name</label>
          <input
            value={value.name}
            onChange={(event) => update(value, "name", event.target.value, onChange)}
            className="input-norse"
            placeholder="Production GCS Backups"
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
          <label className="label-norse">Project ID</label>
          <input
            value={value.projectId}
            onChange={(event) => update(value, "projectId", event.target.value, onChange)}
            className="input-norse"
            placeholder="acme-prod"
          />
        </div>
        <div>
          <label className="label-norse">Location</label>
          <input
            value={value.location}
            onChange={(event) => update(value, "location", event.target.value, onChange)}
            className="input-norse"
            placeholder="us-central1"
          />
        </div>
        <div>
          <label className="label-norse">Folder / Prefix</label>
          <input
            value={value.prefix}
            onChange={(event) => update(value, "prefix", event.target.value, onChange)}
            className="input-norse font-mono text-xs"
            placeholder="AcmeBackups"
          />
          <p className="text-text-dim text-[0.68rem] tracking-wide leading-5 mt-2">
            Choose the top-level folder where Hermod should place backups. Hermod organizes under it by engine, server, database, backup type, and date.
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
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.uniformBucketLevelAccess}
          onChange={(event) => update(value, "uniformBucketLevelAccess", event.target.checked, onChange)}
          className="accent-gold"
        />
        <span className="text-text-dim text-xs tracking-wider">Enable uniform bucket-level access</span>
      </label>

      <div>
        <label className="label-norse">Access Mode</label>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border">
          {[
            {
              value: "GCP_APPLICATION_DEFAULT",
              label: "Application Default",
              badge: "Self-hosted",
              copy: "Use the service account already attached to this Hermod deployment.",
              disabled: false,
            },
            {
              value: "GCP_WORKLOAD_IDENTITY",
              label: "Workload Identity",
              badge: "Coming Soon",
              copy: "Recommended for hosted Hermod when federation is configured.",
              disabled: true,
            },
            {
              value: "GCP_SERVICE_ACCOUNT_JSON",
              label: "Service Account JSON",
              badge: "Fallback",
              copy: "Upload a service account key only when role-based/default credentials are unavailable.",
              disabled: false,
            },
          ].map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => {
                if (!mode.disabled) update(value, "accessMode", mode.value as GcsWizardState["accessMode"], onChange);
              }}
              disabled={mode.disabled}
              className={`bg-deep p-4 text-left transition-colors hover:bg-gold/[0.04] disabled:opacity-50 ${
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

      {serviceAccountMode && (
        <div className="border border-gold/40 bg-void/50 p-4 space-y-3">
          <p className="text-text text-xs tracking-wide leading-6">
            Upload service account JSON through Hermod. Do not paste private keys into shell history or generated command snippets.
          </p>
          <div>
            <label className="label-norse">Service Account JSON</label>
            <textarea
              value={value.serviceAccountJson}
              onChange={(event) => update(value, "serviceAccountJson", event.target.value, onChange)}
              rows={8}
              className="input-norse font-mono text-xs leading-5"
              placeholder='{"type":"service_account", ...}'
            />
          </div>
        </div>
      )}

      {applicationDefaultMode && (
        <div className="border border-frost/30 bg-frost/10 p-4">
          <p className="text-frost text-xs tracking-wide leading-6">
            Application Default Credentials store no key material in Hermod. The web and worker runtimes need a service account that can use this bucket.
          </p>
        </div>
      )}
    </div>
  );
}
