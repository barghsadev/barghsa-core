import {
  Injectable,
  Logger,
  Inject,
  Optional,
  HttpException,
  BadRequestException,
} from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { getDbPool } from '@barghsa/db'
import type { ProviderPool, PoolClient } from '../provider-config/provider-config.di'
import { ProviderSecretsService } from '../provider-config/provider-secrets.service'
import { parseResendConfig } from '../provider-config/resend-config.schema'
import { verifySvixSignature } from './svix-verifier'
import { EVENT_STATUS } from './email-webhook.types'
import type {
  ResendWebhookEvent,
  ResendWebhookHeaders,
  DispatchOutcome,
} from './email-webhook.types'

/**
 * Injection token for an optional query-pool override (testability), mirroring
 * the provider-config services. Not registered in the module, so Nest resolves
 * it to `undefined` (via `@Optional()`) and the production pool is used.
 */
export const EMAIL_WEBHOOK_POOL = Symbol('EMAIL_WEBHOOK_POOL')

/** Row shape of an outbox row we resolve from a provider message id. */
interface OutboxRow {
  id: string
  profileId: string | null
}

/**
 * Resend email delivery callback receiver (E-05, T-05.06.07).
 *
 * Receives `email.delivered` / `email.bounced` / `email.complained` /
 * `email.opened` / `email.clicked` webhook events from Resend, verifies the
 * Svix HMAC-SHA256 signature over the raw body, records each event
 * idempotently, and applies delivery feedback to our notification state:
 *
 * - **delivered** — marks the matching `notification_outbox` row (resolved by
 *   its `provider_ref` = the message id) `delivered` when it is not already
 *   terminal, and appends a provider-confirmed row to `notification_delivery_log`.
 * - **hard bounce** — suppresses the recipient (future non-essential email is
 *   skipped) and marks the outbox row `failed`. Soft bounces are transient and
 *   are recorded as such (no suppression — the outbox retry ladder may recover).
 * - **complaint** — suppresses the recipient as a corrective-action record.
 * - **open / click / delayed / sent** — recorded for audit only; no terminal
 *   state change.
 *
 * Replay-safety: the idempotent ledger INSERT (`event_token` = `svix-id`,
 * UNIQUE) and all side effects run inside ONE transaction. A duplicate event
 * inserts nothing and commits a no-op; a processing failure rolls EVERYTHING
 * back, so the provider's retry re-runs the event with full effect. Side
 * effects can never be half-applied or silently skipped.
 *
 * Secrets (webhook signing secret) are decrypted transiently for signature
 * verification and never logged or returned.
 */
@Injectable()
export class EmailWebhookService {
  private readonly logger = new Logger(EmailWebhookService.name)
  private readonly secrets: ProviderSecretsService

  constructor(
    @Optional()
    @Inject(EMAIL_WEBHOOK_POOL)
    private readonly injectedPool?: ProviderPool,
    @Optional()
    secretsService?: ProviderSecretsService,
  ) {
    this.secrets = secretsService ?? new ProviderSecretsService()
  }

  private get db(): ProviderPool {
    return this.injectedPool ?? (getDbPool() as unknown as ProviderPool)
  }

  /**
   * Verify and apply a Resend webhook payload.
   *
   * @returns a structured acknowledgement; `processed: false` on a replay/duplicate.
   * @throws HttpException on an invalid signature, unconfigured provider, bad
   *   payload, or a processing failure (→ the controller maps to HTTP status).
   */
  async handle(
    headers: ResendWebhookHeaders,
    rawBody: string,
  ): Promise<DispatchOutcome> {
    // 1. Load the active Resend config and its webhook signing secret.
    const { config, ok: configOk } = await this.loadActiveResendConfig()
    const secret = typeof config?.webhook_secret === 'string' ? config.webhook_secret : ''
    if (!configOk || !secret) {
      this.logger.warn('Resend webhook received but no active config with a webhook_secret exists')
      throw new HttpException(
        {
          statusCode: 503,
          error: 'webhook_unconfigured',
          message: 'Resend webhook secret is not configured',
        },
        503,
      )
    }

    // 2. Signature verification over the exact raw body (+ replay window).
    const verification = verifySvixSignature(rawBody, headers, secret)
    if (!verification.ok) {
      if (verification.reason === 'replayed') {
        this.logger.warn('Rejected replayed/expired Resend webhook signature')
      }
      throw new HttpException(
        { statusCode: 401, error: 'invalid_signature', message: 'Invalid webhook signature' },
        401,
      )
    }

    // 3. Parse the verified payload.
    let event: ResendWebhookEvent
    try {
      event = JSON.parse(rawBody) as ResendWebhookEvent
    } catch {
      throw badPayload()
    }
    if (!event || typeof event !== 'object' || !event.type) {
      throw badPayload()
    }

    // 4. Record + apply atomically. Domain errors propagate unchanged; only
    //    unexpected failures become 500s.
    try {
      return await this.processEvent(event, headers)
    } catch (err) {
      if (err instanceof HttpException) throw err
      this.logger.error(`Resend webhook processing failed: ${(err as Error).message}`)
      throw new HttpException(
        { statusCode: 500, error: 'webhook_process_failed', message: 'Failed to process webhook' },
        500,
      )
    }
  }

  /* --------------------------- config -------------------------------- */

  private async loadActiveResendConfig(): Promise<{
    ok: boolean
    config: Record<string, unknown> | null
  }> {
    try {
      const result = await this.db.query(
        `SELECT config FROM email_provider_configs
          WHERE transport = 'resend' AND status = 'active'
          ORDER BY created_at DESC LIMIT 1`,
      )
      const row = result.rows[0] as { config?: Record<string, unknown> } | undefined
      if (!row?.config) return { ok: false, config: null }
      // Decrypt secret fields (api_key, webhook_secret) only inside this
      // consumer — the signature boundary.
      const parsed = parseResendConfig(this.secrets.decryptConfig('resend', row.config))
      if (!parsed.ok) return { ok: false, config: null }
      return { ok: true, config: parsed.config as unknown as Record<string, unknown> }
    } catch {
      return { ok: false, config: null }
    }
  }

  /* ---------------------- idempotent processing ---------------------- */

  /**
   * Insert the event ledger row and apply side effects in one transaction.
   * Returns `processed: false` (no-op) when the `svix-id` was already seen.
   */
  private async processEvent(
    event: ResendWebhookEvent,
    headers: ResendWebhookHeaders,
  ): Promise<DispatchOutcome> {
    const token = headers.id
    if (!token) throw badPayload()

    const eventId = uuidv7()
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')

      const insert = await client.query(
        `INSERT INTO email_webhook_events
           (id, event_token, event_type, message_id, to_address, from_address,
            outbox_id, status, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (event_token) DO NOTHING`,
        [
          eventId,
          token,
          event.type,
          event.data.email_id ?? null,
          event.data.to ?? null,
          event.data.from ?? null,
          null,
          EVENT_STATUS[event.type] ?? null,
          event,
        ],
      )
      if ((insert.rowCount ?? 0) === 0) {
        // Duplicate / replay already processed — acknowledge without effects.
        await client.query('COMMIT')
        return { processed: false }
      }

      const outbox = event.data.email_id
        ? await this.lookupOutbox(client, event.data.email_id)
        : null
      if (outbox) {
        // Back-fill the ledger with the resolved outbox for attribution.
        await client.query(`UPDATE email_webhook_events SET outbox_id = $1 WHERE id = $2`, [
          outbox.id,
          eventId,
        ])
      }

      switch (event.type) {
        case 'email.delivered':
          await this.applyDelivered(client, outbox, event)
          break
        case 'email.bounced':
          await this.applyBounce(client, outbox, event, eventId)
          break
        case 'email.complained':
          await this.applyComplaint(client, outbox, event, eventId)
          break
        default:
          // sent / opened / clicked / delivery_delayed — audit only.
          this.logger.debug(`Resend ${event.type} event recorded (no state change)`)
      }

      await client.query('COMMIT')
      return { processed: true, eventId }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  private async lookupOutbox(client: PoolClient, messageId: string): Promise<OutboxRow | null> {
    const result = await client.query(
      `SELECT id, profile_id AS "profileId" FROM notification_outbox WHERE provider_ref = $1 LIMIT 1`,
      [messageId],
    )
    return (result.rows[0] as OutboxRow | undefined) ?? null
  }

  /* ----------------------- side effects ------------------------------ */

  private async applyDelivered(
    client: PoolClient,
    outbox: OutboxRow | null,
    event: ResendWebhookEvent,
  ): Promise<void> {
    if (!outbox) return
    await client.query(
      `UPDATE notification_outbox
          SET status = 'delivered', last_error = NULL, updated_at = NOW()
        WHERE id = $1 AND status = ANY(ARRAY['queued','scheduled','sending'])`,
      [outbox.id],
    )
    await this.appendProviderLog(client, outbox.id, {
      status: 'delivered',
      providerRef: event.data.email_id ?? null,
      message: null,
      errorCategory: null,
    })
  }

  private async applyBounce(
    client: PoolClient,
    outbox: OutboxRow | null,
    event: ResendWebhookEvent,
    eventId: string,
  ): Promise<void> {
    const hard = event.data.category === 'hard_bounce'
    const to = normalizeAddress(event.data.to)
    // Only hard bounces suppress: a soft (temporary) bounce should retry.
    if (to && hard) {
      await this.suppress(client, to, 'hard_bounce', outbox?.profileId ?? null, eventId)
    }

    if (outbox) {
      await client.query(
        `UPDATE notification_outbox
            SET status = 'failed', last_error = $1, updated_at = NOW()
          WHERE id = $2 AND status <> 'failed'`,
        [hard ? 'Provider reported hard bounce' : 'Provider reported bounce', outbox.id],
      )
      await this.appendProviderLog(client, outbox.id, {
        status: 'failed',
        providerRef: event.data.email_id ?? null,
        message: hard ? 'Provider reported hard bounce' : 'Provider reported bounce',
        // Hard = permanent (will not recover); soft = transient (retryable).
        errorCategory: hard ? 'permanent' : 'transient',
      })
    }
  }

  private async applyComplaint(
    client: PoolClient,
    outbox: OutboxRow | null,
    event: ResendWebhookEvent,
    eventId: string,
  ): Promise<void> {
    const to = normalizeAddress(event.data.to)
    if (!to) return
    // A spam complaint is both a suppression (stop emailing the address) and an
    // operational corrective record — captured here; admin tooling reads
    // email_suppressions reason='complaint'.
    await this.suppress(client, to, 'complaint', outbox?.profileId ?? null, eventId)
  }

  /** Insert a suppression row; deduplicated by (address, reason). */
  private async suppress(
    client: PoolClient,
    address: string,
    reason: 'hard_bounce' | 'complaint',
    profileId: string | null,
    sourceEventId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO email_suppressions (id, address, reason, profile_id, source_event_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address, reason) DO NOTHING`,
      [uuidv7(), address, reason, profileId, sourceEventId],
    )
  }

  /** Append a provider-confirmed row to the delivery log (attempt # is next). */
  private async appendProviderLog(
    client: PoolClient,
    notificationId: string,
    input: {
      status: 'delivered' | 'failed'
      providerRef: string | null
      message: string | null
      errorCategory: 'permanent' | 'transient' | 'provider' | null
    },
  ): Promise<void> {
    const maxResult = await client.query(
      `SELECT COALESCE(MAX(attempt_number), 0) AS n FROM notification_delivery_log
        WHERE notification_id = $1`,
      [notificationId],
    )
    const currentMax =
      parseInt(String((maxResult.rows[0] as { n?: unknown } | undefined)?.n ?? '0'), 10) || 0
    const attemptNumber = currentMax + 1
    await client.query(
      `INSERT INTO notification_delivery_log
         (notification_id, channel, status, attempt_number, provider_ref,
          latency_ms, error_category, error_detail)
       VALUES ($1, 'email', $2, $3, $4, NULL, $5, $6)`,
      [
        notificationId,
        input.status,
        attemptNumber,
        input.providerRef ?? null,
        input.errorCategory,
        input.message,
      ],
    )
  }
}

function normalizeAddress(address: string | undefined): string | null {
  if (!address) return null
  return address.trim().toLowerCase()
}

/** Standard 400 for a malformed / missing-payload webhook request. */
function badPayload(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'invalid_payload',
    message: 'Invalid or missing webhook event payload',
  })
}