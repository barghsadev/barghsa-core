import { Injectable, Logger } from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { classifyNotificationType } from '@barghsa/shared/notifications'
import {
  FINANCE_CHARGEBACK_ALERT_CHANNELS,
  FINANCE_CHARGEBACK_ALERT_EVENT_KEY,
  FINANCE_CHARGEBACK_ALERT_ROLE_ID,
  FINANCE_CHARGEBACK_WARNING_LIMIT,
  buildFinanceChargebackAlertPayload,
  emptyUnresolvedChargebackWarning,
  financeChargebackAlertIdempotencyKey,
  isUnresolvedChargebackStatus,
  needsFinanceChargebackAlert,
  summarizeUnresolvedChargebackCounts,
  type FinanceChargebackAlertInput,
  type FinanceChargebackAlertPayload,
  type UnresolvedChargebackWarning,
  type UnresolvedChargebackWarningItem,
  type WalletChargebackUnresolvedStatus,
} from '@barghsa/shared/finance'

const DEFAULT_MAX_ATTEMPTS = 5

export const FIND_FINANCE_ALERT_RECIPIENTS_SQL = `SELECT DISTINCT p.id AS profile_id, p.user_id
   FROM profiles p
   JOIN users u ON u.user_id = p.user_id
  WHERE p.is_default = TRUE
    AND (
      u.is_admin = TRUE
      OR EXISTS (
        SELECT 1
          FROM user_roles ur
         WHERE ur.user_id = u.user_id
           AND ur.role_id = $1
      )
    )`

export const COUNT_UNRESOLVED_CHARGEBACKS_SQL = `SELECT status, COUNT(*)::int AS n
   FROM wallet_chargeback_events
  WHERE status IN ('unmatched', 'unresolved')
  GROUP BY status`

export const LIST_UNRESOLVED_CHARGEBACKS_SQL = `SELECT event_id, status, wallet_id, original_transaction_id,
        raw, created_at
   FROM wallet_chargeback_events
  WHERE status IN ('unmatched', 'unresolved')
  ORDER BY created_at DESC
  LIMIT $1`

export interface FinanceAlertRecipient {
  profileId: string
  userId: string
}

export interface NotifyUnresolvedResult {
  recipients: number
  inserted: number
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

/**
 * Finance chargeback alerts (T-04.2.04.03).
 *
 * Detection writes an immediate outbox row to every Finance-role staff
 * member (and platform admins) when a chargeback stays unmatched or the
 * compensating reversal cannot post. The dashboard warning reads the
 * same unresolved set so staff cannot miss an open exception.
 */
@Injectable()
export class ChargebackAlertService {
  private readonly logger = new Logger(ChargebackAlertService.name)

  async notifyUnresolved(
    client: QueryClient,
    input: FinanceChargebackAlertInput,
  ): Promise<NotifyUnresolvedResult> {
    if (!needsFinanceChargebackAlert(input.status)) {
      return { recipients: 0, inserted: 0 }
    }

    const recipients = await this.loadFinanceRecipients(client)
    if (recipients.length === 0) {
      this.logger.warn(
        `Chargeback ${input.eventId} is ${input.status} but no finance recipient has a default profile`,
      )
      return { recipients: 0, inserted: 0 }
    }

    const payload = buildFinanceChargebackAlertPayload({
      ...input,
      status: input.status,
    })
    let inserted = 0
    for (const recipient of recipients) {
      const result = await enqueueFinanceChargebackAlert(client, {
        profileId: recipient.profileId,
        userId: recipient.userId,
        eventId: input.eventId,
        payload,
      })
      if (result.inserted) inserted += 1
    }
    this.logger.log(
      `Chargeback ${input.eventId} (${input.status}) alerted ${inserted}/${recipients.length} finance recipient(s)`,
    )
    return { recipients: recipients.length, inserted }
  }

  async getDashboardWarning(): Promise<UnresolvedChargebackWarning> {
    const pool = getDbPool()
    const [counts, list] = await Promise.all([
      pool.query(COUNT_UNRESOLVED_CHARGEBACKS_SQL),
      pool.query(LIST_UNRESOLVED_CHARGEBACKS_SQL, [FINANCE_CHARGEBACK_WARNING_LIMIT]),
    ])
    const summary = summarizeUnresolvedChargebackCounts(
      (counts.rows as Array<{ status: string; n: string | number }>).map((row) => ({
        status: row.status,
        n: Number(row.n),
      })),
    )
    if (summary.count === 0) return emptyUnresolvedChargebackWarning()
    return {
      ...summary,
      items: (list.rows as Parameters<typeof mapWarningItem>[0][]).map(mapWarningItem),
    }
  }

  private async loadFinanceRecipients(
    client: QueryClient,
  ): Promise<FinanceAlertRecipient[]> {
    const result = await client.query(FIND_FINANCE_ALERT_RECIPIENTS_SQL, [
      FINANCE_CHARGEBACK_ALERT_ROLE_ID,
    ])
    return (result.rows as Array<{ profile_id: string; user_id: string }>).map((row) => ({
      profileId: row.profile_id,
      userId: row.user_id,
    }))
  }
}

export async function enqueueFinanceChargebackAlert(
  client: QueryClient,
  input: {
    profileId: string
    userId: string
    eventId: string
    payload: FinanceChargebackAlertPayload | Record<string, unknown>
  },
): Promise<{ outboxId: string | null; inserted: boolean }> {
  const channels = [...FINANCE_CHARGEBACK_ALERT_CHANNELS]
  const idempotencyKey = financeChargebackAlertIdempotencyKey(
    input.eventId,
    input.profileId,
  )
  const priority =
    classifyNotificationType(FINANCE_CHARGEBACK_ALERT_EVENT_KEY) === 'immediate'
      ? 'urgent'
      : 'normal'

  const insertResult = await client.query(
    `INSERT INTO notification_outbox
       (profile_id, user_id, event_key, payload, channels, status,
        idempotency_key, max_attempts, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.profileId,
      input.userId,
      FINANCE_CHARGEBACK_ALERT_EVENT_KEY,
      input.payload,
      channels,
      'queued',
      idempotencyKey,
      DEFAULT_MAX_ATTEMPTS,
      null,
    ],
  )
  const row = insertResult.rows[0] as { id: string } | undefined
  if (!row) return { outboxId: null, inserted: false }

  const jobValues: unknown[] = []
  const placeholders: string[] = []
  channels.forEach((channel, i) => {
    const base = i * 5
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`)
    jobValues.push(row.id, channel, 'queued', priority, DEFAULT_MAX_ATTEMPTS)
  })
  await client.query(
    `INSERT INTO notification_job
       (outbox_id, channel, status, priority, max_attempts)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (outbox_id, channel) DO NOTHING`,
    jobValues,
  )
  return { outboxId: row.id, inserted: true }
}

function mapWarningItem(row: {
  event_id: string
  status: string
  wallet_id: string | null
  original_transaction_id: string | null
  raw: unknown
  created_at: Date | string
}): UnresolvedChargebackWarningItem {
  const status = isUnresolvedChargebackStatus(row.status)
    ? row.status
    : ('unmatched' as WalletChargebackUnresolvedStatus)
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  return {
    eventId: row.event_id,
    status,
    amountIrR: amountFromRaw(row.raw),
    walletId: row.wallet_id,
    originalTransactionId: row.original_transaction_id,
    reason: reasonFromRaw(row.raw),
    createdAt,
  }
}

function amountFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const amount = (raw as { amountIrR?: unknown }).amountIrR
  if (typeof amount === 'string' && amount.length > 0) return amount
  if (typeof amount === 'number' && Number.isFinite(amount)) return String(amount)
  return null
}

function reasonFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const reason = (raw as { reason?: unknown }).reason
  return typeof reason === 'string' && reason.length > 0 ? reason : null
}
