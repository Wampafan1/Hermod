/**
 * Safe, batched, idempotent migration: single-user -> multi-tenant
 *
 * Run with: npx tsx scripts/migrate-to-tenants.ts
 * Dry run:  npx tsx scripts/migrate-to-tenants.ts --dry-run
 *
 * For each user with data but no tenant:
 *   1. Creates a personal workspace (Tenant)
 *   2. Creates an OWNER membership
 *   3. Sets activeTenantId
 *   4. Backfills tenantId on all owned data
 *
 * Idempotent: skips users who already have activeTenantId set.
 * Safe: continues on error for individual users.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function generateUniqueSlug(baseName: string): Promise<string> {
  const baseSlug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  let slug = baseSlug || "workspace";
  let attempts = 0;

  while (attempts < 5) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    attempts++;
  }

  return `${baseSlug}-${Date.now().toString(36)}`;
}

async function main() {
  console.log(
    `[migrate-to-tenants] ${DRY_RUN ? "DRY RUN" : "LIVE RUN"} starting...`
  );

  // Find all users who don't have a tenant yet (idempotent -- safe to re-run)
  const users = await prisma.user.findMany({
    where: { activeTenantId: null },
    include: {
      reports: { select: { id: true } },
      connections: { select: { id: true } },
      bifrostRoutes: { select: { id: true } },
      sftpConnections: { select: { id: true } },
      emailConnections: { select: { id: true } },
      blueprints: { select: { id: true } },
    },
  });

  console.log(
    `[migrate-to-tenants] Found ${users.length} users without tenants`
  );

  let migrated = 0;
  let skipped = 0;

  for (const user of users) {
    const hasData =
      user.reports.length > 0 ||
      user.connections.length > 0 ||
      user.bifrostRoutes.length > 0 ||
      user.sftpConnections.length > 0 ||
      user.emailConnections.length > 0 ||
      user.blueprints.length > 0;

    if (!hasData) {
      console.log(
        `  [skip] ${user.email} -- no data, will onboard normally`
      );
      skipped++;
      continue;
    }

    console.log(
      `  [migrate] ${user.email} -- ` +
        `${user.reports.length} reports, ` +
        `${user.connections.length} connections, ` +
        `${user.bifrostRoutes.length} routes, ` +
        `${user.sftpConnections.length} sftp, ` +
        `${user.emailConnections.length} email, ` +
        `${user.blueprints.length} blueprints`
    );

    if (DRY_RUN) {
      migrated++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // 1. Create personal tenant
        const slug = await generateUniqueSlug(
          `${user.name || "user"}-workspace`
        );
        const tenant = await tx.tenant.create({
          data: {
            name: `${user.name || "User"}'s Workspace`,
            slug,
            domain: null, // personal workspace, no domain claim
          },
        });

        // 2. Create OWNER membership
        await tx.tenantMembership.create({
          data: {
            userId: user.id,
            tenantId: tenant.id,
            role: "OWNER",
          },
        });

        // 3. Set active tenant
        await tx.user.update({
          where: { id: user.id },
          data: { activeTenantId: tenant.id },
        });

        // 4. Backfill tenantId on ALL data models with tenantId field
        await tx.report.updateMany({
          where: { userId: user.id },
          data: { tenantId: tenant.id },
        });
        await tx.connection.updateMany({
          where: { userId: user.id },
          data: { tenantId: tenant.id },
        });
        await tx.bifrostRoute.updateMany({
          where: { userId: user.id },
          data: { tenantId: tenant.id },
        });
        await tx.sftpConnection.updateMany({
          where: { userId: user.id },
          data: { tenantId: tenant.id },
        });
        await tx.emailConnection.updateMany({
          where: { userId: user.id },
          data: { tenantId: tenant.id },
        });
        // ForgeBlueprint.createdBy is nullable — also catch via route ownership
        await tx.forgeBlueprint.updateMany({
          where: { createdBy: user.id },
          data: { tenantId: tenant.id },
        });
        await tx.forgeBlueprint.updateMany({
          where: {
            route: { userId: user.id },
            tenantId: null,
          },
          data: { tenantId: tenant.id },
        });
        // Backfill tenantId on route-scoped models via BifrostRoute ownership
        const routeIds = user.bifrostRoutes.map((r) => r.id);
        if (routeIds.length > 0) {
          await tx.pipelineWatermark.updateMany({
            where: { routeId: { in: routeIds } },
            data: { tenantId: tenant.id },
          });
          await tx.helheimEntry.updateMany({
            where: { routeId: { in: routeIds } },
            data: { tenantId: tenant.id },
          });
        }
      });

      migrated++;
      console.log(`  [done] ${user.email}`);
    } catch (err) {
      console.error(`  [ERROR] Failed to migrate ${user.email}:`, err);
      // Continue with next user -- don't abort the whole migration
    }
  }

  console.log(
    `\n[migrate-to-tenants] Done. Migrated: ${migrated}, Skipped: ${skipped}`
  );
  if (DRY_RUN) {
    console.log(
      "[migrate-to-tenants] This was a dry run. No changes were made."
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
