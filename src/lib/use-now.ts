"use client";

import { useEffect, useState } from "react";

export function useNow(initialNow: number, intervalMs = 60_000): number {
  const [now, setNow] = useState(initialNow);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}
