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
 *   relative path (must start with `/` and must not contain `://`).
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
 * Persist only same-origin relative paths so a crafted payload cannot
 * turn the notification-center click into an open redirect.
 */
export function relativeLinkRoute(payload: Record<string, unknown> | undefined): string | null {
  const candidate = payload?.link_route
  if (typeof candidate !== 'string') return null
  if (!candidate.startsWith('/')) return null
  if (candidate.startsWith('//') || candidate.includes('://')) return null
  return candidate
}
