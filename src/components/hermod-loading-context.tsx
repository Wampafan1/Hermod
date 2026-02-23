"use client";

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import HermodProgress from "@/components/hermod-progress";

interface HermodLoadingContextType {
  showLoading: (statusText?: string) => void;
  hideLoading: () => void;
  setProgress: (value: number) => void;
}

const HermodLoadingContext = createContext<HermodLoadingContextType | null>(null);

export function HermodLoadingProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [statusText, setStatusText] = useState<string | undefined>(undefined);

  const showLoading = useCallback((text?: string) => {
    setStatusText(text);
    setProgress(undefined);
    setIsOpen(true);
  }, []);

  const hideLoading = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateProgress = useCallback((value: number) => {
    setProgress(value);
  }, []);

  const value = useMemo(
    () => ({ showLoading, hideLoading, setProgress: updateProgress }),
    [showLoading, hideLoading, updateProgress]
  );

  return (
    <HermodLoadingContext.Provider value={value}>
      {children}
      <HermodProgress
        isOpen={isOpen}
        variant="round-robin"
        progress={progress}
        statusText={statusText}
      />
    </HermodLoadingContext.Provider>
  );
}

export function useHermodLoading() {
  const ctx = useContext(HermodLoadingContext);
  if (!ctx) throw new Error("useHermodLoading must be used within HermodLoadingProvider");
  return ctx;
}
