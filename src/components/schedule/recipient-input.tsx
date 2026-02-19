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
      <div className="flex flex-wrap gap-2 p-2 bg-gray-800 border border-gray-700 rounded-lg min-h-[42px]">
        {recipients.map((r) => (
          <span
            key={r.email}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/20 text-blue-300 rounded text-sm"
          >
            {r.email}
            <button
              onClick={() => removeEmail(r.email)}
              className="text-blue-400 hover:text-white ml-0.5"
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
          className="flex-1 min-w-[150px] bg-transparent text-white text-sm outline-none placeholder:text-gray-500"
        />
      </div>

      {unusedPrevious.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowPrevious(!showPrevious)}
            className="text-xs text-gray-400 hover:text-gray-300"
          >
            Add from previous ({unusedPrevious.length})
          </button>
          {showPrevious && (
            <div className="absolute top-6 left-0 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-lg p-2 space-y-1">
              {unusedPrevious.map((email) => (
                <button
                  key={email}
                  onClick={() => {
                    addEmail(email);
                    setShowPrevious(false);
                  }}
                  className="block w-full text-left px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 rounded"
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
