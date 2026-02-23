"use client";

import { useState, useEffect } from "react";

interface Connection {
  id: string;
  name: string;
  type: string;
}

interface EmailConnection {
  id: string;
  name: string;
}

interface ReportConfigProps {
  name: string;
  description: string;
  connectionId: string;
  connections: Connection[];
  onNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
  onConnectionChange: (id: string) => void;
  onSave: () => void;
  onSaveAndSchedule: () => void;
  onTestSend: (recipients: string[], emailConnectionId: string) => Promise<void>;
  saving: boolean;
  hasChanges: boolean;
  isNew: boolean;
}

export function ReportConfig({
  name,
  description,
  connectionId,
  connections,
  onNameChange,
  onDescriptionChange,
  onConnectionChange,
  onSave,
  onSaveAndSchedule,
  onTestSend,
  saving,
  hasChanges,
  isNew,
}: ReportConfigProps) {
  const [testEmail, setTestEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [emailConnections, setEmailConnections] = useState<EmailConnection[]>([]);
  const [testEmailConnectionId, setTestEmailConnectionId] = useState("");

  useEffect(() => {
    fetch("/api/email-connections")
      .then((r) => r.json())
      .then((conns: EmailConnection[]) => {
        setEmailConnections(conns);
        if (conns.length === 1) {
          setTestEmailConnectionId(conns[0].id);
        }
      })
      .catch(() => {});
  }, []);

  async function handleTestSend() {
    const recipients = testEmail
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (recipients.length === 0) return;
    if (!testEmailConnectionId) return;

    setSending(true);
    try {
      await onTestSend(recipients, testEmailConnectionId);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4 p-4 bg-deep border border-border">
      <h3 className="heading-norse text-xs">Report Config</h3>

      <div>
        <label className="label-norse">Name</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="input-norse"
          placeholder="Monthly Sales Report"
        />
      </div>

      <div>
        <label className="label-norse">Description</label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          className="input-norse resize-none"
          rows={3}
          placeholder="What does this report show?"
        />
      </div>

      <div>
        <label className="label-norse">Connection</label>
        <select
          value={connectionId}
          onChange={(e) => onConnectionChange(e.target.value)}
          className="select-norse"
        >
          <option value="">Select a connection...</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <button
          onClick={onSave}
          disabled={saving || !name || !connectionId}
          className="btn-primary w-full"
        >
          <span>{saving ? "Saving..." : "Save Report"}</span>
        </button>
        {!isNew && (
          <button
            onClick={onSaveAndSchedule}
            disabled={saving || !name || !connectionId}
            className="btn-ghost w-full"
          >
            Save & Schedule
          </button>
        )}
      </div>

      {hasChanges && (
        <p className="text-[0.625rem] text-warning tracking-[0.2em] uppercase">
          Unsaved changes
        </p>
      )}

      {/* Test Send */}
      {!isNew && (
        <div className="pt-2 border-t border-border">
          <h4 className="heading-norse text-[0.5625rem] mb-2">Test Send</h4>
          {emailConnections.length > 0 ? (
            <select
              value={testEmailConnectionId}
              onChange={(e) => setTestEmailConnectionId(e.target.value)}
              className="select-norse text-xs mb-2"
              disabled={sending}
            >
              <option value="">Select email connection...</option>
              {emailConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[0.5625rem] text-text-dim tracking-wide mb-2">
              No email connections.{" "}
              <a href="/connections/new" className="text-gold hover:text-gold-bright underline">
                Add one
              </a>
            </p>
          )}
          <input
            type="text"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            placeholder="email@example.com"
            className="input-norse text-xs mb-2"
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !sending) handleTestSend();
            }}
          />
          {sending ? (
            <div className="py-2">
              <p className="text-[0.5625rem] text-gold tracking-[0.2em] uppercase text-center mb-2">
                Sending test email...
              </p>
              <div className="progress-norse" />
            </div>
          ) : (
            <button
              onClick={handleTestSend}
              disabled={!testEmail.trim() || hasChanges || !testEmailConnectionId}
              className="btn-ghost w-full text-xs"
              title={hasChanges ? "Save changes before sending" : undefined}
            >
              Send Test Email
            </button>
          )}
          {!sending && hasChanges && (
            <p className="text-[0.5rem] text-text-dim tracking-wide mt-1">
              Save changes before sending
            </p>
          )}
        </div>
      )}
    </div>
  );
}
