"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const RUNE_ICONS: Record<ToastType, string> = {
  success: "ᚱ",
  error: "ᛉ",
  info: "ᛁ",
};

const SEAL_STYLES: Record<ToastType, { bg: string; ring: string }> = {
  success: { bg: "var(--success)", ring: "rgba(45,107,63,0.35)" },
  error: { bg: "var(--error)", ring: "rgba(139,32,32,0.35)" },
  info: { bg: "var(--frost)", ring: "rgba(45,95,126,0.35)" },
};

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((msg: string) => addToast(msg, "success"), [addToast]);
  const error = useCallback((msg: string) => addToast(msg, "error"), [addToast]);
  const info = useCallback((msg: string) => addToast(msg, "info"), [addToast]);

  const value = useMemo<ToastContextValue>(
    () => ({ success, error, info }),
    [success, error, info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border-mid text-sm animate-toast-in shadow-[0_2px_8px_rgba(45,42,36,0.08)]"
          >
            <span
              className="flex items-center justify-center font-cinzel text-[13px] text-[color:var(--void)] select-none"
              style={{
                width: 22,
                height: 22,
                borderRadius: 9999,
                background: SEAL_STYLES[toast.type].bg,
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.25), 0 0 0 2px ${SEAL_STYLES[toast.type].ring}`,
              }}
              aria-hidden
            >
              {RUNE_ICONS[toast.type]}
            </span>
            <span className="text-text flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-text-dim hover:text-text ml-2 text-xs"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
