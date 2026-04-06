import { prisma } from "@/lib/db";

/**
 * Generate a unique slug for a tenant. Tries the clean slug first,
 * then appends random suffixes on collision. Uses cuid fragment as
 * final fallback (virtually impossible to reach).
 */
export async function generateUniqueSlug(baseName: string): Promise<string> {
  const baseSlug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

  // Try the clean slug first
  let slug = baseSlug || "workspace";
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing) return slug;

    // Collision -- append random suffix
    const suffix = Math.random().toString(36).slice(2, 6); // 4 random chars
    slug = `${baseSlug}-${suffix}`;
    attempts++;
  }

  // Fallback: timestamp-based (virtually impossible to reach)
  return `${baseSlug}-${Date.now().toString(36)}`;
}
