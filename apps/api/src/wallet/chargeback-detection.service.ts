import { createHash, timingSafeEqual } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  WALLET_CHARGEBACK_EVENT_CONSTRAINT,
  WALLET_REVERSAL_ERRORS,
  chargebackCreditIdempotencyKey,
  chargebackReversalIdempotencyKey,
  matchChargebackToTopUp,
  parseChargebackNotification,
  parseChargebackNotificationJson,
  type ChargebackMatchMethod,
  type ChargebackTopUpCandidate,
  type ParsedChargebackNotification,
  needsFinanceChargebackAlert,
  type WalletChargebackEventStatus,
} from '@barghsa/shared/finance'
import { WalletService, type TransactionRow } from './wallet.service.js'
import { ChargebackAlertService } from './chargeback-alert.service.js'
import {
  resolvePaymentGatewayMerchantId,
  resolvePaymentGatewayWebhookSecret,
} from './payment-gateway.js'
import {
  verifyPaymentCallbackSignature,
  type PaymentCallbackHeaders,
} from './payment-callback-verifier.js'
import {
  PAYMENT_CALLBACK_CONFIG,
  type PaymentCallbackConfig,
} from './online-topup-callback.service.js'

const PG_UNIQUE_VIOLATION = '23505'

export interface HandleChargebackInput {
  headers: PaymentCallbackHeaders
  rawBody: string
}

export interface HandleChargebackResult {
  ok: true
  processed: boolean
  mapped: boolean
  reversed: boolean
  originalTransactionId: string | null
  reversalTransactionId: string | null
  matchMethod: ChargebackMatchMethod | null
  status: WalletChargebackEventStatus
}

interface ChargebackEventRow {
  eventId: string
  originalTransactionId: string | null
  reversalTransactionId: string | null
  walletId: string | null
  status: WalletChargebackEventStatus
  matchMethod: ChargebackMatchMethod | null
  raw: unknown
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
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
  private readonly logger = new Logger(ChargebackDetectionService.name)

  constructor(
    private readonly walletService: WalletService,
    @Optional()
    @Inject(PAYMENT_CALLBACK_CONFIG)
    private readonly injectedConfig?: PaymentCallbackConfig,
    @Optional()
    private readonly alertService?: ChargebackAlertService,
  ) {}

  async handle(input: HandleChargebackInput): Promise<HandleChargebackResult> {
    const config = this.resolveConfig()
    if (!config.webhookSecret) {
      this.logger.warn(
        'Payment chargeback received but PAYMENT_GATEWAY_WEBHOOK_SECRET is not set',
      )
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_UNCONFIGURED,
        'Payment provider callback signing secret is not configured',
      )
    }

    const verification = verifyPaymentCallbackSignature(
      input.rawBody,
      input.headers,
      config.webhookSecret,
    )
    if (!verification.ok) {
      if (verification.reason === 'replayed') {
        this.logger.warn('Rejected replayed or expired payment chargeback signature')
        httpError(
          ErrorCodes.PROVIDER_CALLBACK_REPLAYED,
          'Payment provider callback is expired or replayed',
        )
      }
      this.logger.warn(`Rejected payment chargeback signature (${verification.reason})`)
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Invalid payment provider callback signature',
      )
    }

    const eventId = input.headers.eventId!.trim()
    if (!eventId) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback event id is required')
    }

    const parsed = parseChargebackNotificationJson(input.rawBody)
    if (!parsed.ok) {
      if (parsed.reason === 'invalid_json') {
        httpError(ErrorCodes.VALIDATION_PARSE_JSON, 'Payment chargeback body must be JSON')
      }
      if (parsed.reason === 'invalid_amount') {
        httpError(
          ErrorCodes.VALIDATION_INPUT_INVALID,
          'Payment chargeback amount must be a positive integer IRR value',
        )
      }
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Payment chargeback body must include type, merchantId, amountIrR, and a chargeback locator',
      )
    }

    if (parsed.notification.merchantId !== config.merchantId) {
      this.logger.warn('Payment chargeback merchant id did not match configured merchant context')
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Payment callback merchant context is invalid',
      )
    }

    return this.processVerifiedNotification(eventId, parsed.notification)
  }

  private async processVerifiedNotification(
    eventId: string,
    notification: ParsedChargebackNotification,
  ): Promise<HandleChargebackResult> {
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = chargebackEventLockKeys(eventId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        const claim = await this.claimEvent(client, eventId, notification)
        if (!claim.inserted) {
          const existing = claim.existing
          if (!existing) {
            httpError(
              ErrorCodes.PROVIDER_CALLBACK_INVALID,
              'Payment chargeback event id could not be claimed',
            )
          }
          if (existing.status !== 'processing') {
            await this.alertIfUnresolved(client, existing.status, eventId, notification, {
              walletId: existing.walletId,
              originalTransactionId: existing.originalTransactionId,
            })
            return alreadyProcessedResult(existing)
          }
          assertClaimedNotificationMatches(existing.raw, notification)
        }

        const candidates = await this.loadCandidates(client, notification)
        const match = matchChargebackToTopUp(notification, candidates)
        if (!match) {
          await this.finalizeEvent(client, eventId, {
            status: 'unmatched',
            originalTransactionId: null,
            reversalTransactionId: null,
            walletId: null,
            matchMethod: null,
          })
          this.logger.warn(`Chargeback ${eventId} could not be mapped to an original top-up`)
          await this.alertIfUnresolved(client, 'unmatched', eventId, notification, {
            walletId: null,
            originalTransactionId: null,
          })
          return {
            ok: true,
            processed: true,
            mapped: false,
            reversed: false,
            originalTransactionId: null,
            reversalTransactionId: null,
            matchMethod: null,
            status: 'unmatched',
          }
        }

        const existingReversal = await this.findExistingReversal(client, match.original.id)
        if (existingReversal) {
          await this.finalizeEvent(client, eventId, {
            status: 'reversed',
            originalTransactionId: match.original.id,
            reversalTransactionId: existingReversal.id,
            walletId: match.original.walletId,
            matchMethod: match.method,
          })
          return {
            ok: true,
            processed: true,
            mapped: true,
            reversed: true,
            originalTransactionId: match.original.id,
            reversalTransactionId: existingReversal.id,
            matchMethod: match.method,
            status: 'reversed',
          }
        }

        let reversal: TransactionRow
        try {
          reversal = await this.walletService.reverseTransaction(
            match.original.id,
            notification.reason,
            chargebackReversalIdempotencyKey(eventId),
          )
        } catch (error) {
          if (isAlreadyReversedError(error, match.original.id)) {
            const raced = await this.findExistingReversal(client, match.original.id)
            if (raced) {
              await this.finalizeEvent(client, eventId, {
                status: 'reversed',
                originalTransactionId: match.original.id,
                reversalTransactionId: raced.id,
                walletId: match.original.walletId,
                matchMethod: match.method,
              })
              return {
                ok: true,
                processed: true,
                mapped: true,
                reversed: true,
                originalTransactionId: match.original.id,
                reversalTransactionId: raced.id,
                matchMethod: match.method,
                status: 'reversed',
              }
            }
          }
          if (isInsufficientReversalError(error)) {
            await this.finalizeEvent(client, eventId, {
              status: 'unresolved',
              originalTransactionId: match.original.id,
              reversalTransactionId: null,
              walletId: match.original.walletId,
              matchMethod: match.method,
            })
            this.logger.warn(
              `Chargeback ${eventId} mapped to ${match.original.id} but reversal could not post`,
            )
            await this.alertIfUnresolved(client, 'unresolved', eventId, notification, {
              walletId: match.original.walletId,
              originalTransactionId: match.original.id,
            })
            return {
              ok: true,
              processed: true,
              mapped: true,
              reversed: false,
              originalTransactionId: match.original.id,
              reversalTransactionId: null,
              matchMethod: match.method,
              status: 'unresolved',
            }
          }
          throw error
        }

        await this.finalizeEvent(client, eventId, {
          status: 'reversed',
          originalTransactionId: match.original.id,
          reversalTransactionId: reversal.id,
          walletId: match.original.walletId,
          matchMethod: match.method,
        })
        this.logger.log(
          `Chargeback ${eventId} reversed top-up ${match.original.id} as ${reversal.id}`,
        )
        return {
          ok: true,
          processed: true,
          mapped: true,
          reversed: true,
          originalTransactionId: match.original.id,
          reversalTransactionId: reversal.id,
          matchMethod: match.method,
          status: 'reversed',
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', lockKeys)
      }
    } finally {
      client.release()
    }
  }

  private resolveConfig(): PaymentCallbackConfig {
    if (this.injectedConfig) return this.injectedConfig
    return {
      webhookSecret: resolvePaymentGatewayWebhookSecret(),
      merchantId: resolvePaymentGatewayMerchantId(),
    }
  }

  private async claimEvent(
    client: QueryClient,
    eventId: string,
    notification: ParsedChargebackNotification,
  ): Promise<{ inserted: boolean; existing: ChargebackEventRow | null }> {
    try {
      const inserted = await client.query(
        `INSERT INTO wallet_chargeback_events (event_id, status, raw)
         VALUES ($1, 'processing', $2::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id, original_transaction_id, reversal_transaction_id,
                   wallet_id, status, match_method, raw`,
        [eventId, JSON.stringify(chargebackEventRaw(notification))],
      )
      if (inserted.rows.length > 0) {
        return {
          inserted: true,
          existing: mapEvent(inserted.rows[0] as Parameters<typeof mapEvent>[0]),
        }
      }
    } catch (error) {
      if (!isPgUniqueViolation(error, WALLET_CHARGEBACK_EVENT_CONSTRAINT)) throw error
    }

    const existing = await this.loadEvent(client, eventId)
    return { inserted: false, existing }
  }

  private async loadEvent(
    client: QueryClient,
    eventId: string,
  ): Promise<ChargebackEventRow | null> {
    const result = await client.query(
      `SELECT event_id, original_transaction_id, reversal_transaction_id,
              wallet_id, status, match_method, raw
         FROM wallet_chargeback_events
        WHERE event_id = $1`,
      [eventId],
    )
    if (result.rows.length === 0) return null
    return mapEvent(result.rows[0] as Parameters<typeof mapEvent>[0])
  }

  private async loadCandidates(
    client: QueryClient,
    notification: ParsedChargebackNotification,
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
        [
          chargebackCreditIdempotencyKey(notification.merchantOrderId),
          notification.merchantOrderId,
        ],
      )
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]))
    }

    if (notification.providerRefId) {
      const result = await client.query(
        `SELECT * FROM wallet_transactions
          WHERE type = 'topup'
            AND state = 'Completed'
            AND ref_id = $1`,
        [notification.providerRefId],
      )
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]))
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
        [notification.authority],
      )
      return result.rows.map((row) => mapCandidate(row as Parameters<typeof mapCandidate>[0]))
    }

    return []
  }

  private async findExistingReversal(
    client: QueryClient,
    originalTransactionId: string,
  ): Promise<TransactionRow | null> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE reverses_transaction_id = $1`,
      [originalTransactionId],
    )
    if (result.rows.length === 0) return null
    return mapTransaction(result.rows[0] as Parameters<typeof mapTransaction>[0])
  }

  private async alertIfUnresolved(
    client: QueryClient,
    status: WalletChargebackEventStatus,
    eventId: string,
    notification: ParsedChargebackNotification,
    refs: { walletId: string | null; originalTransactionId: string | null },
  ): Promise<void> {
    if (!this.alertService) return
    if (!needsFinanceChargebackAlert(status)) return
    await this.alertService.notifyUnresolved(client, {
      eventId,
      status,
      notification,
      walletId: refs.walletId,
      originalTransactionId: refs.originalTransactionId,
    })
  }

  private async finalizeEvent(
    client: QueryClient,
    eventId: string,
    input: {
      status: Exclude<WalletChargebackEventStatus, 'processing'>
      originalTransactionId: string | null
      reversalTransactionId: string | null
      walletId: string | null
      matchMethod: ChargebackMatchMethod | null
    },
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
      ],
    )
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
  }
}

function chargebackPayloadDigest(notification: ParsedChargebackNotification): Buffer {
  return createHash('sha256')
    .update(JSON.stringify(chargebackEventRaw(notification)))
    .digest()
}

function assertClaimedNotificationMatches(
  storedRaw: unknown,
  notification: ParsedChargebackNotification,
): void {
  const claimed = parseChargebackNotification(storedRaw)
  const digestMatches =
    claimed.ok &&
    timingSafeEqual(
      chargebackPayloadDigest(claimed.notification),
      chargebackPayloadDigest(notification),
    )
  if (!digestMatches) {
    httpError(
      ErrorCodes.PROVIDER_CALLBACK_INVALID,
      'Payment chargeback event payload does not match the claimed notification',
    )
  }
}

export function chargebackEventLockKeys(eventId: string): [number, number] {
  const digest = createHash('sha256').update(`wallet-chargeback:${eventId}`).digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function alreadyProcessedResult(existing: ChargebackEventRow): HandleChargebackResult {
  const terminal = existing.status === 'duplicate' ? 'duplicate' : existing.status
  return {
    ok: true,
    processed: false,
    mapped: existing.originalTransactionId !== null,
    reversed: terminal === 'reversed',
    originalTransactionId: existing.originalTransactionId,
    reversalTransactionId: existing.reversalTransactionId,
    matchMethod: existing.matchMethod,
    status: terminal,
  }
}

function mapEvent(row: {
  event_id: string
  original_transaction_id: string | null
  reversal_transaction_id: string | null
  wallet_id: string | null
  status: string
  match_method: string | null
  raw?: unknown
}): ChargebackEventRow {
  return {
    eventId: row.event_id,
    originalTransactionId: row.original_transaction_id,
    reversalTransactionId: row.reversal_transaction_id,
    walletId: row.wallet_id,
    status: row.status as WalletChargebackEventStatus,
    matchMethod: row.match_method as ChargebackMatchMethod | null,
    raw: row.raw ?? null,
  }
}

function mapCandidate(row: {
  id: string
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  idempotency_key: string
  ref_id?: string | null
  metadata?: unknown
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
  }
}

function mapTransaction(row: {
  id: string
  wallet_id: string
  type: string
  amount: string | number | bigint
  state: string
  idempotency_key: string
  ref_id?: string | null
  description?: string | null
  metadata?: unknown
  reverses_transaction_id?: string | null
  created_at: Date
  updated_at: Date
}): TransactionRow {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    refId: row.ref_id ?? null,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    reversesTransactionId: row.reverses_transaction_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}

function nestMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse()
    if (typeof body === 'string') return body
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message
      if (typeof message === 'string') return message
    }
  }
  if (error instanceof Error) return error.message
  return ''
}

function isAlreadyReversedError(error: unknown, originalId: string): boolean {
  if (!(error instanceof ConflictException)) return false
  return nestMessage(error) === WALLET_REVERSAL_ERRORS.ALREADY_REVERSED(originalId)
}

function isInsufficientReversalError(error: unknown): boolean {
  if (!(error instanceof BadRequestException)) return false
  return nestMessage(error).startsWith('Insufficient balance')
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus,
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode)
}
