const ERROR_PATTERNS: Array<{ pattern: RegExp; narrative: string }> = [
  // Connection errors
  { pattern: /no baseUrl/i, narrative: "The messenger fell — no bridge to the realm" },
  { pattern: /ECONNREFUSED/i, narrative: "The realm gates are sealed — connection refused" },
  { pattern: /ETIMEDOUT/i, narrative: "The journey took too long — the messenger was lost in the void" },
  { pattern: /ENOTFOUND/i, narrative: "The realm cannot be found — check the address" },
  { pattern: /ECONNRESET/i, narrative: "The bridge collapsed mid-crossing — connection reset" },

  // Auth errors
  { pattern: /\b401\b/, narrative: "The gatekeeper turned the messenger away — invalid credentials" },
  { pattern: /\b403\b/, narrative: "Access to this realm is forbidden — check your permissions" },
  { pattern: /authentication failed/i, narrative: "The realm rejected our seal — verify your credentials" },
  { pattern: /INVALID_LOGIN/i, narrative: "The realm rejected our seal — invalid login" },

  // Rate limiting
  { pattern: /\b429\b/, narrative: "The realm demands rest — too many messengers sent too quickly" },
  { pattern: /rate.?limit/i, narrative: "The Bifrost is congested — dispatches will resume shortly" },

  // Data errors
  { pattern: /schema/i, narrative: "The scrolls arrived in an unexpected format" },
  { pattern: /no such field/i, narrative: "A field was lost in transit — the schema may have changed" },
  { pattern: /duplicate/i, narrative: "Duplicate scrolls detected — the records already exist" },

  // Timeout
  { pattern: /timeout/i, narrative: "The journey exceeded the allotted time" },
];

export function getErrorNarrative(error: string | null): string {
  if (!error) return "The messenger encountered an unknown obstacle";
  for (const { pattern, narrative } of ERROR_PATTERNS) {
    if (pattern.test(error)) return narrative;
  }
  return "The messenger encountered an unknown obstacle";
}

export function getErrorWithNarrative(error: string | null): {
  narrative: string;
  technical: string | null;
} {
  return {
    narrative: getErrorNarrative(error),
    technical: error,
  };
}
