"use client";

import { useState } from "react";

interface CloudFormationLaunchCardProps {
  templateJson: string;
  externalId?: string;
  launchUrl?: string | null;
  fileName?: string;
}

export function CloudFormationLaunchCard({
  templateJson,
  externalId,
  launchUrl,
  fileName = "hermod-backup-storage-template.json",
}: CloudFormationLaunchCardProps) {
  const [copied, setCopied] = useState(false);

  async function copyTemplate() {
    await navigator.clipboard.writeText(templateJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function downloadTemplate() {
    const blob = new Blob([templateJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="border border-border bg-deep p-5">
      <div className="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-border">
        <h2 className="heading-norse text-xs">CloudFormation</h2>
        <div className="flex items-center gap-2">
          {launchUrl && (
            <a
              href={launchUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-3 py-1.5 text-[0.6rem] tracking-[0.15em] uppercase"
            >
              Launch
            </a>
          )}
          <button type="button" onClick={downloadTemplate} className="btn-ghost px-3 py-1.5 text-[0.6rem] tracking-[0.15em] uppercase">
            Download
          </button>
          <button type="button" onClick={copyTemplate} className="btn-ghost px-3 py-1.5 text-[0.6rem] tracking-[0.15em] uppercase">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <p className="text-text-dim text-xs tracking-wide leading-6 mb-3">
        CloudFormation launch links require a public template URL. Hermod provides the JSON directly so an AWS admin can upload it in the AWS Console.
      </p>

      {externalId && (
        <div className="border border-frost/30 bg-frost/10 p-3 mb-3">
          <span className="label-norse mb-1">ExternalId</span>
          <code className="text-frost text-xs break-all">{externalId}</code>
        </div>
      )}

      <textarea
        readOnly
        value={templateJson}
        rows={14}
        className="input-norse font-mono text-[0.7rem] leading-5"
      />
    </div>
  );
}
