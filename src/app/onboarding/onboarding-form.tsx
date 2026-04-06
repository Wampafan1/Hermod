"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface OnboardingFormProps {
  userName: string;
  userImage: string | null;
  existingTenant: { id: string; name: string } | null;
  suggestedName: string;
  isPersonal: boolean;
}

export default function OnboardingForm({
  userName,
  userImage,
  existingTenant,
  suggestedName,
  isPersonal,
}: OnboardingFormProps) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState(suggestedName);
  const [selectedPlan, setSelectedPlan] = useState<"heimdall" | "thor" | "odin">("heimdall");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: workspaceName.trim(), plan: selectedPlan }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create workspace");
        setLoading(false);
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      router.push(data.redirectTo || "/dashboard");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function handleJoinExisting() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: existingTenant!.name }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to join workspace");
        setLoading(false);
        return;
      }

      router.push(data.redirectTo || "/dashboard");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div
      className="w-full max-w-md animate-fade-up"
      style={{
        animationDelay: "0.15s",
        background: "var(--deep)",
        border: "1px solid rgba(201,147,58,0.15)",
        padding: "2.5rem",
      }}
    >
      {/* User greeting */}
      <div className="flex items-center gap-3 mb-6">
        {userImage && (
          <img
            src={userImage}
            alt=""
            width={36}
            height={36}
            style={{ borderRadius: 0, border: "1px solid rgba(201,147,58,0.2)" }}
          />
        )}
        <div>
          <p
            style={{
              fontFamily: "var(--font-cinzel), 'Cinzel', serif",
              fontSize: 14,
              letterSpacing: "0.15em",
              color: "var(--gold-bright)",
            }}
          >
            Welcome, {userName}
          </p>
          <p
            style={{
              fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
              fontSize: 9,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
            }}
          >
            {isPersonal ? "Personal Workspace" : "Establish Your Realm"}
          </p>
        </div>
      </div>

      {/* Rune divider */}
      <div className="flex items-center gap-4 my-5">
        <div className="flex-1 h-px" style={{ background: "rgba(201,147,58,0.1)" }} />
        <span className="text-gold" style={{ fontSize: 12, opacity: 0.4 }}>
          ᚱ
        </span>
        <div className="flex-1 h-px" style={{ background: "rgba(201,147,58,0.1)" }} />
      </div>

      {existingTenant ? (
        /* Scenario A: Business domain tenant exists */
        <div>
          <p
            style={{
              fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
              fontSize: 12,
              lineHeight: 2,
              color: "var(--text-dim)",
              marginBottom: "1.5rem",
            }}
          >
            Your organization{" "}
            <span style={{ color: "var(--gold-bright)", fontWeight: 700 }}>
              {existingTenant.name}
            </span>{" "}
            is already on Hermod. You&apos;ll be added as a team member.
          </p>

          <button
            onClick={handleJoinExisting}
            disabled={loading}
            className="btn-primary w-full justify-center"
            style={{
              padding: "0.9rem 1.5rem",
              fontSize: 11,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? (
              <span className="flex items-center gap-3 justify-center">
                <div className="spinner-norse" style={{ width: 16, height: 16 }} />
                Joining...
              </span>
            ) : (
              `Enter ${existingTenant.name}`
            )}
          </button>
        </div>
      ) : (
        /* Scenario B & C: New workspace */
        <div>
          <label
            htmlFor="workspace-name"
            style={{
              fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
              fontSize: 9,
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              display: "block",
              marginBottom: "0.5rem",
            }}
          >
            Workspace Name
          </label>
          <input
            id="workspace-name"
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            maxLength={100}
            style={{
              fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
              fontSize: 13,
              letterSpacing: "0.04em",
              color: "var(--text)",
              background: "rgba(4,6,15,0.9)",
              border: "1px solid rgba(201,147,58,0.2)",
              padding: "0.75rem 1rem",
              width: "100%",
              outline: "none",
              borderRadius: 0,
            }}
            onFocus={(e) => {
              e.target.style.borderColor = "rgba(201,147,58,0.5)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = "rgba(201,147,58,0.2)";
            }}
          />

          {/* Plan selector */}
          <div className="mt-5">
            <label
              style={{
                fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                fontSize: 9,
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: "var(--text-dim)",
                display: "block",
                marginBottom: "0.5rem",
              }}
            >
              Choose Your Plan
            </label>
            <div className="flex flex-col gap-2">
              {([
                { id: "heimdall" as const, name: "Heimdall", price: "Free", desc: "Cloud connections, manual config" },
                { id: "thor" as const, name: "Thor", price: "$99/mo", desc: "Data Agent, webhooks, hourly scheduling" },
                { id: "odin" as const, name: "Odin", price: "$299/mo", desc: "AI formatting, API discovery, white-label" },
              ]).map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedPlan(plan.id)}
                  style={{
                    fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
                    fontSize: 12,
                    textAlign: "left",
                    padding: "0.75rem 1rem",
                    background: selectedPlan === plan.id ? "rgba(139,105,20,0.1)" : "transparent",
                    border: selectedPlan === plan.id
                      ? "1px solid rgba(201,147,58,0.5)"
                      : "1px solid rgba(201,147,58,0.15)",
                    color: "var(--text)",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                >
                  <span style={{ color: "var(--gold-bright)", fontWeight: 700, letterSpacing: "0.1em" }}>
                    {plan.name}
                  </span>
                  <span style={{ color: "var(--text-dim)", marginLeft: "0.75rem" }}>{plan.price}</span>
                  <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                    {plan.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreate}
            disabled={loading || !workspaceName.trim()}
            className="btn-primary w-full justify-center mt-5"
            style={{
              padding: "0.9rem 1.5rem",
              fontSize: 11,
              letterSpacing: "0.25em",
              textTransform: "uppercase",
              opacity: loading || !workspaceName.trim() ? 0.7 : 1,
            }}
          >
            {loading ? (
              <span className="flex items-center gap-3 justify-center">
                <div className="spinner-norse" style={{ width: 16, height: 16 }} />
                {selectedPlan === "heimdall" ? "Forging Realm..." : "Redirecting to Checkout..."}
              </span>
            ) : (
              selectedPlan === "heimdall" ? "Create Workspace" : `Continue with ${selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)}`
            )}
          </button>
        </div>
      )}

      {error && (
        <div
          className="mt-4"
          style={{
            fontFamily: "var(--font-inconsolata), 'Inconsolata', monospace",
            fontSize: 11,
            color: "var(--ember)",
            padding: "0.75rem",
            border: "1px solid rgba(232,93,32,0.3)",
            background: "rgba(232,93,32,0.05)",
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            className="block mt-2 text-gold hover:text-gold-bright"
            style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase" }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
