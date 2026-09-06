import { getDbPool } from '@barghsa/db'
import { createEmailSender, type DeliveryPool } from '@barghsa/shared/notification-delivery'
import { renderTemplate, type INotificationTransport, type NotificationSendPayload, type NotificationSendResult } from '@barghsa/shared/notifications'
import { loadNotificationRecipient } from './channel-availability-loader.js'

export class EmailNotificationTransport implements INotificationTransport {
  readonly channel = 'email' as const
  constructor(private readonly pool: DeliveryPool = getDbPool(), private readonly request: typeof fetch = fetch) {}

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (!payload.outboxId || !payload.profileId) throw new Error('Email requires a durable queued recipient')
    const recipient = await loadNotificationRecipient(this.pool, payload.outboxId)
    if (!recipient?.email || recipient.profileId !== payload.profileId) {
      throw new Error('Email recipient unavailable')
    }
    const templates = await this.pool.query(`SELECT subject,body_template,variables FROM notification_templates
      WHERE event_key=$1 AND channel='email' AND locale=$2 AND status='active' AND is_active=true`, [payload.eventKey, recipient.locale])
    if (templates.rows.length !== 1) throw new Error('Active email template unavailable')
    const template = templates.rows[0]!
    if (typeof template.subject !== 'string' || typeof template.body_template !== 'string' || !Array.isArray(template.variables)) throw new Error('Invalid email template')
    const names = template.variables.map((item: unknown) => typeof item === 'string' ? item.trim() :
      item && typeof item === 'object' && 'name' in item && typeof item.name === 'string' ? item.name.trim() : '')
    if (names.some(name => !name)) throw new Error('Invalid email template variables')
    const subject = renderTemplate(template.subject, names, { data: payload.payload, escapeValues: false })
    const body = renderTemplate(template.body_template, names, { data: payload.payload })
    if (subject.missing.length || subject.unknown.length || body.missing.length || body.unknown.length) throw new Error('Email template data incomplete')
    const providerRef = await createEmailSender(this.pool, this.request)({ destination: recipient.email, subject: subject.output,
      html: body.output, idempotencyKey: payload.idempotencyKey, ...(payload.signal ? { signal: payload.signal } : {}) })
    return { status: 'delivered', providerRef }
  }
}
