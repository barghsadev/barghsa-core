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
    const jobs = await this.pool.query("SELECT delivery_payload FROM notification_job WHERE outbox_id=$1 AND channel='email'", [payload.outboxId])
    if (jobs.rows.length !== 1) throw new Error('Email job unavailable')
    let snapshot = jobs.rows[0]!.delivery_payload
    if (!snapshot) {
      const providers = await this.pool.query("SELECT id FROM email_provider_configs WHERE status='active' AND last_test_status='passed' AND degraded=false")
      if (providers.rows.length !== 1 || typeof providers.rows[0]!.id !== 'string') throw new Error('Email provider unavailable')
      const templates = await this.pool.query(`SELECT id,version,subject,body_template,variables FROM notification_templates
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
      const saved = await this.pool.query(`UPDATE notification_job SET delivery_payload=COALESCE(delivery_payload,$2::jsonb)
        WHERE outbox_id=$1 AND channel='email' RETURNING delivery_payload`, [payload.outboxId, JSON.stringify({
        version: 1, userId: recipient.userId, profileId: recipient.profileId, destination: recipient.email,
        subject: subject.output, html: body.output, providerId: providers.rows[0]!.id,
        templateId: template.id, templateVersion: template.version, idempotencyKey: payload.idempotencyKey,
      })])
      snapshot = saved.rows[0]?.delivery_payload
    }
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Email snapshot unavailable')
    const saved = snapshot as Record<string, unknown>
    if (saved.version !== 1 || saved.userId !== recipient.userId || saved.profileId !== recipient.profileId ||
        saved.destination !== recipient.email || saved.idempotencyKey !== payload.idempotencyKey ||
        typeof saved.subject !== 'string' || typeof saved.html !== 'string' || typeof saved.providerId !== 'string') {
      throw new Error('Email recipient or identity changed; delivery requires reconciliation')
    }
    const providerRef = await createEmailSender(this.pool, this.request)({ destination: recipient.email, subject: saved.subject,
      html: saved.html, idempotencyKey: payload.idempotencyKey, expectedProviderId: saved.providerId,
      ...(payload.signal ? { signal: payload.signal } : {}) })
    return { status: 'delivered', providerRef }
  }
}
