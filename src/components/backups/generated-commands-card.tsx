"use client";

import { useState } from "react";

interface GeneratedCommandsCardProps {
  title?: string;
  commands: string[];
  note?: string;
}

export function GeneratedCommandsCard({ title = "Generated Commands", commands, note }: GeneratedCommandsCardProps) {
  const [copied, setCopied] = useState(false);
  const commandText = commands.join("\n");

  async function copyCommands() {
    await navigator.clipboard.writeText(commandText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="border border-border bg-deep p-5">
      <div className="flex items-center justify-between gap-4 mb-4 pb-2 border-b border-border">
        <h2 className="heading-norse text-xs">{title}</h2>
        <button
          type="button"
          onClick={copyCommands}
          disabled={commands.length === 0}
          className="btn-ghost px-3 py-1.5 text-[0.6rem] tracking-[0.15em] uppercase"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note && <p className="text-text-dim text-xs tracking-wide leading-6 mb-3">{note}</p>}
      <pre className="max-h-80 overflow-auto border border-border bg-void/60 p-4 text-[0.72rem] leading-5 text-text-dim whitespace-pre-wrap">
        {commands.length > 0 ? commandText : "Generate commands after entering bucket settings."}
      </pre>
    </div>
  );
}
