"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type InviteState =
  | { status: "loading" }
  | { status: "accepting" }
  | { status: "success"; tenantName?: string }
  | { status: "error"; message: string }
  | { status: "unauthenticated" };

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [state, setState] = useState<InviteState>({ status: "loading" });
  const token = params.token as string;

  useEffect(() => {
    if (sessionStatus === "loading") return;

    if (sessionStatus === "unauthenticated") {
      // Redirect to login with callback back to this page
      router.push(`/login?callbackUrl=/invite/${token}`);
      return;
    }

    // User is authenticated — accept the invitation
    setState({ status: "accepting" });

    fetch(`/api/invitations/${token}/accept`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setState({ status: "error", message: data.error || "Failed to accept invitation" });
          return;
        }
        setState({ status: "success" });
        // Short delay to show success, then redirect
        setTimeout(() => router.push(data.redirectTo || "/dashboard"), 1500);
      })
      .catch(() => {
        setState({ status: "error", message: "Network error. Please try again." });
      });
  }, [sessionStatus, token, router]);

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-4">
      <div
        style={{
          fontFamily: "var(--font-cinzel), 'Cinzel', serif",
          fontSize: "clamp(36px, 8vw, 56px)",
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "0.06em",
          background:
            "linear-gradient(180deg, var(--gold-bright) 0%, var(--gold) 50%, #7a5520 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          marginBottom: "2rem",
        }}
      >
        HERMOD
      </div>

      <div
        className="w-full max-w-md"
        style={{
          background: "var(--deep)",
          border: "1px solid rgba(201,147,58,0.15)",
          padding: "2.5rem",
        }}
      >
        {(state.status === "loading" || state.status === "accepting") && (
          <div className="text-center">
            <div className="spinner-norse mx-auto mb-4" style={{ width: 24, height: 24 }} />
            <p
              style={{
                fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                fontSize: 11,
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
              }}
            >
              {state.status === "loading" ? "Verifying passage..." : "Accepting invitation..."}
            </p>
          </div>
        )}

        {state.status === "success" && (
          <div className="text-center">
            <p
              style={{
                fontFamily: "var(--font-cinzel), 'Cinzel', serif",
                fontSize: 18,
                letterSpacing: "0.15em",
                color: "var(--gold-bright)",
                marginBottom: "1rem",
              }}
            >
              Welcome to the Realm
            </p>
            <p
              style={{
                fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                fontSize: 11,
                letterSpacing: "0.2em",
                color: "var(--text-dim)",
              }}
            >
              Redirecting to your workspace...
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div className="text-center">
            <p
              style={{
                fontFamily: "var(--font-cinzel), 'Cinzel', serif",
                fontSize: 16,
                letterSpacing: "0.15em",
                color: "var(--ember)",
                marginBottom: "1rem",
              }}
            >
              Passage Denied
            </p>
            <p
              style={{
                fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                fontSize: 12,
                lineHeight: 1.8,
                color: "var(--text-dim)",
                marginBottom: "1.5rem",
              }}
            >
              {state.message}
            </p>
            <p
              style={{
                fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                fontSize: 10,
                letterSpacing: "0.2em",
                color: "var(--text-dim)",
                opacity: 0.6,
              }}
            >
              Contact the person who invited you for a new link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
