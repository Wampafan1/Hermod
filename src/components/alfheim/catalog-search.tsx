"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface CatalogSearchProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  total?: number;
}

export function CatalogSearch({
  value,
  onChange,
  resultCount,
  total,
}: CatalogSearchProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const debouncedOnChange = useCallback(
    (v: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onChange(v);
      }, 300);
    },
    [onChange]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setLocalValue(v);
    debouncedOnChange(v);
  }

  function handleClear() {
    setLocalValue("");
    onChange("");
    if (timerRef.current) clearTimeout(timerRef.current);
  }

  const isFiltering = localValue.length > 0;
  const showCounts =
    isFiltering &&
    resultCount !== undefined &&
    total !== undefined;

  return (
    <div className="relative">
      <input
        type="text"
        className="input-norse w-full pr-10"
        placeholder="Search connectors..."
        value={localValue}
        onChange={handleChange}
      />
      {isFiltering && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text transition-colors text-sm"
          aria-label="Clear search"
        >
          x
        </button>
      )}
      {showCounts && (
        <p className="text-text-dim text-[10px] tracking-wide mt-1.5 font-space-grotesk uppercase">
          Showing {resultCount} of {total} connectors
        </p>
      )}
    </div>
  );
}
