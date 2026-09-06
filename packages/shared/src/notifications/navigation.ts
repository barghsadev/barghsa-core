/**
 * Fixed origin used only to detect URL-parser host hijacks such as
 * `/\\evil.example`. It is not a real application host.
 */
const LINK_ROUTE_ORIGIN = 'https://barghsa.invalid'

const LINK_ROUTE_MAX_LENGTH = 2048

/** Backslash, ASCII/Unicode whitespace, and control/format characters. */
const LINK_ROUTE_UNSAFE_CHARS = /[\\\s\p{Cc}\p{Cf}]/u

function decodeUntilStable(value: string): string | null {
  let current = value
  for (let i = 0; i < 5; i += 1) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      return null
    }
    if (next === current) return current
    current = next
  }
  return null
}

function isInternalPathname(pathname: string): boolean {
  return pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.includes('://')
}

/**
 * Persist only same-origin relative paths so a crafted payload cannot
 * turn the notification-center click into an open redirect.
 *
 * Browsers treat `\` as `/` in special-scheme URLs, so `/\\evil.example`
 * parses as the protocol-relative host `//evil.example`. Percent-encoded
 * backslashes (`/%5cevil.example`) are decoded before the same checks.
 */
export function relativeLinkRoute(payload: Record<string, unknown> | undefined): string | null {
  const candidate = payload?.link_route
  if (typeof candidate !== 'string') return null
  if (candidate.length === 0 || candidate.length > LINK_ROUTE_MAX_LENGTH) return null
  if (!candidate.startsWith('/')) return null
  if (LINK_ROUTE_UNSAFE_CHARS.test(candidate)) return null

  const decoded = decodeUntilStable(candidate)
  if (decoded === null || LINK_ROUTE_UNSAFE_CHARS.test(decoded)) return null
  if (!isInternalPathname(decoded)) return null

  let parsed: URL
  try {
    parsed = new URL(candidate, LINK_ROUTE_ORIGIN)
  } catch {
    return null
  }
  if (parsed.origin !== new URL(LINK_ROUTE_ORIGIN).origin) return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (!isInternalPathname(parsed.pathname)) return null

  return candidate
}


/** Normalize the former /app prefix and reject unsafe navigation targets. */
export function notificationLink(link: string | null | undefined): string | null {
  const normalized = link?.startsWith('/app/') ? link.slice(4) : link
  return relativeLinkRoute({ link_route: normalized })
}
