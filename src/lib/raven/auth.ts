import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyRavenApiKey } from "./api-key";

export interface RavenAuthContext {
  tenantId: string;
  apiKeyId: string;
}

/**
 * Authentication wrapper for Raven machine-to-machine API routes.
 *
 * This is SEPARATE from the NextAuth withAuth() wrapper:
 * - withAuth()      → human dashboard access via browser sessions
 * - withRavenAuth() → machine-to-machine Raven agent access via API keys
 *
 * Steps:
 * 1. Extract API key from Authorization header: "Bearer hrv_..."
 * 2. Look up all active, non-expired RavenApiKey candidates by prefix
 * 3. Verify full key against each candidate's keyHash (bcrypt compare)
 * 4. Update lastUsedAt (fire-and-forget)
 * 5. Pass { tenantId, apiKeyId } to the handler
 * 6. Return 401 on any failure with generic message
 */
export function withRavenAuth(
  handler: (req: NextRequest, context: RavenAuthContext) => Promise<Response>
) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const fullKey = authHeader.slice(7).trim();
      if (!fullKey.startsWith("hrv_") || fullKey.length < 12) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Prefix = first 8 chars (e.g. "hrv_a1B2")
      const prefix = fullKey.substring(0, 8);

      // Look up candidates by prefix — fast index scan
      const candidates = await prisma.ravenApiKey.findMany({
        where: {
          keyPrefix: prefix,
          status: "active",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: {
          id: true,
          keyHash: true,
          tenantId: true,
        },
      });

      if (candidates.length === 0) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Verify full key against each candidate (typically 1)
      let matched: (typeof candidates)[number] | null = null;
      for (const candidate of candidates) {
        const valid = await verifyRavenApiKey(fullKey, candidate.keyHash);
        if (valid) {
          matched = candidate;
          break;
        }
      }

      if (!matched) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Update lastUsedAt — fire-and-forget
      prisma.ravenApiKey
        .update({
          where: { id: matched.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});

      return await handler(req, {
        tenantId: matched.tenantId,
        apiKeyId: matched.id,
      });
    } catch (error) {
      console.error(
        "Raven auth error:",
        error instanceof Error ? error.message : error
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  };
}
