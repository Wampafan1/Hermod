export const REDACTED = "[redacted]";

export const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|pgpassword|secret|token|api[_-]?key|apikey|access[_-]?key|accesskeyid|secretaccesskey|serviceaccountkey|private[_-]?key|client[_-]?email|tokenSecret|consumerSecret|refresh[_-]?token|authorization|credential)/i;

const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(password|passwd|pwd|pgpassword|secretAccessKey|accessKeyId|serviceAccountKey|private_key|private-key|privateKey|client_email|client-email|clientEmail|tokenSecret|consumerSecret|refresh_token|refresh-token|refreshToken|secret|token|api[_-]?key|apiKey|access[_-]?key|authorization|credential)(\s*[:=]\s*)(["']?)[^"',;\s]+/gi;

export function redactSecretText(text: string): string {
  return text
    .replace(
      SENSITIVE_ASSIGNMENT_PATTERN,
      (_match, key: string, sep: string, quote: string) => `${key}${sep}${quote}${REDACTED}`
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bBasic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]");
}
