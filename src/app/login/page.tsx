"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div
        className="animate-fade-up"
        style={{
          fontFamily: "var(--font-cinzel), 'Cinzel', serif",
          fontSize: "clamp(48px, 10vw, 80px)",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "0.06em",
          background:
            "linear-gradient(180deg, var(--gold-bright) 0%, var(--gold) 50%, #7a5520 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          filter: "drop-shadow(0 0 40px rgba(201,147,58,0.25))",
        }}
      >
        HERMOD
      </div>

      {/* Subtitle */}
      <p
        className="animate-fade-up"
        style={{
          animationDelay: "0.1s",
          fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
          fontSize: 10,
          letterSpacing: "0.5em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginTop: "0.75rem",
        }}
      >
        Report Delivery Engine
      </p>

      {/* Rune divider */}
      <div
        className="flex items-center gap-6 w-full max-w-xs my-10 animate-fade-up"
        style={{ animationDelay: "0.15s" }}
      >
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
        <span
          className="text-gold font-cinzel text-lg"
          style={{ opacity: 0.5 }}
        >
          ᚺ
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
      </div>

      {/* Label */}
      <p
        className="animate-fade-up"
        style={{
          animationDelay: "0.2s",
          fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
          fontSize: 9,
          letterSpacing: "0.4em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginBottom: "1.5rem",
        }}
      >
        Choose Your Realm
      </p>

      {/* Auth providers */}
      <div
        className="flex flex-col gap-3 w-full max-w-xs animate-fade-up"
        style={{ animationDelay: "0.25s" }}
      >
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="btn-primary w-full justify-center"
          style={{
            padding: "0.9rem 1.5rem",
            fontSize: 11,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
          }}
        >
          <span className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Sign in with Google
          </span>
        </button>

        <button
          disabled
          className="btn-ghost w-full justify-center"
          style={{
            padding: "0.9rem 1.5rem",
            fontSize: 11,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
          }}
          title="Coming soon"
        >
          <span className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
            </svg>
            Microsoft — Soon
          </span>
        </button>
      </div>

      {/* Footer */}
      <p
        className="animate-fade-up"
        style={{
          animationDelay: "0.35s",
          fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
          fontSize: 9,
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: "var(--text-dim)",
          marginTop: "3rem",
          opacity: 0.4,
        }}
      >
        Swift as Sleipnir
      </p>
    </div>
  );
}
