import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PERSONAL_EMAIL_DOMAINS } from "@/lib/invitations";
import OnboardingForm from "./onboarding-form";
import { RuneH } from "@/components/rune-h";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // CRITICAL: Use getServerSession, NOT requireAuth() -- redirect loop!
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  // If user already has a tenant, skip onboarding
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { activeTenantId: true },
  });
  if (dbUser?.activeTenantId) redirect("/dashboard");

  // Detect email domain scenario
  const email = (session.user.email || "").toLowerCase().trim();
  const emailDomain = email.split("@")[1] || "";
  const isPersonal = !emailDomain || PERSONAL_EMAIL_DOMAINS.includes(emailDomain);

  let existingTenant: { id: string; name: string } | null = null;
  let suggestedName = `${session.user.name || "User"}'s Workspace`;

  if (!isPersonal && emailDomain) {
    existingTenant = await prisma.tenant.findUnique({
      where: { domain: emailDomain },
      select: { id: true, name: true },
    });

    if (!existingTenant) {
      // Derive workspace name from domain (frostlineanalytics.com -> Frostline Analytics)
      const domainBase = emailDomain.split(".")[0] || emailDomain;
      suggestedName = domainBase
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }

  return (
    <div className="min-h-screen bg-void flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div
        className="animate-fade-up flex items-center"
        style={{
          gap: "0.35rem",
          color: "var(--gold-leaf)",
          marginBottom: "2rem",
        }}
      >
        <RuneH size={50} />
        <span
          style={{
            fontFamily: "var(--font-cinzel), 'Cinzel', serif",
            fontSize: "clamp(30px, 7vw, 48px)",
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            background:
              "linear-gradient(180deg, var(--gold-bright) 0%, var(--gold) 50%, #7a5520 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          ermod
        </span>
      </div>

      <OnboardingForm
        userName={session.user.name || "Traveler"}
        userImage={session.user.image || null}
        existingTenant={existingTenant}
        suggestedName={suggestedName}
        isPersonal={isPersonal}
      />
    </div>
  );
}
