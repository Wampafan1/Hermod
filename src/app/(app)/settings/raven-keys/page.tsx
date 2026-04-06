"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/toast";

interface ApiKeyEntry {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function RavenKeysPage() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Generate modal state
  const [showModal, setShowModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [keyExpires, setKeyExpires] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/raven-keys");
      if (!res.ok) throw new Error("Failed to load API keys");
      setKeys(await res.json());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleGenerate = async () => {
    if (!keyName.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/settings/raven-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName.trim(),
          ...(keyExpires ? { expiresAt: new Date(keyExpires).toISOString() } : {}),
        }),
      });
      if (!res.ok) throw new Error("Failed to generate key");
      const data = await res.json();
      setGeneratedKey(data.fullKey);
      fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setKeyName("");
    setKeyExpires("");
    setGeneratedKey(null);
    setCopied(false);
    setGenerating(false);
  };

  const handleRevoke = async (keyId: string) => {
    if (!window.confirm("Revoke this API key? Any Raven using it will lose access.")) return;
    try {
      const res = await fetch(`/api/settings/raven-keys/${keyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "revoked" }),
      });
      if (!res.ok) throw new Error("Failed to revoke key");
      toast.success("API key revoked");
      fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!window.confirm("Permanently delete this API key record?")) return;
    try {
      const res = await fetch(`/api/settings/raven-keys/${keyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete key");
      toast.success("API key deleted");
      fetchKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete key");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-cinzel text-gold-bright uppercase tracking-[0.25em] text-lg">
            Raven API Keys
          </h1>
          <p className="text-text-dim text-xs tracking-wide mt-1">
            Authentication keys for Raven on-premises agents
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="btn-primary text-xs"
        >
          Generate New Key
        </button>
      </div>

      {/* Key List */}
      {loading ? (
        <div className="text-text-dim text-xs tracking-wide text-center py-16">
          Loading API keys...
        </div>
      ) : keys.length === 0 ? (
        <div
          className="border border-gold-dim/20 p-12 text-center"
          style={{ background: "rgba(4,6,15,0.9)" }}
        >
          <div className="text-4xl mb-4 opacity-30">ᚲ</div>
          <p className="text-text-dim text-sm tracking-wide">
            No API keys generated
          </p>
          <p className="text-text-dim/60 text-xs tracking-wide mt-2">
            Generate a key to authenticate Raven agents
          </p>
        </div>
      ) : (
        <div
          className="border border-gold-dim/10 overflow-hidden"
          style={{ background: "rgba(4,6,15,0.9)" }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gold-dim/10">
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Name
                </th>
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Key
                </th>
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Status
                </th>
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Created
                </th>
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Last Used
                </th>
                <th className="text-left px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Expires
                </th>
                <th className="text-right px-4 py-2 text-text-dim tracking-wider uppercase text-[10px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-gold-dim/5 last:border-0"
                >
                  <td className="px-4 py-3 text-text tracking-wide">
                    <span
                      className={
                        key.status === "revoked" ? "line-through opacity-50" : ""
                      }
                    >
                      {key.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-dim">
                    {key.keyPrefix}...
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${
                        key.status === "active"
                          ? "text-green-400 bg-green-400/10"
                          : "text-red-400 bg-red-400/10"
                      }`}
                    >
                      {key.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-text-dim">
                    {formatDate(key.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-text-dim">
                    {relativeTime(key.lastUsedAt)}
                  </td>
                  <td className="px-4 py-3 text-text-dim">
                    {key.expiresAt ? formatDate(key.expiresAt) : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {key.status === "active" && (
                        <button
                          onClick={() => handleRevoke(key.id)}
                          className="text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(key.id)}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate Key Modal — portalled to body to escape stacking contexts */}
      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={closeModal}
        >
          <div
            className="border border-gold-dim/30 w-full max-w-md mx-4 p-6"
            style={{ background: "#080c1a" }}
            onClick={(e) => e.stopPropagation()}
          >
            {generatedKey ? (
              /* Key generated — show copy UI */
              <div className="space-y-4">
                <h2 className="font-cinzel text-gold-bright uppercase tracking-[0.25em] text-sm">
                  Key Generated
                </h2>

                <div
                  className="border border-amber-400/30 p-3"
                  style={{ background: "rgba(255,183,77,0.05)" }}
                >
                  <p className="text-amber-400 text-xs tracking-wide mb-2">
                    Copy this key now. You will not be able to see it again.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-text font-mono text-xs break-all select-all bg-void/50 p-2">
                      {generatedKey}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="btn-primary text-xs flex-shrink-0"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <button
                  onClick={closeModal}
                  className="btn-ghost text-xs w-full"
                >
                  Done
                </button>
              </div>
            ) : (
              /* Input form */
              <div className="space-y-4">
                <h2 className="font-cinzel uppercase tracking-[0.25em] text-sm" style={{ color: "#f0b84a" }}>
                  Generate API Key
                </h2>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.5em] block mb-1" style={{ color: "rgba(212,196,160,0.7)" }}>
                    Key Name
                  </label>
                  <input
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Production Raven Key"
                    className="w-full border px-3 py-2 text-xs tracking-wide focus:outline-none"
                    style={{ background: "transparent", borderColor: "rgba(201,147,58,0.3)", color: "#EDE4CC", caretColor: "#c9933a" }}
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.5em] block mb-1" style={{ color: "rgba(212,196,160,0.7)" }}>
                    Expiration (optional)
                  </label>
                  <input
                    type="date"
                    value={keyExpires}
                    onChange={(e) => setKeyExpires(e.target.value)}
                    className="w-full border px-3 py-2 text-xs tracking-wide focus:outline-none"
                    style={{ background: "transparent", borderColor: "rgba(201,147,58,0.3)", color: "#EDE4CC", caretColor: "#c9933a", colorScheme: "dark" }}
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !keyName.trim()}
                    className="btn-primary text-xs flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {generating ? "Generating..." : "Generate"}
                  </button>
                  <button
                    onClick={closeModal}
                    className="btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
