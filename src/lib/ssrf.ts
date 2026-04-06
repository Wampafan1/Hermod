/**
 * SSRF protection — reject private/reserved IP addresses in connection tests.
 *
 * Prevents users from probing internal networks by testing connections to
 * private IPs (10.x.x.x, 192.168.x.x, 172.16-31.x.x, 127.x.x.x, etc.).
 */

import { isIP } from "net";
import { lookup } from "dns/promises";

/** RFC 1918 + RFC 5737 + loopback + link-local + reserved ranges */
const PRIVATE_RANGES: Array<{ prefix: number[]; mask: number }> = [
  { prefix: [10], mask: 8 },           // 10.0.0.0/8
  { prefix: [172, 16], mask: 12 },     // 172.16.0.0/12
  { prefix: [192, 168], mask: 16 },    // 192.168.0.0/16
  { prefix: [127], mask: 8 },          // 127.0.0.0/8
  { prefix: [169, 254], mask: 16 },    // 169.254.0.0/16 (link-local)
  { prefix: [0], mask: 8 },            // 0.0.0.0/8
];

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }

  for (const range of PRIVATE_RANGES) {
    let match = true;
    for (let i = 0; i < range.prefix.length; i++) {
      if (range.mask <= 8 && i === 0) {
        // For /8 masks, only check first octet
        if (parts[0] !== range.prefix[0]) { match = false; break; }
      } else if (i === 1 && range.mask === 12) {
        // For 172.16.0.0/12: second octet must be 16-31
        if (parts[0] !== 172 || parts[1] < 16 || parts[1] > 31) { match = false; break; }
      } else {
        if (parts[i] !== range.prefix[i]) { match = false; break; }
      }
    }
    if (match) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 (loopback), fc00::/7 (unique local), fe80::/10 (link-local)
  return lower === "::1" ||
    lower.startsWith("fc") || lower.startsWith("fd") ||
    lower.startsWith("fe80");
}

/**
 * Check if a host resolves to a private/reserved IP.
 * Returns an error message if the host is private, or null if it's safe.
 */
export async function checkSsrf(host: string): Promise<string | null> {
  if (process.env.ALLOW_PRIVATE_IPS === "true") return null;

  // Direct IP address check
  if (isIP(host) === 4) {
    if (isPrivateIPv4(host)) {
      return `Connection to private IP "${host}" is not allowed`;
    }
    return null;
  }
  if (isIP(host) === 6) {
    if (isPrivateIPv6(host)) {
      return `Connection to private IP "${host}" is not allowed`;
    }
    return null;
  }

  // Hostname — resolve to IP and check
  try {
    const result = await lookup(host);
    if (result.family === 4 && isPrivateIPv4(result.address)) {
      return `Host "${host}" resolves to private IP ${result.address}`;
    }
    if (result.family === 6 && isPrivateIPv6(result.address)) {
      return `Host "${host}" resolves to private IP ${result.address}`;
    }
  } catch {
    // DNS resolution failure — let the connection test itself handle it
  }

  return null;
}
