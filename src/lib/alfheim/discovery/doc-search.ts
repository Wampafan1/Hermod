// ---------------------------------------------------------------------------
// Alfheim Discovery — search for API documentation / OpenAPI specs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DocSearchResult {
  foundSpec: boolean;
  specUrl?: string;
  docsPages: { url: string; title: string; relevance: string }[];
  extractedEndpoints: string[];
  extractedAuthInfo: string;
  extractedPaginationInfo: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPEC_TIMEOUT_MS = 5_000;

/** Common paths where OpenAPI / Swagger specs are hosted. */
const SPEC_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/api-docs",
  "/api-docs.json",
  "/docs/openapi.json",
  "/docs/swagger.json",
  "/api/openapi.json",
  "/api/swagger.json",
  "/v1/openapi.json",
  "/v2/openapi.json",
  "/v3/openapi.json",
  "/.well-known/openapi.json",
];

/** Common documentation page paths. */
const DOC_PATHS = [
  "/docs",
  "/documentation",
  "/api-docs",
  "/api/docs",
  "/developer",
  "/developers",
  "/reference",
  "/api-reference",
  "/api",
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function searchForApiDocs(
  baseUrl: string,
): Promise<DocSearchResult> {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const domain = extractDomain(cleanBase);

  const result: DocSearchResult = {
    foundSpec: false,
    docsPages: [],
    extractedEndpoints: [],
    extractedAuthInfo: "",
    extractedPaginationInfo: "",
  };

  // --- Phase 1: Try to find an OpenAPI/Swagger spec file ---
  const specResult = await findSpec(cleanBase);
  if (specResult) {
    result.foundSpec = true;
    result.specUrl = specResult.url;

    // Try to extract basic info from the spec
    const specInfo = extractSpecInfo(specResult.body);
    if (specInfo) {
      result.extractedEndpoints = specInfo.endpoints;
      result.extractedAuthInfo = specInfo.authInfo;
      result.extractedPaginationInfo = specInfo.paginationInfo;
    }

    return result;
  }

  // --- Phase 2: Probe for documentation pages ---
  const docPages = await findDocPages(cleanBase, domain);
  result.docsPages = docPages;

  return result;
}

// ---------------------------------------------------------------------------
// Spec file discovery
// ---------------------------------------------------------------------------

async function findSpec(
  baseUrl: string,
): Promise<{ url: string; body: Record<string, unknown> } | null> {
  for (const specPath of SPEC_PATHS) {
    const url = `${baseUrl}${specPath}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SPEC_TIMEOUT_MS);

      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) continue;

      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null) continue;

      const obj = body as Record<string, unknown>;

      // Validate it looks like an OpenAPI or Swagger spec
      if (isOpenApiSpec(obj)) {
        return { url, body: obj };
      }
    } catch {
      // Connection errors, timeouts — skip silently
      continue;
    }
  }

  return null;
}

function isOpenApiSpec(obj: Record<string, unknown>): boolean {
  // OAS 3.x
  if (typeof obj.openapi === "string" && obj.openapi.startsWith("3")) return true;
  // Swagger 2.0
  if (typeof obj.swagger === "string" && obj.swagger.startsWith("2")) return true;
  // Heuristic: has paths and info
  if (obj.paths && obj.info) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Doc page discovery
// ---------------------------------------------------------------------------

async function findDocPages(
  baseUrl: string,
  domain: string,
): Promise<{ url: string; title: string; relevance: string }[]> {
  const pages: { url: string; title: string; relevance: string }[] = [];

  for (const docPath of DOC_PATHS) {
    const url = `${baseUrl}${docPath}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SPEC_TIMEOUT_MS);

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        pages.push({
          url,
          title: `${domain} — ${docPath.replace(/^\//, "")}`,
          relevance: docPath.includes("api") ? "high" : "medium",
        });
      }
    } catch {
      continue;
    }
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Spec info extraction (lightweight, no full parse)
// ---------------------------------------------------------------------------

function extractSpecInfo(
  spec: Record<string, unknown>,
): {
  endpoints: string[];
  authInfo: string;
  paginationInfo: string;
} | null {
  try {
    const endpoints: string[] = [];

    // Extract paths
    if (typeof spec.paths === "object" && spec.paths !== null) {
      const paths = spec.paths as Record<string, unknown>;
      for (const [path, methods] of Object.entries(paths)) {
        if (typeof methods === "object" && methods !== null) {
          const methodObj = methods as Record<string, unknown>;
          if (methodObj["get"]) endpoints.push(`GET ${path}`);
          if (methodObj["post"]) endpoints.push(`POST ${path}`);
        }
      }
    }

    // Extract auth info
    let authInfo = "none detected";
    const components = spec.components as Record<string, unknown> | undefined;
    const securitySchemes = components?.securitySchemes as
      | Record<string, unknown>
      | undefined;

    if (securitySchemes) {
      const types = Object.values(securitySchemes)
        .map((s) => {
          const scheme = s as Record<string, unknown>;
          if (scheme.type === "http") return `http/${scheme.scheme}`;
          return scheme.type as string;
        })
        .filter(Boolean);
      authInfo = types.join(", ") || "none detected";
    } else {
      // Swagger 2.0
      const secDefs = spec.securityDefinitions as
        | Record<string, unknown>
        | undefined;
      if (secDefs) {
        const types = Object.values(secDefs)
          .map((s) => (s as Record<string, unknown>).type as string)
          .filter(Boolean);
        authInfo = types.join(", ") || "none detected";
      }
    }

    // Pagination: look for parameters named page, limit, offset, cursor across all ops
    const paginationParams = new Set<string>();
    const pagKeywords = ["page", "limit", "offset", "cursor", "per_page", "page_size"];
    if (typeof spec.paths === "object" && spec.paths !== null) {
      const paths = spec.paths as Record<string, Record<string, unknown>>;
      for (const methods of Object.values(paths)) {
        for (const op of Object.values(methods)) {
          if (typeof op !== "object" || op === null) continue;
          const opObj = op as Record<string, unknown>;
          const params = opObj.parameters as Array<Record<string, unknown>> | undefined;
          if (!params) continue;
          for (const p of params) {
            if (pagKeywords.includes(String(p.name).toLowerCase())) {
              paginationParams.add(String(p.name));
            }
          }
        }
      }
    }

    const paginationInfo =
      paginationParams.size > 0
        ? `Parameters found: ${[...paginationParams].join(", ")}`
        : "none detected";

    return { endpoints, authInfo, paginationInfo };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
