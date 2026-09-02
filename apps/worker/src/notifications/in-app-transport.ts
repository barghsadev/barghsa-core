import { getDbPool } from '@barghsa/db'
import type {
  INotificationTransport,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications'

/**
 * In-app notification transport adapter (E-05, T-05.02.01).
 *
 * Delivers an `in_app` channel by writing a row to `in_app_notifications`
 * synchronously — there is no external provider round-trip, so delivery is
 * durable the instant the outbox worker dispatches the channel. This makes
 * in-app delivery the mandatory, always-on channel for every business event
 * (it cannot be disabled), complementing the async email/SMS providers.
 *
 * Mapping from the dispatch payload to the table row:
 * - `profile_id`  ← payload.profileId (the recipient profile — always present
 *   on an outbox row; the table is profile-scoped, not user-scoped).
 * - `type`        ← payload.eventKey (drives icons & routing).
 * - `title_i18n_key` / `body_i18n_key` ← derived from the event type as
 *   `notifications.<eventKey>.title` / `.body`. This is a documented
 *   convention placeholder until the template engine (T-05.04.02) and the
 *   template registry land; the keys resolve at render time in the UI.
 * - `params`      ← payload.payload (interpolation variables).
 * - `link_route`  ← payload.payload.link_route when it is a same-origin
 *   relative path: it must start with `/`, contain no backslash / control /
 *   whitespace characters (including percent-encoded forms), and parse
 *   against a fixed origin without changing that origin.
 *   `link_params` stays NULL until a caller needs search params.
 *
 * The returned `providerRef` is the inserted row id, giving the outbox /
 * delivery-log a stable handle back to the in-app row. Errors are re-thrown
 * for the worker to classify and record (a failed insert is a genuine
 * delivery failure — the row must persist for in-app to count as delivered).
 */
export class InAppNotificationTransport implements INotificationTransport {
  readonly channel = 'in_app' as const

  /**
   * @param pool Optional query pool override for tests; defaults to the shared
   *   worker pool via `getDbPool()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pool: any = null) {}

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (!payload.profileId) {
      throw new Error('in_app transport requires a profileId recipient')
    }

    const pool = this.pool ?? getDbPool()
    const linkRoute = relativeLinkRoute(payload.payload)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inserted: { rows: Array<{ id: string }> } = await pool.query(
      `INSERT INTO in_app_notifications
         (profile_id, type, title_i18n_key, body_i18n_key, params, link_route)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        payload.profileId,
        payload.eventKey,
        `notifications.${payload.eventKey}.title`,
        `notifications.${payload.eventKey}.body`,
        JSON.stringify(payload.payload ?? {}),
        linkRoute,
      ],
    )

    const id = inserted.rows[0]?.id
    if (!id) {
      throw new Error('in_app transport: insert did not return a row id')
    }

    return { providerRef: id, status: 'delivered' }
  }
}

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
