import Link from "next/link";

interface StorageTargetFormProps {
  onCreated?: () => void;
}

export function StorageTargetForm(_props: StorageTargetFormProps) {
  return (
    <div className="border border-border bg-deep p-5">
      <h2 className="heading-norse text-xs mb-4 pb-2 border-b border-border">
        Storage Target
      </h2>
      <div className="space-y-4">
        <p className="text-text-dim text-xs tracking-wide leading-6">
          Create S3 or GCS destinations with generated permissions, guided commands, runtime provisioning, and write/read/delete validation.
        </p>
        <Link
          href="/backups/storage/new"
          className="btn-ghost inline-block px-4 py-2 text-xs tracking-[0.15em] uppercase"
        >
          Open Setup Wizard
        </Link>
      </div>
    </div>
  );
}
