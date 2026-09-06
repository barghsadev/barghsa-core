import {
  defaultInboxContent,
  defaultInboxLink,
  renderTemplate,
} from '@barghsa/shared/notifications';
export { relativeLinkRoute } from '@barghsa/shared/notifications';
import { getDbPool } from '@barghsa/db';
import type {
  INotificationTransport,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications';

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
 * - `profile_id`  ← payload.profileId (optional profile context; explicit account
 *   recipients remain private even when they have no customer profile).
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
  readonly channel = 'in_app' as const;

  /**
   * @param pool Optional query pool override for tests; defaults to the shared
   *   worker pool via `getDbPool()`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly pool: any = null) {}

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (!payload.profileId && !payload.recipientId) {
      throw new Error('in_app transport requires a profile or account recipient');
    }

    const pool = this.pool ?? getDbPool();
    const deliveryKey = payload.outboxId
      ? `outbox:${payload.outboxId}`
      : `transport:${payload.idempotencyKey}`;
    const recipient = payload.recipientId === payload.profileId ? null : payload.recipientId;
    const existing = await pool.query(
      `SELECT id FROM in_app_notifications WHERE delivery_key=$1
      AND profile_id IS NOT DISTINCT FROM $2::uuid AND recipient_user_id IS NOT DISTINCT FROM $3::text`,
      [deliveryKey, payload.profileId, recipient]
    );
    if (existing.rows[0]) return { status: 'delivered', providerRef: existing.rows[0].id };
    const content = defaultInboxContent(payload.eventKey, payload.payload);
    const templates = await pool.query(
      `SELECT locale,subject,body_template,variables FROM notification_templates
      WHERE event_key=$1 AND channel='in_app' AND status='active' AND is_active=true`,
      [payload.eventKey]
    );
    for (const template of templates.rows) {
      if (template.locale !== 'fa' && template.locale !== 'en')
        throw new Error('Invalid inbox template locale');
      if (!Array.isArray(template.variables) || typeof template.body_template !== 'string')
        throw new Error('Invalid inbox template');
      const names = template.variables.map((item: unknown) =>
        typeof item === 'string'
          ? item.trim()
          : item && typeof item === 'object' && 'name' in item && typeof item.name === 'string'
            ? item.name.trim()
            : ''
      );
      if (names.some((name: string) => !name)) throw new Error('Invalid inbox template variables');
      const title = renderTemplate(
        template.subject ?? content[template.locale as 'fa' | 'en'].title,
        names,
        { data: payload.payload, escapeValues: false }
      );
      const body = renderTemplate(template.body_template, names, {
        data: payload.payload,
        escapeValues: false,
      });
      if (
        title.missing.length ||
        title.unknown.length ||
        body.missing.length ||
        body.unknown.length
      )
        throw new Error('Inbox template data incomplete');
      content[template.locale as 'fa' | 'en'] = { title: title.output, body: body.output };
    }
    const linkRoute = defaultInboxLink(payload.eventKey, payload.payload);

    const inserted: { rows: Array<{ id: string }> } = await pool.query(
      `INSERT INTO in_app_notifications
         (profile_id, type, title_i18n_key, body_i18n_key, params, link_route, delivery_key,recipient_user_id,localized_content)
       VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9)
       ON CONFLICT (delivery_key) DO UPDATE SET delivery_key=EXCLUDED.delivery_key
       WHERE in_app_notifications.profile_id IS NOT DISTINCT FROM EXCLUDED.profile_id AND in_app_notifications.type=EXCLUDED.type AND in_app_notifications.recipient_user_id IS NOT DISTINCT FROM EXCLUDED.recipient_user_id
       RETURNING id`,
      [
        payload.profileId,
        payload.eventKey,
        `notifications.${payload.eventKey}.title`,
        `notifications.${payload.eventKey}.body`,
        JSON.stringify(payload.payload ?? {}),
        linkRoute,
        deliveryKey,
        recipient,
        JSON.stringify(content),
      ]
    );

    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error('in_app transport: insert did not return a row id');
    }

    return { providerRef: id, status: 'delivered' };
  }
}
