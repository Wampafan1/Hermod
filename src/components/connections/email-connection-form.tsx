"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";

type AuthType = "NONE" | "PLAIN" | "OAUTH2";

interface EmailConnectionFormProps {
  onSaved: () => void;
  onClose: () => void;
  initial?: {
    id: string;
    name: string;
    host: string;
    port: number;
    secure: boolean;
    authType: AuthType;
    username?: string | null;
    fromAddress: string;
  };
}

export function EmailConnectionForm({ onSaved, onClose, initial }: EmailConnectionFormProps) {
  const toast = useToast();
  const isEditing = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [authType, setAuthType] = useState<AuthType>(initial?.authType ?? "PLAIN");
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? 587);
  const [secure, setSecure] = useState(initial?.secure ?? false);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState(initial?.fromAddress ?? "");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const needsCredentials = authType === "PLAIN" || authType === "OAUTH2";

  function handleAuthTypeChange(newType: AuthType) {
    setAuthType(newType);
    setTestResult(null);
    // Auto-suggest port based on auth/secure
    if (newType === "NONE") {
      setPort(25);
      setSecure(false);
    } else {
      setPort(587);
    }
  }

  function handleSecureChange(newSecure: boolean) {
    setSecure(newSecure);
    if (newSecure && port === 587) {
      setPort(465);
    } else if (!newSecure && port === 465) {
      setPort(587);
    }
  }

  function buildPayload() {
    return {
      name,
      host,
      port,
      secure,
      authType,
      username: needsCredentials ? username : null,
      password: needsCredentials ? password : null,
      fromAddress,
    };
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/email-connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        toast.success("Connection successful!");
      } else {
        toast.error(data.error || "Connection failed");
      }
    } catch {
      setTestResult({ success: false, error: "Network error" });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const url = isEditing
        ? `/api/email-connections/${initial!.id}`
        : "/api/email-connections";
      const method = isEditing ? "PUT" : "POST";
      const payload = buildPayload();

      // On edit, omit empty password to keep existing
      if (isEditing && !password && needsCredentials) {
        delete (payload as Record<string, unknown>).password;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success(isEditing ? "Email connection updated" : "Email connection created");
      onSaved();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="bg-deep border border-border-mid w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="heading-norse text-sm">
            {isEditing ? "Edit Email Connection" : "Add Email Connection"}
          </h2>
          <button
            onClick={onClose}
            className="text-text-dim hover:text-text text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="label-norse">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-norse"
              placeholder="Workspace Relay"
            />
          </div>

          {/* Auth Type */}
          <div>
            <label className="label-norse">Authentication</label>
            <select
              value={authType}
              onChange={(e) => handleAuthTypeChange(e.target.value as AuthType)}
              className="select-norse"
            >
              <option value="NONE">None (IP whitelist / relay)</option>
              <option value="PLAIN">Username & Password</option>
              <option value="OAUTH2">OAuth2</option>
            </select>
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label-norse">SMTP Host</label>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="input-norse"
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="label-norse">Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="input-norse"
              />
            </div>
          </div>

          {/* Secure */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={secure}
              onChange={(e) => handleSecureChange(e.target.checked)}
              className="accent-gold"
              id="email-secure"
            />
            <label htmlFor="email-secure" className="text-text text-xs tracking-wide cursor-pointer">
              Use TLS/SSL (port 465)
            </label>
          </div>

          {/* Credentials */}
          {needsCredentials && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-norse">Username</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-norse"
                  placeholder="user@domain.com"
                />
              </div>
              <div>
                <label className="label-norse">
                  Password{isEditing ? " (blank = keep)" : ""}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-norse"
                  placeholder="••••••••"
                />
              </div>
            </div>
          )}

          {/* From Address */}
          <div>
            <label className="label-norse">From Address</label>
            <input
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              className="input-norse"
              placeholder="Hermod <reports@yourdomain.com>"
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`text-xs px-3 py-2 ${
                testResult.success
                  ? "bg-success-dim border border-success/30 text-success"
                  : "bg-error-dim border border-error/30 text-error"
              }`}
            >
              {testResult.success
                ? "Connection successful!"
                : testResult.error || "Connection failed"}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t border-border bg-surface">
          <button
            onClick={handleTest}
            disabled={testing || !host}
            className="btn-ghost text-xs"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="btn-subtle">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name || !host || !fromAddress}
            className="btn-primary text-xs"
          >
            <span>{saving ? "Saving..." : "Save"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
