import { WalletProfileArchivedError } from './profile-lock.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { observePaymentCallbackAnomaly } from '../metrics/payment-callback-metrics.js';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  WALLET_CHARGEBACK_EVENT_CONSTRAINT,
  WALLET_REVERSAL_ERRORS,
  WALLET_REVERSAL_POSTED_STATE,
  WALLET_REVERSAL_TYPE,
  chargebackCreditIdempotencyKey,
  chargebackReversalIdempotencyKey,
  matchChargebackToTopUp,
  parseChargebackNotification,
  parseChargebackNotificationJson,
  reversalAmount,
  type ChargebackMatchMethod,
  type ChargebackTopUpCandidate,
  type ChargebackTopUpMatch,
  type ParsedChargebackNotification,
  needsFinanceChargebackAlert,
  type WalletChargebackEventStatus,
} from '@barghsa/shared/finance';
import { WalletService, type TransactionRow } from './wallet.service.js';
import { ChargebackAlertService } from './chargeback-alert.service.js';
import {
  resolvePaymentGatewayMerchantId,
  resolvePaymentGatewayWebhookSecret,
} from './payment-gateway.js';
import {
  verifyPaymentCallbackSignature,
  type PaymentCallbackHeaders,
} from './payment-callback-verifier.js';
import {
  PAYMENT_CALLBACK_CONFIG,
  type PaymentCallbackConfig,
} from './online-topup-callback.service.js';

const PG_UNIQUE_VIOLATION = '23505';

export interface HandleChargebackInput {
  headers: PaymentCallbackHeaders;
  rawBody: string;
}

export interface HandleChargebackResult {
  ok: true;
  processed: boolean;
  mapped: boolean;
  reversed: boolean;
  originalTransactionId: string | null;
  reversalTransactionId: string | null;
  matchMethod: ChargebackMatchMethod | null;
  status: WalletChargebackEventStatus;
}

type ChargebackResult = HandleChargebackResult & { walletId: string | null };
type ChargebackReversal = Pick<
  TransactionRow,
  'id' | 'walletId' | 'type' | 'amount' | 'state' | 'reversesTransactionId'
>;

class ChargebackReversalEvidenceError extends Error {}

interface ChargebackEventRow {
  eventId: string;
  originalTransactionId: string | null;
  reversalTransactionId: string | null;
  walletId: string | null;
  status: WalletChargebackEventStatus;
  matchMethod: ChargebackMatchMethod | null;
  raw: unknown;
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

/**
 * Provider chargeback detection (T-04.2.04.02).
 *
 * HMAC-authenticates the inbound notification with the same signed
 * content as online top-up callbacks, parses the body, and maps it to
 * the original Completed top-up credit. A unique match drives
 * `WalletService.reverseTransaction`; an untraceable notification is
 * recorded as an unmatched exception without rewriting wallet history.
 * Unmatched / reversal-failed outcomes enqueue an immediate finance
 * alert (T-04.2.04.03) so staff are pushed a warning and the dashboard
 * can surface the open exception.
 */
@Injectable()
export class ChargebackDetectionService {
  private readonly logger = new Logger(ChargebackDetectionService.name);

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    @Inject(PAYMENT_CALLBACK_CONFIG)
    private readonly injectedConfig?: PaymentCallbackConfig,
    @Optional()
    private readonly alertService?: ChargebackAlertService
  ) {}

  async handle(input: HandleChargebackInput): Promise<HandleChargebackResult> {
    const config = this.resolveConfig();
    if (!config.webhookSecret) {
      this.logger.warn('Payment chargeback received but PAYMENT_GATEWAY_WEBHOOK_SECRET is not set');
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_UNCONFIGURED,
        'Payment provider callback signing secret is not configured'
      );
    }

    const verification = verifyPaymentCallbackSignature(
      input.rawBody,
      input.headers,
      config.webhookSecret
    );
    if (!verification.ok) {
      if (verification.reason === 'replayed') {
        observePaymentCallbackAnomaly('chargeback', 'stale_timestamp');
        this.logger.warn('Rejected replayed or expired payment chargeback signature');
        httpError(
          ErrorCodes.PROVIDER_CALLBACK_REPLAYED,
          'Payment provider callback is expired or replayed'
        );
      }
      observePaymentCallbackAnomaly('chargeback', 'invalid_signature');
      this.logger.warn(`Rejected payment chargeback signature (${verification.reason})`);
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Invalid payment provider callback signature'
      );
    }

    const eventId = input.headers.eventId!.trim();
    if (!eventId) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback event id is required');
    }

    const parsed = parseChargebackNotificationJson(input.rawBody);
    if (!parsed.ok) {
      if (parsed.reason === 'invalid_json') {
        httpError(ErrorCodes.VALIDATION_PARSE_JSON, 'Payment chargeback body must be JSON');
      }
      if (parsed.reason === 'invalid_amount') {
        httpError(
          ErrorCodes.VALIDATION_INPUT_INVALID,
          'Payment chargeback amount must be a positive integer IRR value'
        );
      }
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Payment chargeback body must include type, merchantId, amountIrR, and a chargeback locator'
      );
    }

    if (parsed.notification.merchantId !== config.merchantId) {
      this.logger.warn('Payment chargeback merchant id did not match configured merchant context');
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Payment callback merchant context is invalid'
      );
    }

    const payloadSha256 = createHash('sha256').update(input.rawBody).digest('hex');
    const { walletId, ...result } = await this.processVerifiedNotification(
      eventId,
      parsed.notification,
      payloadSha256
    );
    if (this.alertService && needsFinanceChargebackAlert(result.status)) {
      const client = await getDbPool().connect();
      try {
        await this.alertService.notifyChargeback(client, {
          eventId,
          status: result.status,
          notification: parsed.notification,
          walletId,
          originalTransactionId: result.originalTransactionId,
        });
      } finally {
        client.release();
      }
    }
    return result;
  }

  private async processVerifiedNotification(
    eventId: string,
    notification: ParsedChargebackNotification,
    payloadSha256: string
  ): Promise<ChargebackResult> {
    const pool = getDbPool({ session: true });
    const client = await pool.connect();
    const lockKeys = chargebackEventLockKeys(eventId);
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys);
      try {
        const claim = await this.claimEvent(client, eventId, notification, payloadSha256);
        if (!claim.inserted) {
          const existing = claim.existing;
          if (!existing) {
            httpError(
              ErrorCodes.PROVIDER_CALLBACK_INVALID,
              'Payment chargeback event id could not be claimed'
            );
          }
          assertClaimedNotificationMatches(existing.raw, notification);
          if (existing.status !== 'processing') {
            observePaymentCallbackAnomaly('chargeback', 'event_replay');
            return await this.readTerminalResult(client, existing, notification);
          }
        }

        const candidates = await this.loadCandidates(client, notification);
        const match = matchChargebackToTopUp(
          notification,
          candidates.filter((row) => row.amount > 0n)
        );
        if (!match) {
          await this.finalizeEvent(client, eventId, {
            status: 'unmatched',
            originalTransactionId: null,
            reversalTransactionId: null,
            walletId: null,
            matchMethod: null,
          });
          this.logger.warn(
            `Chargeback could not be mapped to an original top-up correlationId=${correlationIdStorage.getStore() ?? 'none'}`
          );
          return chargebackResult('unmatched', true, null);
        }

        const existingReversal = await this.findExistingReversal(client, match.original.id);
        if (existingReversal)
          return await this.finishMatchedEvent(client, eventId, match, existingReversal);

        try {
          // Reverse on the advisory-lock client so this handler never
          // checks out a second pooled connection while the lock is held.
          return await withLockClientTransaction(client, async () => {
            const posted = await this.walletService.reverseTransaction(
              match.original.id,
              notification.reason,
              chargebackReversalIdempotencyKey(eventId),
              client
            );
            if (!matchesReversal(posted, match.original))
              throw new ChargebackReversalEvidenceError();
            return this.finishMatchedEvent(client, eventId, match, posted);
          });
        } catch (error) {
          if (isAlreadyReversedError(error, match.original.id)) {
            const raced = await this.findExistingReversal(client, match.original.id);
            if (raced) return await this.finishMatchedEvent(client, eventId, match, raced);
          }
          if (
            isInsufficientReversalError(error) ||
            error instanceof WalletProfileArchivedError ||
            error instanceof ChargebackReversalEvidenceError
          )
            return await this.finishMatchedEvent(client, eventId, match, null);
          throw error;
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys);
      }
    } finally {
      client.release();
    }
  }

  private async finishMatchedEvent(
    client: QueryClient,
    eventId: string,
    match: ChargebackTopUpMatch,
    reversal: ChargebackReversal | null
  ): Promise<ChargebackResult> {
    const reversalId = reversal && matchesReversal(reversal, match.original) ? reversal.id : null;
    const status = reversalId ? 'reversed' : 'unresolved';
    const result = chargebackResult(status, true, match, reversalId);
    await this.finalizeEvent(client, eventId, { ...result, status });
    if (!reversalId)
      this.logger.warn(
        `Chargeback reversal requires reconciliation correlationId=${correlationIdStorage.getStore() ?? 'none'}`
      );
    return result;
  }

  private async readTerminalResult(
    client: QueryClient,
    existing: ChargebackEventRow,
    notification: ParsedChargebackNotification
  ): Promise<ChargebackResult> {
    const { status, originalTransactionId, reversalTransactionId, walletId, matchMethod } =
      existing;
    if (
      !originalTransactionId &&
      !reversalTransactionId &&
      !walletId &&
      !matchMethod &&
      (status === 'unmatched' || status === 'duplicate')
    )
      return chargebackResult(status, false, null);
    if (!originalTransactionId || !walletId || status === 'unmatched')
      return chargebackResult('unresolved', false, null);

    const row = (
      await client.query(
        `SELECT * FROM wallet_transactions WHERE id=$1 AND wallet_id=$2 AND amount>0`,
        [originalTransactionId, walletId]
      )
    ).rows[0] as Parameters<typeof mapCandidate>[0] | undefined;
    const match = row && matchChargebackToTopUp(notification, [mapCandidate(row)]);
    if (!match || (matchMethod && match.method !== matchMethod))
      return chargebackResult('unresolved', false, null);

    if (!reversalTransactionId && (status === 'unresolved' || status === 'duplicate'))
      return chargebackResult(status, false, match);
    if (reversalTransactionId && (status === 'reversed' || status === 'duplicate')) {
      const reversal = await this.findExistingReversal(client, match.original.id);
      if (reversal?.id === reversalTransactionId && matchesReversal(reversal, match.original))
        return chargebackResult(status, false, match, reversal.id);
    }
    return chargebackResult('unresolved', false, match);
  }

  private resolveConfig(): PaymentCallbackConfig {
    if (this.injectedConfig) return this.injectedConfig;
    return {
      webhookSecret: resolvePaymentGatewayWebhookSecret(),
      merchantId: resolvePaymentGatewayMerchantId(),
    };
  }

  private async claimEvent(
    client: QueryClient,
    eventId: string,
    notification: ParsedChargebackNotification,
    payloadSha256: string
  ): Promise<{ inserted: boolean; existing: ChargebackEventRow | null }> {
    try {
      const inserted = await client.query(
        `INSERT INTO wallet_chargeback_events (event_id, status, raw, payload_sha256)
         VALUES ($1, 'processing', $2::jsonb, $3)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id, original_transaction_id, reversal_transaction_id,
                   wallet_id, status, match_method, raw`,
        [eventId, JSON.stringify(chargebackEventRaw(notification)), payloadSha256]
      );
      if (inserted.rows.length > 0) {
        return {
          inserted: true,
          existing: mapEvent(inserted.rows[0] as Parameters<typeof mapEvent>[0]),
        };
      }
    } catch (error) {
      if (!isPgUniqueViolation(error, WALLET_CHARGEBACK_EVENT_CONSTRAINT)) throw error;
    }

    const existing = await this.loadEvent(client, eventId);
    return { inserted: false, existing };
  }

  private async loadEvent(
    client: QueryClient,
    eventId: string
  ): Promise<ChargebackEventRow | null> {
    const result = await client.query(
      `SELECT event_id, original_transaction_id, reversal_transaction_id,
              wallet_id, status, match_method, raw
         FROM wallet_chargeback_events
        WHERE event_id = $1`,
      [eventId]
    );
    if (result.rows.length === 0) return null;
    return mapEvent(result.rows[0] as Parameters<typeof mapEvent>[0]);
  }

  private async loadCandidates(
    client: QueryClient,
    notification: ParsedChargebackNotification
  ): Promise<ChargebackTopUpCandidate[]> {
    if (notification.merchantOrderId) {
      const result = await client.query(
        `SELECT * FROM wallet_transactions
          WHERE type = 'topup'
            AND state = 'Completed'
            AND (
              idempotency_key = $1
              OR metadata->>'pendingTransactionId' = $2
            )`,
        [chargebackCreditIdempotencyKey(notification.merchantOrderId), notification.merchantOrderId]
      );
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]));
    }

    if (notification.providerRefId) {
      const result = await client.query(
        `SELECT * FROM wallet_transactions
          WHERE type = 'topup'
            AND state = 'Completed'
            AND ref_id = $1`,
        [notification.providerRefId]
      );
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]));
    }

    if (notification.authority) {
      const result = await client.query(
        `SELECT * FROM wallet_transactions
          WHERE type = 'topup'
            AND state = 'Completed'
            AND (
              ref_id = $1
              OR metadata->>'authority' = $1
              OR metadata->'gateway'->>'authority' = $1
            )`,
        [notification.authority]
      );
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]));
    }

    return [];
  }

  private async findExistingReversal(
    client: QueryClient,
    originalTransactionId: string
  ): Promise<ChargebackReversal | null> {
    const result = await client.query(
      `SELECT id,wallet_id,type,state,amount,reverses_transaction_id
       FROM wallet_transactions WHERE reverses_transaction_id = $1`,
      [originalTransactionId]
    );
    if (result.rows.length === 0) return null;
    return mapReversal(result.rows[0] as Parameters<typeof mapReversal>[0]);
  }

  private async finalizeEvent(
    client: QueryClient,
    eventId: string,
    input: {
      status: Exclude<WalletChargebackEventStatus, 'processing'>;
      originalTransactionId: string | null;
      reversalTransactionId: string | null;
      walletId: string | null;
      matchMethod: ChargebackMatchMethod | null;
    }
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_chargeback_events
          SET status = $2,
              original_transaction_id = $3,
              reversal_transaction_id = $4,
              wallet_id = $5,
              match_method = $6
        WHERE event_id = $1
          AND status = 'processing'`,
      [
        eventId,
        input.status,
        input.originalTransactionId,
        input.reversalTransactionId,
        input.walletId,
        input.matchMethod,
      ]
    );
  }
}

/**
 * Run `fn` in a transaction on the session that already holds the
 * chargeback advisory lock. `WalletService.reverseTransaction` must use
 * this same client so the handler never waits on a nested pool checkout.
 */
async function withLockClientTransaction<T>(client: QueryClient, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original reversal/mapping error.
    }
    throw error;
  }
}

function chargebackEventRaw(notification: ParsedChargebackNotification): Record<string, unknown> {
  return {
    type: notification.type,
    merchantId: notification.merchantId,
    merchantOrderId: notification.merchantOrderId,
    providerRefId: notification.providerRefId,
    authority: notification.authority,
    amountIrR: notification.amountIrR.toString(),
    reason: notification.reason,
  };
}

function chargebackPayloadDigest(notification: ParsedChargebackNotification): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(chargebackEventRaw(notification)))
    .digest();
}

function assertClaimedNotificationMatches(
  storedRaw: unknown,
  notification: ParsedChargebackNotification
): void {
  const claimed = parseChargebackNotification(storedRaw);
  const digestMatches =
    claimed.ok &&
    timingSafeEqual(
      chargebackPayloadDigest(claimed.notification),
      chargebackPayloadDigest(notification)
    );
  if (!digestMatches) {
    observePaymentCallbackAnomaly('chargeback', 'event_replay');
    httpError(
      ErrorCodes.PROVIDER_CALLBACK_INVALID,
      'Payment chargeback event payload does not match the claimed notification'
    );
  }
}

export function chargebackEventLockKeys(eventId: string): [number, number] {
  const digest = createHash('sha256').update(`wallet-chargeback:${eventId}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function matchesReversal(
  reversal: ChargebackReversal,
  original: ChargebackTopUpCandidate
): boolean {
  return (
    reversal.walletId === original.walletId &&
    reversal.type === WALLET_REVERSAL_TYPE &&
    reversal.state === WALLET_REVERSAL_POSTED_STATE &&
    reversal.reversesTransactionId === original.id &&
    reversal.amount === reversalAmount(original.amount)
  );
}

function chargebackResult(
  status: Exclude<WalletChargebackEventStatus, 'processing'>,
  processed: boolean,
  match: ChargebackTopUpMatch | null,
  reversalTransactionId: string | null = null
): ChargebackResult {
  return {
    ok: true,
    processed,
    mapped: match !== null,
    reversed: status === 'reversed',
    originalTransactionId: match?.original.id ?? null,
    reversalTransactionId,
    walletId: match?.original.walletId ?? null,
    matchMethod: match?.method ?? null,
    status,
  };
}

function mapEvent(row: {
  event_id: string;
  original_transaction_id: string | null;
  reversal_transaction_id: string | null;
  wallet_id: string | null;
  status: string;
  match_method: string | null;
  raw?: unknown;
}): ChargebackEventRow {
  return {
    eventId: row.event_id,
    originalTransactionId: row.original_transaction_id,
    reversalTransactionId: row.reversal_transaction_id,
    walletId: row.wallet_id,
    status: row.status as WalletChargebackEventStatus,
    matchMethod: row.match_method as ChargebackMatchMethod | null,
    raw: row.raw ?? null,
  };
}

function mapCandidate(row: {
  id: string;
  wallet_id: string;
  type: string;
  amount: string | number | bigint;
  state: string;
  idempotency_key: string;
  ref_id?: string | null;
  metadata?: unknown;
}): ChargebackTopUpCandidate {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    refId: row.ref_id ?? null,
    metadata: row.metadata ?? null,
  };
}

function mapReversal(row: {
  id: string;
  wallet_id: string;
  type: string;
  amount: string | number | bigint;
  state: string;
  reverses_transaction_id: string;
}): ChargebackReversal {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    reversesTransactionId: row.reverses_transaction_id,
  };
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || pgError.constraint === constraint;
}

function nestMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
  }
  if (error instanceof Error) return error.message;
  return '';
}

function isAlreadyReversedError(error: unknown, originalId: string): boolean {
  if (!(error instanceof ConflictException)) return false;
  return nestMessage(error) === WALLET_REVERSAL_ERRORS.ALREADY_REVERSED(originalId);
}

function isInsufficientReversalError(error: unknown): boolean {
  if (!(error instanceof BadRequestException)) return false;
  return nestMessage(error).startsWith('Insufficient balance');
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode);
}
