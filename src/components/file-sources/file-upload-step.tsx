"use client";

import { useState, useRef } from "react";

interface FileUploadStepProps {
  accept: string;
  acceptLabel: string;
  accentColor: string;
  realmRune: string;
  onUploaded: (result: unknown) => void;
  detectEndpoint: string;
}

export function FileUploadStep({
  accept,
  acceptLabel,
  accentColor,
  realmRune,
  onUploaded,
  detectEndpoint,
}: FileUploadStepProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(detectEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        setError(body.error || "Upload failed");
        return;
      }

      const result = await res.json();
      onUploaded(result);
    } catch {
      setError("Network error during upload");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div
      className={`border-2 border-dashed p-12 text-center transition-colors cursor-pointer ${
        dragging ? "bg-gold-dim" : "bg-deep hover:bg-scroll/50"
      }`}
      style={{ borderColor: dragging ? accentColor : "var(--border)" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onFileInput}
        className="hidden"
      />

      {uploading ? (
        <div>
          <span className="text-2xl font-cinzel animate-pip-pulse" style={{ color: accentColor }}>
            {realmRune}
          </span>
          <p className="text-text-dim text-sm tracking-wide mt-3">Uploading...</p>
        </div>
      ) : (
        <div>
          <span className="text-3xl font-cinzel select-none" style={{ color: accentColor, opacity: 0.5 }}>
            {realmRune}
          </span>
          <p className="text-text text-sm mt-3">
            Drop your file here or click to browse
          </p>
          <p className="text-text-muted text-xs tracking-wide mt-1">
            {acceptLabel}
          </p>
        </div>
      )}

      {error && (
        <p className="text-error text-xs mt-3">{error}</p>
      )}
    </div>
  );
}
