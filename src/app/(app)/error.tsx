"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Hermod] Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24">
      <span className="text-gold/20 text-4xl font-cinzel block mb-4">ᛉ</span>
      <h2 className="heading-norse text-lg mb-2">Something Went Wrong</h2>
      <p className="text-text-dim text-xs tracking-wide max-w-md text-center leading-relaxed mb-6">
        {error.message || "An unexpected error occurred. The forge has been disrupted."}
      </p>
      <button onClick={reset} className="btn-primary">
        <span>Try Again</span>
      </button>
    </div>
  );
}
