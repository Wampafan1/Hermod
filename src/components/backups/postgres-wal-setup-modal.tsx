"use client";

import { useId, useRef } from "react";
import { useFocusTrap } from "@/lib/hooks/use-focus-trap";

interface PostgresWalSetupModalProps {
  open: boolean;
  onClose: () => void;
  host?: string | null;
  port?: number | string | null;
  ssl?: boolean | null;
  context?: "connection" | "policy";
}

function configLine(label: string, value: string) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/70 py-2 last:border-b-0">
      <span className="label-norse">{label}</span>
      <span className="font-mono text-[0.72rem] text-text tracking-wide text-right">{value}</span>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto border border-border bg-void/60 p-3 font-mono text-[0.72rem] leading-6 text-text">
      <code>{children}</code>
    </pre>
  );
}

export function PostgresWalSetupModal({
  open,
  onClose,
  host,
  port,
  ssl = true,
  context = "connection",
}: PostgresWalSetupModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  const hbaType = ssl ? "hostssl" : "host";
  const targetHost = host?.trim() || "your PostgreSQL server";
  const targetPort = port ? String(port) : "5432";
  const intro =
    context === "connection"
      ? "Hermod can use this server connection for database discovery and logical dumps. WAL/PITR coverage needs PostgreSQL replication access too."
      : "WAL/PITR coverage uses PostgreSQL physical replication. A normal connection test does not prove WAL archive access.";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-border-mid bg-deep animate-fade-up"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <p className="label-norse mb-2">Niflheim WAL/PITR</p>
            <h2 id={titleId} className="heading-norse text-sm">
              PostgreSQL Replication Setup
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close WAL setup guide"
            className="text-xl leading-none text-text-dim hover:text-text"
          >
            &times;
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="border border-frost/30 bg-frost/10 p-4">
            <p className="text-xs leading-6 tracking-wide text-text">
              {intro}
            </p>
            <p className="mt-3 text-xs leading-6 tracking-wide text-text-dim">
              Use a dedicated replication user such as <span className="font-mono text-text">hermod_wal</span>.
              Avoid database superusers or long-lived admin accounts for routine WAL archive jobs.
            </p>
          </div>

          <div className="grid gap-3 border border-border bg-void/30 p-4 sm:grid-cols-3">
            {configLine("Server", targetHost)}
            {configLine("Port", targetPort)}
            {configLine("pg_hba mode", hbaType)}
          </div>

          <section className="space-y-3">
            <h3 className="heading-norse text-xs">1. Create A Replication User And Slot</h3>
            <p className="text-xs leading-6 tracking-wide text-text-dim">
              Run this as a PostgreSQL admin on the source server. Change the password and slot name before using it.
            </p>
            <CodeBlock>
{`CREATE ROLE hermod_wal WITH LOGIN REPLICATION PASSWORD '<strong-password>';
SELECT pg_create_physical_replication_slot('<slot_name>');
SELECT pg_reload_conf();`}
            </CodeBlock>
          </section>

          <section className="space-y-3">
            <h3 className="heading-norse text-xs">2. Allow Replication In pg_hba.conf</h3>
            <p className="text-xs leading-6 tracking-wide text-text-dim">
              Add this before reject rules. Replace <span className="font-mono text-text">&lt;HERMOD_WORKER_IP&gt;</span> with
              the IP address of the machine or container running the Hermod worker. PostgreSQL WAL failures usually print that IP.
            </p>
            <CodeBlock>
{`${hbaType} replication hermod_wal <HERMOD_WORKER_IP>/32 scram-sha-256`}
            </CodeBlock>
          </section>

          <section className="space-y-3">
            <h3 className="heading-norse text-xs">3. Confirm WAL Settings</h3>
            <p className="text-xs leading-6 tracking-wide text-text-dim">
              These values live in postgresql.conf or your managed Postgres parameter group. Restart may be required for some changes.
            </p>
            <CodeBlock>
{`wal_level = replica
max_wal_senders = 5
max_replication_slots = 5`}
            </CodeBlock>
          </section>

          <section className="space-y-3">
            <h3 className="heading-norse text-xs">4. Reload And Test</h3>
            <CodeBlock>
{`SELECT pg_reload_conf();`}
            </CodeBlock>
            <p className="text-xs leading-6 tracking-wide text-text-dim">
              In Hermod, use the replication user credentials on the server-scoped Postgres connection, set the same
              replication slot on the backup policy, then run Archive WAL Now.
            </p>
          </section>
        </div>

        <div className="flex justify-end gap-3 border-t border-border bg-surface px-5 py-4">
          <button type="button" onClick={onClose} className="btn-primary text-xs">
            <span>I Understand</span>
          </button>
        </div>
      </div>
    </div>
  );
}
