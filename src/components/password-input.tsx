"use client";

import { useState, useCallback } from "react";

interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Override the default className. Falls back to "input-norse" */
  className?: string;
}

/**
 * Password input with an eye toggle to reveal/hide the value.
 * Drop-in replacement for <input type="password" />.
 */
export function PasswordInput({ className = "input-norse", ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const toggle = useCallback(() => setVisible((v) => !v), []);

  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? "text" : "password"}
        className={`${className} pr-9`}
      />
      <button
        type="button"
        onClick={toggle}
        tabIndex={-1}
        aria-label={visible ? "Hide value" : "Show value"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-gold focus-visible:text-gold focus-visible:outline-none transition-colors"
      >
        {visible ? (
          /* Eye-off icon */
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          /* Eye icon */
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}
