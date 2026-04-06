import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { PERSONAL_EMAIL_DOMAINS } from "@/lib/invitations";
import { generateUniqueSlug } from "@/lib/tenant-utils";
import { z } from "zod";

const onboardingSchema = z.object({
  workspaceName: z.string().min(1).max(100),
});

// POST /api/onboarding — Create tenant for new user
export async function POST(req: Request) {
  // Use getAuthSession pattern, NOT requireAuth (redirect loop)
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If user already has a tenant, redirect
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { activeTenantId: true, email: true },
  });

  if (dbUser?.activeTenantId) {
    return NextResponse.json({
      success: true,
      tenantId: dbUser.activeTenantId,
      redirectTo: "/dashboard",
    });
  }

  const body = await req.json();
  const parsed = onboardingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = (dbUser?.email || session.user.email || "").toLowerCase().trim();
  const emailDomain = email.split("@")[1] || "";
  const isPersonal = !emailDomain || PERSONAL_EMAIL_DOMAINS.includes(emailDomain);

  let tenant;
  let joinedExisting = false;

  if (!isPersonal && emailDomain) {
    // Business domain — check for existing tenant
    const existingTenant = await prisma.tenant.findUnique({
      where: { domain: emailDomain },
    });

    if (existingTenant) {
      // Join existing tenant as USER
      tenant = existingTenant;
      joinedExisting = true;

      // Check if already a member (idempotent)
      const existingMembership = await prisma.tenantMembership.findUnique({
        where: {
          userId_tenantId: {
            userId: session.user.id,
            tenantId: existingTenant.id,
          },
        },
      });

      if (!existingMembership) {
        await prisma.tenantMembership.create({
          data: {
            userId: session.user.id,
            tenantId: existingTenant.id,
            role: "USER",
          },
        });
      }

      await prisma.user.update({
        where: { id: session.user.id },
        data: { activeTenantId: existingTenant.id },
      });
    } else {
      // New business domain — create tenant with domain claim
      const slug = await generateUniqueSlug(parsed.data.workspaceName);

      try {
        tenant = await prisma.tenant.create({
          data: {
            name: parsed.data.workspaceName,
            slug,
            domain: emailDomain,
          },
        });
      } catch (err) {
        // Race condition: another user from same domain created the tenant
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          const target = err.meta?.target;
          const isDomainCollision = Array.isArray(target)
            ? target.includes("domain")
            : target === "domain";

          if (isDomainCollision) {
            tenant = await prisma.tenant.findUnique({
              where: { domain: emailDomain },
            });
            if (!tenant) throw err; // Should never happen
            joinedExisting = true;
          } else {
            throw err; // Different unique constraint -- re-throw
          }
        } else {
          throw err;
        }
      }

      if (!joinedExisting && tenant) {
        // Created new tenant — make user OWNER
        await prisma.$transaction([
          prisma.tenantMembership.create({
            data: {
              userId: session.user.id,
              tenantId: tenant.id,
              role: "OWNER",
            },
          }),
          prisma.user.update({
            where: { id: session.user.id },
            data: { activeTenantId: tenant.id },
          }),
        ]);
      } else if (joinedExisting && tenant) {
        // Joined via race condition fallback
        const existingMembership = await prisma.tenantMembership.findUnique({
          where: {
            userId_tenantId: {
              userId: session.user.id,
              tenantId: tenant.id,
            },
          },
        });
        if (!existingMembership) {
          await prisma.tenantMembership.create({
            data: {
              userId: session.user.id,
              tenantId: tenant.id,
              role: "USER",
            },
          });
        }
        await prisma.user.update({
          where: { id: session.user.id },
          data: { activeTenantId: tenant.id },
        });
      }
    }
  } else {
    // Personal email — create personal workspace (no domain claim)
    const slug = await generateUniqueSlug(parsed.data.workspaceName);

    tenant = await prisma.tenant.create({
      data: {
        name: parsed.data.workspaceName,
        slug,
        domain: null,
      },
    });

    await prisma.$transaction([
      prisma.tenantMembership.create({
        data: {
          userId: session.user.id,
          tenantId: tenant.id,
          role: "OWNER",
        },
      }),
      prisma.user.update({
        where: { id: session.user.id },
        data: { activeTenantId: tenant.id },
      }),
    ]);
  }

  return NextResponse.json({
    success: true,
    tenantId: tenant!.id,
    tenantName: tenant!.name,
    joinedExisting,
    redirectTo: "/dashboard",
  });
}
