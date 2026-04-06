import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { prisma } from "@/lib/db";
import { testCatalogConnectionSchema } from "@/lib/validations/alfheim";

function extractSlug(url: string): string {
  return url.split("/catalog/")[1]?.split("/")[0]?.split("?")[0] ?? "";
}

interface AuthConfig {
  headerName?: string;
  credentialKey?: string;
  bodyAuth?: boolean;
  bodyTokenMap?: Record<string, string>;
}

function buildAuthHeaders(
  authType: string,
  authConfig: AuthConfig,
  credentials: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (authType) {
    case "API_KEY": {
      const headerName = authConfig.headerName ?? "X-Api-Key";
      const credKey = authConfig.credentialKey ?? "apiKey";
      const value = credentials[credKey];
      if (value) headers[headerName] = value;
      break;
    }
    case "BEARER": {
      const token = credentials.bearerToken ?? credentials.token;
      if (token) headers["Authorization"] = `Bearer ${token}`;
      break;
    }
    case "BASIC": {
      const username = credentials.username ?? "";
      const password = credentials.password ?? "";
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      break;
    }
    // OAUTH2 and CUSTOM would need additional handling
  }

  return headers;
}

// POST /api/alfheim/catalog/[slug]/test — test connection
export const POST = withAuth(async (req) => {
  const slug = extractSlug(req.url);

  const connector = await prisma.apiCatalogConnector.findUnique({
    where: { slug },
    include: { objects: { take: 1 } },
  });

  if (!connector) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }

  const body = await req.json();
  const parsed = testCatalogConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { credentials } = parsed.data;
  const authConfig = (connector.authConfig ?? {}) as AuthConfig;

  // Resolve baseUrl placeholders (e.g., {{accountId}})
  let resolvedBaseUrl = connector.baseUrl;
  for (const [key, value] of Object.entries(credentials)) {
    resolvedBaseUrl = resolvedBaseUrl.replace(
      new RegExp(`\\{\\{${key}\\}\\}`, "g"),
      value
    );
  }

  // Use the first object's endpoint for the test, or just hit the base URL
  const testPath = connector.objects[0]?.endpoint ?? "";
  const testUrl = `${resolvedBaseUrl.replace(/\/$/, "")}${testPath ? `/${testPath.replace(/^\//, "")}` : ""}`;

  const authHeaders = buildAuthHeaders(
    connector.authType,
    authConfig,
    credentials
  );

  try {
    const isBodyAuth = !!authConfig.bodyAuth;
    const paginationConfig = (connector.pagination ?? {}) as Record<string, unknown>;
    const isPost = isBodyAuth || paginationConfig.requestMethod === "POST";

    const fetchHeaders: Record<string, string> = {
      Accept: "application/json",
      ...authHeaders,
    };

    let fetchInit: RequestInit;

    if (isPost) {
      // POST-based API (e.g. SkuVault): send auth tokens + minimal pagination in body
      fetchHeaders["Content-Type"] = "application/json";
      const bodyPayload: Record<string, unknown> = {};

      // Inject body auth tokens
      if (authConfig.bodyTokenMap) {
        for (const [bodyKey, credField] of Object.entries(authConfig.bodyTokenMap)) {
          if (credentials[credField] != null) {
            bodyPayload[bodyKey] = credentials[credField];
          }
        }
      }

      // Minimal pagination to keep the response small
      const pageParam = (paginationConfig.pageParam as string) || "PageNumber";
      const limitParam = (paginationConfig.limitParam as string) || "PageSize";
      bodyPayload[pageParam] = 0;
      bodyPayload[limitParam] = 1;

      fetchInit = {
        method: "POST",
        headers: fetchHeaders,
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(15_000),
      };
    } else {
      fetchInit = {
        method: "GET",
        headers: fetchHeaders,
        signal: AbortSignal.timeout(15_000),
      };
    }

    const response = await fetch(testUrl, fetchInit);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json({
        success: false,
        error: `API returned ${response.status}: ${text.slice(0, 200)}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown connection error";
    return NextResponse.json({ success: false, error: message });
  }
});
