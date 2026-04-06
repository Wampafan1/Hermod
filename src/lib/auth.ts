import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true, // Safe: Google verifies email ownership
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: "common", // Allow any Azure AD tenant (multi-tenant)
      allowDangerousEmailAccountLinking: true, // Safe: Entra ID verifies email ownership
    }),
    // NOTE on allowDangerousEmailAccountLinking:
    // Without this, a user who signs in with Google and later tries Microsoft (same email)
    // gets an OAuthAccountNotLinked error. Both providers verify email ownership, so linking
    // is safe here. If you ever add a provider that does NOT verify emails, do NOT set this.
  ],
  session: {
    strategy: "database",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async session({ session, user }) {
      // Attach user ID and active tenant to session.
      // IMPORTANT: This runs on every session load. Two small indexed queries.
      // NOTE: The next-auth `user` param only has id/name/email/image -- NOT activeTenantId.
      // We must fetch it from the DB first, then use it to load the membership.
      if (session.user) {
        session.user.id = user.id;

        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { activeTenantId: true },
        });

        if (dbUser?.activeTenantId) {
          const membership = await prisma.tenantMembership.findUnique({
            where: {
              userId_tenantId: {
                userId: user.id,
                tenantId: dbUser.activeTenantId,
              },
            },
            include: { tenant: true },
          });

          if (membership) {
            session.user.tenantId = membership.tenantId;
            session.user.tenantName = membership.tenant.name;
            session.user.tenantSlug = membership.tenant.slug;
            session.user.role = membership.role;
          }
        }
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      if (!isNewUser || !user.email) return;

      // --- INVITATION CHECK ONLY ---
      // Keep the signIn event lean. Only handle the case where a pending
      // invitation exists for this email. All other tenant provisioning
      // (personal workspace, business domain) happens on the /onboarding page.
      // This is deliberate: signIn callbacks are hard to debug across providers,
      // and tenant creation has domain logic + slug collision handling that
      // belongs in a proper request/response cycle with error UI.

      // SECURITY: Only trust email for domain claims / invitation matching
      // if the provider has verified it. Google always verifies. Microsoft Entra ID
      // verifies but doesn't always pass email_verified as a boolean in older token
      // versions -- treat Entra ID emails as verified since the provider handles it.
      // If you ever add a provider that does NOT verify emails, gate this logic.

      const invitation = await prisma.invitation.findFirst({
        where: {
          email: user.email.toLowerCase().trim(),
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      });

      if (invitation) {
        // Accept invitation: join existing tenant
        await prisma.$transaction([
          prisma.tenantMembership.create({
            data: {
              userId: user.id!,
              tenantId: invitation.tenantId,
              role: invitation.role,
              invitedBy: invitation.invitedBy,
            },
          }),
          prisma.invitation.update({
            where: { id: invitation.id },
            data: { status: "ACCEPTED" },
          }),
          prisma.user.update({
            where: { id: user.id! },
            data: { activeTenantId: invitation.tenantId },
          }),
        ]);
      }

      // If no invitation found, user.activeTenantId remains null.
      // The session callback will see no tenantId -> requireAuth() redirects to /onboarding.
    },
  },
};
