import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import { hasRole } from "@/lib/auth-helpers";

export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "gmx.com",
];

// Roles that cannot be assigned via invitation
const RESERVED_ROLES: UserRole[] = ["OWNER", "BILLING", "API_SERVICE"];

// Roles visible in the UI invitation form
export const INVITABLE_ROLES: UserRole[] = ["ADMIN", "USER", "ANALYTICS"];

export async function createInvitation(params: {
  tenantId: string;
  email: string;
  role: UserRole;
  invitedBy: string;
}) {
  const email = params.email.toLowerCase().trim();

  // 1. Validate role is invitable
  if (RESERVED_ROLES.includes(params.role)) {
    throw new Error(`Cannot invite with role ${params.role}`);
  }

  // 2. Validate inviter has permission (must be ADMIN or OWNER of this tenant)
  const inviterMembership = await prisma.tenantMembership.findUnique({
    where: {
      userId_tenantId: {
        userId: params.invitedBy,
        tenantId: params.tenantId,
      },
    },
  });
  if (!inviterMembership || !hasRole(inviterMembership.role, "ADMIN")) {
    throw new Error("Only ADMIN or OWNER can invite users");
  }

  // 3. Check if user is already a member of this tenant
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMembership = await prisma.tenantMembership.findUnique({
      where: {
        userId_tenantId: {
          userId: existingUser.id,
          tenantId: params.tenantId,
        },
      },
    });
    if (existingMembership) {
      throw new Error("User is already a member of this tenant");
    }
  }

  // 4. Check for duplicate pending invitation
  const existingInvite = await prisma.invitation.findFirst({
    where: {
      tenantId: params.tenantId,
      email,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });
  if (existingInvite) {
    throw new Error("A pending invitation already exists for this email");
  }

  // 5. Create the invitation
  const invitation = await prisma.invitation.create({
    data: {
      tenantId: params.tenantId,
      email,
      role: params.role,
      invitedBy: params.invitedBy,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  // TODO: Send invitation email using existing Nodemailer infrastructure
  // The invitation link format: {APP_URL}/invite/{token}
  // When visited, if user is logged in, accept immediately
  // If not logged in, redirect to /login with ?callbackUrl=/invite/{token}

  return invitation;
}

export async function acceptInvitation(token: string, userId: string) {
  const invitation = await prisma.invitation.findUnique({
    where: { token },
  });

  if (!invitation) throw new Error("Invitation not found");
  if (invitation.status !== "PENDING")
    throw new Error("Invitation is no longer pending");
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    throw new Error("Invitation has expired");
  }

  // Check user isn't already a member
  const existing = await prisma.tenantMembership.findUnique({
    where: {
      userId_tenantId: { userId, tenantId: invitation.tenantId },
    },
  });
  if (existing) {
    // Already a member -- mark invitation as accepted and switch to this tenant
    await prisma.$transaction([
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { activeTenantId: invitation.tenantId },
      }),
    ]);
    return existing;
  }

  // Accept: create membership + update invitation + switch active tenant
  const [membership] = await prisma.$transaction([
    prisma.tenantMembership.create({
      data: {
        userId,
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
      where: { id: userId },
      data: { activeTenantId: invitation.tenantId },
    }),
  ]);

  return membership;
}

export async function revokeInvitation(
  invitationId: string,
  revokedBy: string
) {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  if (!invitation) throw new Error("Invitation not found");
  if (invitation.status !== "PENDING")
    throw new Error("Can only revoke pending invitations");

  // Validate revoker has permission
  const revokerMembership = await prisma.tenantMembership.findUnique({
    where: {
      userId_tenantId: {
        userId: revokedBy,
        tenantId: invitation.tenantId,
      },
    },
  });
  if (!revokerMembership || !hasRole(revokerMembership.role, "ADMIN")) {
    throw new Error("Only ADMIN or OWNER can revoke invitations");
  }

  return prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED" },
  });
}
