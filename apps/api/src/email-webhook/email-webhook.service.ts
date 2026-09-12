import {
  Injectable,
  Logger,
  Inject,
  Optional,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { getDbPool } from '@barghsa/db';
import type { ProviderPool, PoolClient } from '../provider-config/provider-config.di';
import { ProviderSecretsService } from '../provider-config/provider-secrets.service';
import { verifySvixSignature } from './svix-verifier';
import { EVENT_STATUS } from './email-webhook.types';
import type {
  ResendWebhookEvent,
  ResendWebhookHeaders,
  DispatchOutcome,
} from './email-webhook.types';

/**
 * Injection token for an optional query-pool override (testability), mirroring
 * the provider-config services. Not registered in the module, so Nest resolves
 * it to `undefined` (via `@Optional()`) and the production pool is used.
 */
export const EMAIL_WEBHOOK_POOL = Symbol('EMAIL_WEBHOOK_POOL');

// Validate only the fields consumed here. Keep the original signed event in
// the ledger, including provider fields this receiver does not interpret.
const eventSchema = z.object({
  type: z.enum(
    Object.keys(EVENT_STATUS) as [keyof typeof EVENT_STATUS, ...Array<keyof typeof EVENT_STATUS>]
  ),
  data: z.object({
    email_id: z.string().min(1),
    from: z.string().optional(),
    to: z.array(z.email()).min(1),
    bounce: z
      .object({ type: z.string(), subType: z.string().optional(), message: z.string().optional() })
      .optional(),
  }),
});

/** Row shape of an outbox row we resolve from a provider message id. */
interface OutboxRow {
  id: string;
  profileId: string | null;
}

/**
 * Resend email delivery callback receiver (E-05, T-05.06.07).
 *
 * Receives `email.delivered` / `email.bounced` / `email.complained` /
 * `email.opened` / `email.clicked` webhook events from Resend, verifies the
 * Svix HMAC-SHA256 signature over the raw body, records each event
 * idempotently, and suppresses hard-bounced or complained-about recipients.
 * Provider feedback remains separate from physical send attempts and worker
 * scheduling. The admin history resolves feedback using the accepted receipt's
 * provider, transport, message and attempt identity, including early callbacks.
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
  private readonly logger = new Logger(EmailWebhookService.name);
  private readonly secrets: ProviderSecretsService;

  constructor(
    @Optional()
    @Inject(EMAIL_WEBHOOK_POOL)
    private readonly injectedPool?: ProviderPool,
    @Optional()
    secretsService?: ProviderSecretsService
  ) {
    this.secrets = secretsService ?? new ProviderSecretsService();
  }

  private get db(): ProviderPool {
    return this.injectedPool ?? (getDbPool() as unknown as ProviderPool);
  }

  /**
   * Verify and apply a Resend webhook payload.
   *
   * @returns a structured acknowledgement; `processed: false` on a replay/duplicate.
   * @throws HttpException on an invalid signature, unconfigured provider, bad
   *   payload, or a processing failure (→ the controller maps to HTTP status).
   */
  async handle(headers: ResendWebhookHeaders, rawBody: string): Promise<DispatchOutcome> {
    const providerIds = await this.verifyProviders(headers, rawBody);

    // Parse the verified payload.
    let event: ResendWebhookEvent;
    try {
      event = JSON.parse(rawBody) as ResendWebhookEvent;
    } catch {
      throw badPayload();
    }
    if (!eventSchema.safeParse(event).success) {
      throw badPayload();
    }

    // Record and apply atomically. Domain errors propagate unchanged; only
    //    unexpected failures become 500s.
    try {
      return await this.processEvent(event, headers, providerIds);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error('Resend webhook processing failed');
      throw new HttpException(
        { statusCode: 500, error: 'webhook_process_failed', message: 'Failed to process webhook' },
        500
      );
    }
  }

  /* --------------------------- config -------------------------------- */

  private async verifyProviders(headers: ResendWebhookHeaders, rawBody: string): Promise<string[]> {
    // Superseded versions still receive callbacks for messages accepted before
    // replacement. Disabled versions are explicitly revoked. Never decrypt the
    // API send credential at this boundary.
    const result = await this.db.query(
      `SELECT id, config->>'webhook_secret' AS secret FROM email_provider_configs
       WHERE transport='resend' AND status IN ('active','superseded')`
    );
    const verified: string[] = [];
    let configured = false;
    for (const row of result.rows as Array<{ id: string; secret: unknown }>) {
      if (typeof row.secret !== 'string' || !row.secret) continue;
      let secret: string;
      try {
        secret = this.secrets.decryptValue(row.secret);
      } catch {
        continue;
      }
      configured = true;
      if (verifySvixSignature(rawBody, headers, secret).ok) verified.push(row.id);
    }
    if (!configured)
      throw new HttpException(
        {
          statusCode: 503,
          error: 'webhook_unconfigured',
          message: 'Resend webhook secret is not configured',
        },
        503
      );
    if (!verified.length)
      throw new HttpException(
        { statusCode: 401, error: 'invalid_signature', message: 'Invalid webhook signature' },
        401
      );
    return verified;
  }

  /* ---------------------- idempotent processing ---------------------- */

  /**
   * Insert the event ledger row and apply side effects in one transaction.
   * Returns `processed: false` (no-op) when the `svix-id` was already seen.
   */
  private async processEvent(
    event: ResendWebhookEvent,
    headers: ResendWebhookHeaders,
    providerIds: string[]
  ): Promise<DispatchOutcome> {
    const token = headers.id;
    if (!token) throw badPayload();

    const eventId = uuidv7();
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const insert = await client.query(
        `INSERT INTO email_webhook_events
           (id, event_token, event_type, message_id, to_address, from_address,
            outbox_id, status, raw, verified_provider_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (event_token) DO NOTHING`,
        [
          eventId,
          token,
          event.type,
          event.data.email_id ?? null,
          event.data.to.join(', '),
          event.data.from ?? null,
          null,
          EVENT_STATUS[event.type] ?? null,
          event,
          providerIds,
        ]
      );
      if ((insert.rowCount ?? 0) === 0) {
        // Duplicate / replay already processed — acknowledge without effects.
        await client.query('COMMIT');
        return { processed: false };
      }

      const outbox = event.data.email_id
        ? await this.lookupOutbox(client, event.data.email_id, providerIds)
        : null;
      if (outbox) {
        // Back-fill the ledger with the resolved outbox for attribution.
        await client.query(`UPDATE email_webhook_events SET outbox_id = $1 WHERE id = $2`, [
          outbox.id,
          eventId,
        ]);
      }

      switch (event.type) {
        case 'email.bounced':
          await this.applyBounce(client, outbox, event, eventId);
          break;
        case 'email.complained':
          await this.applyComplaint(client, outbox, event, eventId);
          break;
        default:
          // Delivery and engagement feedback is recorded without changing worker state.
          this.logger.debug(`Resend ${event.type} event recorded (no state change)`);
      }

      await client.query('COMMIT');
      return { processed: true, eventId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async lookupOutbox(
    client: PoolClient,
    messageId: string,
    providerIds: string[]
  ): Promise<OutboxRow | null> {
    const result = await client.query(
      `SELECT o.id, o.profile_id AS "profileId"
       FROM notification_send_receipts r JOIN notification_outbox o ON o.id=r.outbox_id
       WHERE r.provider_ref=$1 AND r.provider_id=ANY($2::uuid[])
         AND r.channel='email' AND r.transport='resend' AND r.status='accepted'
       LIMIT 2`,
      [messageId, providerIds]
    );
    // Ambiguous historical references must not arbitrarily select a profile.
    return result.rows.length === 1 ? (result.rows[0] as unknown as OutboxRow) : null;
  }

  private async applyBounce(
    client: PoolClient,
    outbox: OutboxRow | null,
    event: ResendWebhookEvent,
    eventId: string
  ): Promise<void> {
    const hard = event.data.bounce?.type === 'Permanent';
    // Only hard bounces suppress. Provider delivery delays do not authorize a new send.
    if (hard) {
      for (const to of normalizedAddresses(event)) {
        await this.suppress(client, to, 'hard_bounce', outbox?.profileId ?? null, eventId);
      }
    }
  }

  private async applyComplaint(
    client: PoolClient,
    outbox: OutboxRow | null,
    event: ResendWebhookEvent,
    eventId: string
  ): Promise<void> {
    for (const to of normalizedAddresses(event)) {
      await this.suppress(client, to, 'complaint', outbox?.profileId ?? null, eventId);
    }
  }

  /** Insert a suppression row; deduplicated by (address, reason). */
  private async suppress(
    client: PoolClient,
    address: string,
    reason: 'hard_bounce' | 'complaint',
    profileId: string | null,
    sourceEventId: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO email_suppressions (id, address, reason, profile_id, source_event_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (address, reason) DO NOTHING`,
      [uuidv7(), address, reason, profileId, sourceEventId]
    );
  }
}

function normalizedAddresses(event: ResendWebhookEvent): string[] {
  return [...new Set(event.data.to.map((address) => address.toLowerCase()))];
}

/** Standard 400 for a malformed / missing-payload webhook request. */
function badPayload(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'invalid_payload',
    message: 'Invalid or missing webhook event payload',
  });
}
