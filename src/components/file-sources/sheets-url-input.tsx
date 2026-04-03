"use client";

import { useState } from "react";

interface SheetsUrlInputProps {
  onDetected: (result: unknown) => void;
}

export function SheetsUrlInput({ onDetected }: SheetsUrlInputProps) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDetect() {
    if (!url.trim()) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/connections/sheets/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetUrl: url }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Detection failed" }));
        setError(body.error || "Failed to detect sheet schema");
        return;
      }

      onDetected(await res.json());
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label-norse">Google Sheets URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="input-norse"
        />
      </div>
      <button
        onClick={handleDetect}
        disabled={loading || !url.trim()}
        className="btn-primary text-xs"
      >
        <span>{loading ? "Detecting..." : "Detect Schema"}</span>
      </button>
      {error && <p className="text-error text-xs">{error}</p>}
    </div>
  );
}
