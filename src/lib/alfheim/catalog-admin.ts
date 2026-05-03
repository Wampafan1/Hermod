export function canManageApiCatalog(userId: string): boolean {
  const allowlist = process.env.ALFHEIM_CATALOG_ADMIN_USER_IDS;
  if (allowlist) {
    return allowlist
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .includes(userId);
  }

  return process.env.NODE_ENV !== "production";
}
