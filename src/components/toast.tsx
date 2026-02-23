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

const TOAST_STYLES: Record<ToastType, string> = {
  success: "border-l-2 border-l-success",
  error: "border-l-2 border-l-error",
  info: "border-l-2 border-l-frost",
};

const RUNE_COLORS: Record<ToastType, string> = {
  success: "text-success",
  error: "text-error",
  info: "text-frost",
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
            className={`flex items-center gap-3 px-4 py-3 bg-surface-raised border border-border-mid text-sm animate-toast-in ${TOAST_STYLES[toast.type]}`}
          >
            <span className={`text-base ${RUNE_COLORS[toast.type]}`}>
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
