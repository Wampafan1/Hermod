"use client";

import { useState, useCallback } from "react";

interface Credential {
  label: string;
  value: string;
}

interface CredentialCardProps {
  credentials: Credential[];
}

export function CredentialCard({ credentials }: CredentialCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
  }, []);

  const copyAll = useCallback(async () => {
    const text = credentials.map((c) => `${c.label}: ${c.value}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedField("__all__");
    setTimeout(() => setCopiedField(null), 2000);
  }, [credentials]);

  return (
    <div className="bg-deep border border-border-mid p-5 space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="label-norse text-gold-bright">SFTP Credentials</h3>
        <button
          onClick={copyAll}
          className="btn-ghost text-[0.625rem] px-2 py-1"
        >
          <span>{copiedField === "__all__" ? "Copied" : "Copy All"}</span>
        </button>
      </div>

      {credentials.map((cred) => (
        <div key={cred.label} className="flex items-center gap-3">
          <span className="text-text-dim text-[0.625rem] tracking-widest uppercase w-20 shrink-0">
            {cred.label}
          </span>
          <code className="flex-1 text-text text-xs font-inconsolata bg-void px-3 py-1.5 border border-border select-all">
            {cred.value}
          </code>
          <button
            onClick={() => copyToClipboard(cred.value, cred.label)}
            className="btn-subtle text-[0.625rem] shrink-0"
          >
            {copiedField === cred.label ? "Copied" : "Copy"}
          </button>
        </div>
      ))}
    </div>
  );
}
