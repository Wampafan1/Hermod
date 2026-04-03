"use client";

import { useState, useRef, useCallback } from "react";

export interface FileInfo {
  fileId: string;
  filename: string;
  columns: string[];
  rowCount: number;
}

interface FileUploadZoneProps {
  label: string;
  description: string;
  onUpload: (info: FileInfo) => void;
  disabled?: boolean;
}

export function FileUploadZone({
  label,
  description,
  onUpload,
  disabled = false,
}: FileUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<FileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".xlsx")) {
        setError("Only .xlsx files are supported.");
        return;
      }

      setError(null);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/mjolnir/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Upload failed.");
          return;
        }

        const data = await res.json();
        const info: FileInfo = {
          fileId: data.fileId,
          filename: data.filename,
          columns: data.columns,
          rowCount: data.rowCount,
        };

        setUploaded(info);
        onUpload(info);
      } catch {
        setError("Network error during upload.");
      } finally {
        setUploading(false);
      }
    },
    [onUpload]
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (disabled || uploading) return;

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!disabled && !uploading) setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  function handleClick() {
    if (disabled || uploading) return;
    inputRef.current?.click();
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be selected again
    e.target.value = "";
  }

  if (uploaded) {
    return (
      <div className="border border-gold/30 bg-deep p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <span className="label-norse">{label} File</span>
            <p className="text-text text-sm">{uploaded.filename}</p>
            <div className="flex items-center gap-4 text-text-dim text-xs tracking-wide">
              <span>{uploaded.columns.length} columns</span>
              <span>{uploaded.rowCount.toLocaleString()} rows</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {uploaded.columns.slice(0, 8).map((col) => (
                <span
                  key={col}
                  className="inline-block px-2 py-0.5 text-[0.6875rem] bg-gold/[0.06] border border-border text-text-dim tracking-wide"
                >
                  {col}
                </span>
              ))}
              {uploaded.columns.length > 8 && (
                <span className="inline-block px-2 py-0.5 text-[0.6875rem] text-text-dim tracking-wide">
                  +{uploaded.columns.length - 8} more
                </span>
              )}
            </div>
          </div>
          <span className="text-gold text-lg font-cinzel">ᚠ</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        className={`
          border-2 border-dashed p-10 text-center transition-colors cursor-pointer
          ${disabled || uploading ? "opacity-50 cursor-not-allowed" : ""}
          ${
            dragOver
              ? "border-gold/60 bg-gold/[0.03]"
              : "border-gold/20 hover:border-gold/40 hover:bg-gold/[0.02]"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={handleInputChange}
          disabled={disabled || uploading}
        />

        {uploading ? (
          <div className="space-y-3">
            <div className="spinner-norse mx-auto" />
            <p className="text-text-dim text-xs tracking-wide animate-pip-pulse">
              Uploading...
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <span className="text-gold/30 text-2xl font-cinzel block">
              {label === "BEFORE" ? "ᚢ" : "ᚦ"}
            </span>
            <p className="label-norse">{label}</p>
            <p className="text-text-dim text-xs tracking-wide max-w-xs mx-auto">
              {description}
            </p>
            <p className="text-text-dim/80 text-[0.625rem] tracking-wider mt-2">
              Drop .xlsx file here or click to browse
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="text-ember text-xs tracking-wide mt-2">{error}</p>
      )}
    </>
  );
}
