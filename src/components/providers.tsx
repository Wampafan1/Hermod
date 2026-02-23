"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "@/components/toast";
import { HermodLoadingProvider } from "@/components/hermod-loading-context";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <HermodLoadingProvider>{children}</HermodLoadingProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
