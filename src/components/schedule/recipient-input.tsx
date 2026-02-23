"use client";

import { useState, KeyboardEvent } from "react";

interface Recipient {
  email: string;
  name?: string;
}

interface RecipientInputProps {
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  previousEmails?: string[];
}

export function RecipientInput({
  recipients,
  onChange,
  previousEmails = [],
}: RecipientInputProps) {
  const [input, setInput] = useState("");
  const [showPrevious, setShowPrevious] = useState(false);

  function addEmail(email: string) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    if (recipients.some((r) => r.email === trimmed)) return;
    onChange([...recipients, { email: trimmed }]);
    setInput("");
  }

  function removeEmail(email: string) {
    onChange(recipients.filter((r) => r.email !== email));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(input);
    }
    if (e.key === "Backspace" && !input && recipients.length > 0) {
      removeEmail(recipients[recipients.length - 1].email);
    }
  }

  const unusedPrevious = previousEmails.filter(
    (email) => !recipients.some((r) => r.email === email)
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 p-2 bg-surface border border-border min-h-[42px]">
        {recipients.map((r) => (
          <span
            key={r.email}
            className="inline-flex items-center gap-1 px-2 py-1 bg-gold-dim/50 border border-gold-dim text-gold-bright text-xs tracking-wide"
          >
            {r.email}
            <button
              onClick={() => removeEmail(r.email)}
              className="text-gold hover:text-gold-bright ml-0.5"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => input && addEmail(input)}
          placeholder={recipients.length === 0 ? "Enter email addresses..." : ""}
          className="flex-1 min-w-[150px] bg-transparent text-text text-xs outline-none placeholder:text-text-dim tracking-wide"
        />
      </div>

      {unusedPrevious.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPrevious(!showPrevious)}
            className="btn-subtle text-[0.625rem]"
          >
            Add from previous ({unusedPrevious.length})
          </button>
          {showPrevious && (
            <div className="absolute top-6 left-0 z-10 bg-deep border border-border-mid p-2 space-y-0.5">
              {unusedPrevious.map((email) => (
                <button
                  key={email}
                  onClick={() => {
                    addEmail(email);
                    setShowPrevious(false);
                  }}
                  className="block w-full text-left px-2 py-1 text-xs text-text-dim hover:bg-gold/[0.05] hover:text-text tracking-wide"
                >
                  {email}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
