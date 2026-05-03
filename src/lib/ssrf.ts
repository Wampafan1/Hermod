/**
 * SSRF protection for user-supplied network targets.
 *
 * Rejects private/reserved IP ranges before connection tests or discovery
 * requests can probe internal services.
 */

import { isIP } from "net";
import { lookup } from "dns/promises";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80");
}

/**
 * Check if a host resolves to a private/reserved IP.
 * Returns an error message if the host is private, or null if it is safe.
 */
export async function checkSsrf(host: string): Promise<string | null> {
  if (process.env.ALLOW_PRIVATE_IPS === "true") return null;

  const normalizedHost = host.replace(/^\[|\]$/g, "");

  if (isIP(normalizedHost) === 4) {
    if (isPrivateIPv4(normalizedHost)) {
      return `Connection to private IP "${normalizedHost}" is not allowed`;
    }
    return null;
  }

  if (isIP(normalizedHost) === 6) {
    if (isPrivateIPv6(normalizedHost)) {
      return `Connection to private IP "${normalizedHost}" is not allowed`;
    }
    return null;
  }

  try {
    const results = await lookup(normalizedHost, { all: true });
    for (const result of results) {
      if (result.family === 4 && isPrivateIPv4(result.address)) {
        return `Host "${normalizedHost}" resolves to private IP ${result.address}`;
      }
      if (result.family === 6 && isPrivateIPv6(result.address)) {
        return `Host "${normalizedHost}" resolves to private IP ${result.address}`;
      }
    }
  } catch {
    // Let the actual connection attempt surface DNS failures.
  }

  return null;
}

export async function checkSsrfUrl(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "Invalid URL";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `URL protocol "${url.protocol}" is not allowed`;
  }

  return checkSsrf(url.hostname);
}

export async function fetchWithSsrfProtection(
  rawUrl: string,
  init?: RequestInit,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const ssrfError = await checkSsrfUrl(currentUrl);
    if (ssrfError) {
      throw new Error(ssrfError);
    }

    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      return response;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects");
}
