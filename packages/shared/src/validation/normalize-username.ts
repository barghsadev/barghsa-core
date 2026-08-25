/**
 * Normalize a username (email or Iranian mobile number) to canonical form.
 *
 * Handles these input formats:
 *   - `09xxxxxxxxx` (Iranian mobile, 11 digits starting with 09) → `+989xxxxxxxxx`
 *   - `+989xxxxxxxxx` (already E.164 Iranian mobile) → pass through
 *   - `00989xxxxxxxxx` → `+989xxxxxxxxx`
 *   - `989xxxxxxxxx` (missing `+`) → `+989xxxxxxxxx`
 *   - Email → lowercased
 *   - Other valid international numbers starting with `+` → pass through
 *
 * @returns Normalized username, or `null` when the input is not a recognisable format.
 */
export function normalizeUsername(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Iranian mobile 09xxxxxxxxx (11 digits starting with 09)
  const iranianMobileRe = /^09\d{9}$/
  if (iranianMobileRe.test(trimmed)) {
    return `+98${trimmed.slice(1)}`
  }

  // Iranian mobile 00989xxxxxxxxx (00 prefix)
  const iranianDoubleZeroRe = /^0098(\d{10})$/
  const doubleZeroMatch = trimmed.match(iranianDoubleZeroRe)
  if (doubleZeroMatch) {
    return `+98${doubleZeroMatch[1]}`
  }

  // Iranian mobile 989xxxxxxxxx (10 digits, no prefix)
  const iranianPlainRe = /^98(\d{10})$/
  const plainMatch = trimmed.match(iranianPlainRe)
  if (plainMatch) {
    return `+98${plainMatch[1]}`
  }

  // Already international (+ prefix, 7-15 digits)
  if (trimmed.startsWith('+') && /^\+\d{7,15}$/.test(trimmed)) {
    return trimmed
  }

  // Email
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (emailRe.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  return null
}