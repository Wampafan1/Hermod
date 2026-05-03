/**
 * SSRF protection for user-supplied network targets.
 *
 * Rejects private/reserved IP ranges before connection tests or discovery
 * requests can probe internal services.
 */

import { isIP } from "net";
import { lookup } from "dns/promises";

type ResolvedAddress = { address: string; family: 4 | 6 };
type CloseableDispatcher = { close(): Promise<void> };

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
  const mappedIPv4 = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : null;
  if (mappedIPv4 && isIP(mappedIPv4) === 4) {
    return isPrivateIPv4(mappedIPv4);
  }

  return lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    lower.startsWith("2001:db8");
}

function privateAddressError(host: string, address: ResolvedAddress): string | null {
  if (address.family === 4 && isPrivateIPv4(address.address)) {
    return host === address.address
      ? `Connection to private IP "${address.address}" is not allowed`
      : `Host "${host}" resolves to private IP ${address.address}`;
  }
  if (address.family === 6 && isPrivateIPv6(address.address)) {
    return host === address.address
      ? `Connection to private IP "${address.address}" is not allowed`
      : `Host "${host}" resolves to private IP ${address.address}`;
  }
  return null;
}

async function resolvePublicAddresses(host: string): Promise<ResolvedAddress[]> {
  const normalizedHost = host.replace(/^\[|\]$/g, "");

  if (isIP(normalizedHost) === 4 || isIP(normalizedHost) === 6) {
    const address = {
      address: normalizedHost,
      family: isIP(normalizedHost) as 4 | 6,
    };
    const error = privateAddressError(normalizedHost, address);
    if (error) throw new Error(error);
    return [address];
  }

  const results = await lookup(normalizedHost, { all: true });
  const addresses = results.map((result) => ({
    address: result.address,
    family: result.family as 4 | 6,
  }));
  for (const address of addresses) {
    const error = privateAddressError(normalizedHost, address);
    if (error) throw new Error(error);
  }
  return addresses;
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
    await resolvePublicAddresses(normalizedHost);
  } catch (error) {
    if (error instanceof Error && error.message.includes("private IP")) return error.message;
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
    const url = new URL(currentUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`URL protocol "${url.protocol}" is not allowed`);
    }
    const addresses = process.env.ALLOW_PRIVATE_IPS === "true"
      ? []
      : await resolvePublicAddresses(url.hostname);
    const dispatcher = addresses.length > 0 ? await createPinnedDispatcher(addresses) : null;

    let response: Response;
    try {
      response = await globalThis.fetch(currentUrl, {
        ...init,
        redirect: "manual",
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: unknown });
    } catch (error) {
      if (dispatcher) await dispatcher.close();
      throw error;
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return bufferAndCloseResponse(response, dispatcher);
    }

    const location = response.headers.get("location");
    if (!location) {
      return bufferAndCloseResponse(response, dispatcher);
    }

    if (dispatcher) await dispatcher.close();
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects");
}

async function createPinnedDispatcher(addresses: ResolvedAddress[]): Promise<CloseableDispatcher> {
  const { Agent } = await import("undici");
  let nextIndex = 0;
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        const address = addresses[nextIndex % addresses.length];
        nextIndex += 1;
        callback(null, address.address, address.family);
      },
    },
  });
}

async function bufferAndCloseResponse(
  response: Response,
  dispatcher: CloseableDispatcher | null
): Promise<Response> {
  const headers = new Headers(response.headers);
  if (typeof response.arrayBuffer !== "function") {
    if (dispatcher) await dispatcher.close();
    return response;
  }
  const body = response.status === 204 || response.status === 304
    ? null
    : await response.arrayBuffer();
  if (dispatcher) await dispatcher.close();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
