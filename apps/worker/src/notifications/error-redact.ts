/**
 * Shared error-redaction helpers (E-05, T-05.01.03 / T-05.01.05).
 *
 * Transport errors (SMTP/SMS/Gateway) can carry credentials, tokens, or
 * connection strings. Every persisted error field — the outbox `last_error`
 * and the delivery log `error_detail` — must be run through `sanitizeError`
 * so secrets never reach the database or the admin panel.
 */
const LAST_ERROR_MAX_LEN = 500

/**
 * Redact likely secret material from an error message and cap its length.
 * Matches common patterns: bearer tokens, api keys, passwords, and
 * credentials embedded in URLs.
 */
export function sanitizeError(message: string): string {
  const SECRET_PATTERNS: Array<{ re: RegExp; replacement: string }> = [
    { re: /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, replacement: '$1[REDACTED]' },
    { re: /(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(password\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(secret\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /(token\s*[=:]\s*)[^\s,;]+/gi, replacement: '$1[REDACTED]' },
    { re: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(:[^@\s/]*)?@/gi, replacement: '$1[REDACTED]@' },
    // Known provider/token shapes (AWS, OpenAI, GitHub, Slack, Stripe).
    { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED]' },
    { re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\b(ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, replacement: '[REDACTED]' },
    { re: /\bsk_live_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED]' },
    // Generic long alphanumeric run — high threshold to avoid scrubbing UUIDs
    // and short transaction/hash identifiers while still catching raw keys.
    { re: /([A-Za-z0-9]{48,})/g, replacement: '[REDACTED]' },
  ]
  let out = message
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, p.replacement)
  }
  return out.slice(0, LAST_ERROR_MAX_LEN)
}