import { createHash } from 'node:crypto'
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common'
import { z } from 'zod'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import { parseOnlineTopUpAmountIrR } from '@barghsa/shared/finance'
import { WalletService, type TransactionRow } from './wallet.service.js'
import {
  PAYMENT_GATEWAY,
  resolvePaymentGatewayMerchantId,
  resolvePaymentGatewayWebhookSecret,
  type PaymentGateway,
} from './payment-gateway.js'
import {
  verifyPaymentCallbackSignature,
  type PaymentCallbackHeaders,
} from './payment-callback-verifier.js'

const PG_UNIQUE_VIOLATION = '23505'
const CALLBACK_EVENT_UNIQUE = 'uq_wallet_topup_callback_event_id'
const ONLINE_TOPUP_DESCRIPTION = 'Online wallet top-up'

export const PAYMENT_CALLBACK_CONFIG = Symbol('PAYMENT_CALLBACK_CONFIG')

export interface PaymentCallbackConfig {
  webhookSecret: string
  merchantId: string
}

export interface HandleProviderCallbackInput {
  headers: PaymentCallbackHeaders
  rawBody: string
}

export interface HandleZarinpalReturnInput {
  orderId: string
  authority: string
  status: string
}

export interface HandleProviderCallbackResult {
  ok: true
  processed: boolean
  credited: boolean
  transactionId: string | null
  creditTransactionId: string | null
}

interface ProcessVerifiedPayloadInput {
  eventId: string
  merchantOrderId: string
  authority: string
  /** When set, must match the pending amount. When omitted, the stored amount is used. */
  amountIrR?: bigint
  status: 'paid' | 'failed' | 'cancelled'
  providerRefId?: string
  raw: unknown
}

type CallbackEventStatus = 'processing' | 'credited' | 'unpaid' | 'duplicate'

interface CallbackEventRow {
  eventId: string
  pendingTransactionId: string
  walletId: string
  status: CallbackEventStatus
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

const CallbackBodySchema = z
  .object({
    merchantOrderId: z.string().uuid(),
    merchantId: z.string().min(1),
    authority: z.string().min(1),
    amountIrR: z.union([z.number(), z.string()]),
    status: z.enum(['paid', 'failed', 'cancelled']),
    providerRefId: z.string().min(1).optional(),
  })
  .strict()

/**
 * Authenticated payment-provider callback handler (T-04.2.02.02).
 *
 * Browser redirect query params are never proof of payment. Two ingress
 * paths share the same verify-then-credit pipeline:
 *   - HMAC-signed POST (http adapter / signed webhooks).
 *   - ZarinPal GET return (`orderId`, `Authority`, `Status`) bound to
 *     the stored Pending top-up, then confirmed via `verifyPayment()`.
 *
 * Shared steps after authentication:
 *   1. Claims the provider event id before any business side effect
 *      (atomic INSERT … ON CONFLICT DO NOTHING RETURNING). Duplicate
 *      event ids stop here, including replays bound to another order.
 *      A terminal unpaid claim for the same order is reopened when a
 *      later paid delivery arrives so browser NOK cannot suppress
 *      server-side verify.
 *   2. Checks order id, amount, and authority against the Pending top-up.
 *   3. Confirms payment with the gateway server-side.
 *   4. Credits the wallet via `WalletService.credit()` using a stable
 *      idempotency key derived from the pending transaction id.
 *   5. Releases the original Pending intent so it does not post twice
 *      (posted balance comes only from the Completed credit row).
 */
@Injectable()
export class OnlineTopUpCallbackService {
  private readonly logger = new Logger(OnlineTopUpCallbackService.name)

  constructor(
    private readonly walletService: WalletService,
    @Inject(PAYMENT_GATEWAY) private readonly paymentGateway: PaymentGateway,
    @Optional()
    @Inject(PAYMENT_CALLBACK_CONFIG)
    private readonly injectedConfig?: PaymentCallbackConfig,
  ) {}

  async handle(input: HandleProviderCallbackInput): Promise<HandleProviderCallbackResult> {
    const config = this.resolveConfig()
    if (!config.webhookSecret) {
      this.logger.warn('Payment callback received but PAYMENT_GATEWAY_WEBHOOK_SECRET is not set')
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
        this.logger.warn('Rejected replayed or expired payment callback signature')
        httpError(
          ErrorCodes.PROVIDER_CALLBACK_REPLAYED,
          'Payment provider callback is expired or replayed',
        )
      }
      this.logger.warn(`Rejected payment callback signature (${verification.reason})`)
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Invalid payment provider callback signature',
      )
    }

    const eventId = input.headers.eventId!.trim()
    if (!eventId) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback event id is required')
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(input.rawBody)
    } catch {
      httpError(ErrorCodes.VALIDATION_PARSE_JSON, 'Payment callback body must be JSON')
    }

    const parsed = CallbackBodySchema.safeParse(parsedJson)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD,
        'Payment callback body must include merchantOrderId, merchantId, authority, amountIrR, and status',
      )
    }

    const amountIrR = parseOnlineTopUpAmountIrR(parsed.data.amountIrR)
    if (amountIrR === null) {
      httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Payment callback amount must be a positive integer IRR value',
      )
    }

    if (parsed.data.merchantId !== config.merchantId) {
      this.logger.warn('Payment callback merchant id did not match configured merchant context')
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Payment callback merchant context is invalid',
      )
    }

    return this.processVerifiedPayload({
      eventId,
      merchantOrderId: parsed.data.merchantOrderId,
      authority: parsed.data.authority,
      amountIrR,
      status: parsed.data.status,
      raw: parsed.data,
      ...(parsed.data.providerRefId ? { providerRefId: parsed.data.providerRefId } : {}),
    })
  }

  /**
   * ZarinPal browser return (T-04.2.02.02). `Status`/`Authority` on the
   * redirect are not proof of payment: they are bound to the Pending
   * row (`orderId` + stored authority) and confirmed with `verify.json`
   * before `WalletService.credit()`.
   */
  async handleZarinpalReturn(
    input: HandleZarinpalReturnInput,
  ): Promise<HandleProviderCallbackResult> {
    const orderId = input.orderId.trim()
    const authority = input.authority.trim()
    const statusRaw = input.status.trim()
    if (!z.string().uuid().safeParse(orderId).success) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback merchant order was not found')
    }
    if (!authority) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback authority is required')
    }

    const statusUpper = statusRaw.toUpperCase()
    const status: ProcessVerifiedPayloadInput['status'] =
      statusUpper === 'OK' ? 'paid' : statusUpper === 'NOK' ? 'cancelled' : 'failed'

    return this.processVerifiedPayload({
      eventId: zarinpalReturnEventId(orderId, authority, status),
      merchantOrderId: orderId,
      authority,
      status,
      raw: {
        source: 'zarinpal-return',
        orderId,
        authority,
        status: statusRaw,
      },
    })
  }

  private async processVerifiedPayload(
    input: ProcessVerifiedPayloadInput,
  ): Promise<HandleProviderCallbackResult> {
    const pool = getDbPool()
    const client = await pool.connect()
    const lockKeys = onlineTopUpCallbackLockKeys(input.merchantOrderId)
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', lockKeys)
      try {
        const pending = await this.loadPendingTopUp(client, input.merchantOrderId)
        const amountIrR = input.amountIrR ?? pending.amount
        this.assertMerchantContext(pending, input.authority, amountIrR)

        const claim = await this.claimEvent(client, {
          eventId: input.eventId,
          pendingId: pending.id,
          walletId: pending.walletId,
          raw: input.raw,
        })
        if (!claim.inserted) {
          const existing = claim.existing
          if (!existing) {
            httpError(
              ErrorCodes.PROVIDER_CALLBACK_INVALID,
              'Payment callback event id could not be claimed',
            )
          }
          const sameOrder = existing.pendingTransactionId === pending.id
          const resumeCrash = sameOrder && existing.status === 'processing'
          const resumeUnpaidForPaid =
            sameOrder && existing.status === 'unpaid' && input.status === 'paid'
          if (!resumeCrash && !resumeUnpaidForPaid) {
            return this.alreadyProcessedResult(client, existing)
          }
          if (resumeUnpaidForPaid) {
            await this.reopenUnpaidEvent(client, input.eventId, input.raw)
          }
        }

        const alreadyCredited = await this.findExistingCredit(client, pending.id)
        if (alreadyCredited) {
          if (pending.state === 'Pending' || pending.state === 'Failed') {
            await this.releasePendingIntent(client, pending.id, alreadyCredited.id, input.eventId)
          }
          await this.finalizeEvent(client, input.eventId, 'duplicate')
          return {
            ok: true,
            processed: false,
            credited: true,
            transactionId: pending.id,
            creditTransactionId: alreadyCredited.id,
          }
        }

        if (input.status !== 'paid') {
          await this.markPendingFailed(client, pending.id, input.status)
          await this.finalizeEvent(client, input.eventId, 'unpaid')
          return {
            ok: true,
            processed: true,
            credited: false,
            transactionId: pending.id,
            creditTransactionId: null,
          }
        }

        let verified: { paid: boolean; providerRefId: string | null }
        try {
          verified = await this.paymentGateway.verifyPayment({
            amountIrR,
            merchantOrderId: pending.id,
            authority: input.authority,
            idempotencyKey: pending.id,
          })
        } catch (error) {
          this.logger.error(
            `Payment gateway verify failed for pending top-up ${pending.id}`,
            error instanceof Error ? error.stack : undefined,
          )
          httpError(
            ErrorCodes.PROVIDER_DOWNSTREAM,
            'Payment gateway is unavailable',
            502,
          )
        }

        if (!verified.paid) {
          await this.markPendingFailed(client, pending.id, 'verify_unpaid')
          await this.finalizeEvent(client, input.eventId, 'unpaid')
          return {
            ok: true,
            processed: true,
            credited: false,
            transactionId: pending.id,
            creditTransactionId: null,
          }
        }

        const providerRef = input.providerRefId ?? verified.providerRefId ?? input.authority
        const credit = await this.walletService.credit(
          pending.walletId,
          amountIrR,
          {
            type: 'topup',
            refId: providerRef,
            description: ONLINE_TOPUP_DESCRIPTION,
            metadata: {
              channel: 'online',
              pendingTransactionId: pending.id,
              eventId: input.eventId,
              authority: input.authority,
            },
          },
          onlineTopUpCreditIdempotencyKey(pending.id),
        )

        await this.releasePendingIntent(client, pending.id, credit.id, input.eventId)
        await this.finalizeEvent(client, input.eventId, 'credited')

        this.logger.log(
          `Online top-up ${pending.id} credited as ${credit.id} for wallet ${pending.walletId}`,
        )

        return {
          ok: true,
          processed: true,
          credited: true,
          transactionId: pending.id,
          creditTransactionId: credit.id,
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

  private async loadPendingTopUp(client: QueryClient, merchantOrderId: string): Promise<TransactionRow> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE id = $1 FOR UPDATE`,
      [merchantOrderId],
    )
    if (result.rows.length === 0) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback merchant order was not found')
    }
    return mapTransaction(result.rows[0] as Parameters<typeof mapTransaction>[0])
  }

  private assertMerchantContext(
    pending: TransactionRow,
    authority: string,
    amountIrR: bigint,
  ): void {
    if (pending.type !== 'topup') {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback merchant order is not a top-up')
    }
    if (pending.amount !== amountIrR) {
      httpError(ErrorCodes.PROVIDER_CALLBACK_INVALID, 'Payment callback amount does not match merchant order')
    }
    const storedAuthority = readStoredAuthority(pending)
    if (!storedAuthority || storedAuthority !== authority) {
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Payment callback authority does not match merchant order',
      )
    }
    if (pending.state !== 'Pending' && pending.state !== 'Released' && pending.state !== 'Failed') {
      httpError(
        ErrorCodes.PROVIDER_CALLBACK_INVALID,
        'Payment callback merchant order is not awaiting confirmation',
      )
    }
  }

  /**
   * Atomically claim `event_id` before verify/credit/pending mutations.
   * `RETURNING` distinguishes a new claim from a duplicate; callers must
   * stop when no row is inserted unless the stored row is still
   * `processing` for the same pending order (crash resume), or is a
   * terminal `unpaid` claim for the same order with an incoming `paid`
   * status. Browser-reported unpaid must not suppress later server
   * verification; `WalletService.credit()` idempotency remains the
   * duplicate-credit guard.
   */
  private async claimEvent(
    client: QueryClient,
    input: {
      eventId: string
      pendingId: string
      walletId: string
      raw: unknown
    },
  ): Promise<{ inserted: boolean; existing: CallbackEventRow | null }> {
    try {
      const inserted = await client.query(
        `INSERT INTO wallet_topup_callback_events
           (event_id, pending_transaction_id, wallet_id, status, raw)
         VALUES ($1, $2, $3, 'processing', $4::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id, pending_transaction_id, wallet_id, status`,
        [input.eventId, input.pendingId, input.walletId, JSON.stringify(input.raw)],
      )
      if (inserted.rows.length > 0) {
        return { inserted: true, existing: mapEvent(inserted.rows[0] as Parameters<typeof mapEvent>[0]) }
      }
    } catch (error) {
      if (!isPgUniqueViolation(error, CALLBACK_EVENT_UNIQUE)) throw error
    }

    const existing = await this.loadEvent(client, input.eventId)
    return { inserted: false, existing }
  }

  private async loadEvent(client: QueryClient, eventId: string): Promise<CallbackEventRow | null> {
    const result = await client.query(
      `SELECT event_id, pending_transaction_id, wallet_id, status
         FROM wallet_topup_callback_events
        WHERE event_id = $1`,
      [eventId],
    )
    if (result.rows.length === 0) return null
    return mapEvent(result.rows[0] as Parameters<typeof mapEvent>[0])
  }

  private async alreadyProcessedResult(
    client: QueryClient,
    existing: CallbackEventRow,
  ): Promise<HandleProviderCallbackResult> {
    if (existing.status === 'unpaid' || existing.status === 'processing') {
      return {
        ok: true,
        processed: false,
        credited: false,
        transactionId: existing.pendingTransactionId,
        creditTransactionId: null,
      }
    }
    const credit = await this.findExistingCredit(client, existing.pendingTransactionId)
    return {
      ok: true,
      processed: false,
      credited: true,
      transactionId: existing.pendingTransactionId,
      creditTransactionId: credit?.id ?? null,
    }
  }

  private async findExistingCredit(
    client: QueryClient,
    pendingId: string,
  ): Promise<TransactionRow | null> {
    const result = await client.query(
      `SELECT * FROM wallet_transactions WHERE idempotency_key = $1`,
      [onlineTopUpCreditIdempotencyKey(pendingId)],
    )
    if (result.rows.length === 0) return null
    return mapTransaction(result.rows[0] as Parameters<typeof mapTransaction>[0])
  }

  private async releasePendingIntent(
    client: QueryClient,
    pendingId: string,
    creditTransactionId: string,
    eventId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_transactions
       SET state = 'Released',
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE id = $1
         AND type = 'topup'
         AND state IN ('Pending', 'Failed')`,
      [
        pendingId,
        JSON.stringify({
          gateway: {
            creditedTransactionId: creditTransactionId,
            callbackEventId: eventId,
            creditedAt: new Date().toISOString(),
          },
        }),
      ],
    )
  }

  private async markPendingFailed(
    client: QueryClient,
    pendingId: string,
    reason: string,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_transactions
       SET state = 'Failed',
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE id = $1
         AND type = 'topup'
         AND state = 'Pending'`,
      [
        pendingId,
        JSON.stringify({
          gateway: {
            callbackStatus: reason,
            failedAt: new Date().toISOString(),
          },
        }),
      ],
    )
  }

  /**
   * Re-open a terminal unpaid claim so a later paid delivery can run
   * `verifyPayment` and credit. `finalizeEvent` only writes from
   * `processing`.
   */
  private async reopenUnpaidEvent(
    client: QueryClient,
    eventId: string,
    raw: unknown,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_topup_callback_events
          SET status = 'processing',
              raw = $2::jsonb
        WHERE event_id = $1
          AND status = 'unpaid'`,
      [eventId, JSON.stringify(raw)],
    )
  }

  private async finalizeEvent(
    client: QueryClient,
    eventId: string,
    status: Exclude<CallbackEventStatus, 'processing'>,
  ): Promise<void> {
    await client.query(
      `UPDATE wallet_topup_callback_events
          SET status = $2
        WHERE event_id = $1
          AND status = 'processing'`,
      [eventId, status],
    )
  }
}

export function onlineTopUpCreditIdempotencyKey(pendingTransactionId: string): string {
  return `wallet-online-topup-credit:${pendingTransactionId}`
}

/**
 * Stable event id for ZarinPal GET returns (no provider-issued event
 * header). Terminal Status is part of the identity so a browser
 * `NOK` cannot claim the same id as a later `OK` and suppress
 * `verifyPayment`.
 */
export function zarinpalReturnEventId(
  orderId: string,
  authority: string,
  terminalStatus: 'paid' | 'failed' | 'cancelled',
): string {
  return `zarinpal-return:${orderId}:${authority}:${terminalStatus}`
}

export function onlineTopUpCallbackLockKeys(merchantOrderId: string): [number, number] {
  const digest = createHash('sha256').update(`wallet-online-topup-callback:${merchantOrderId}`).digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

function readStoredAuthority(pending: TransactionRow): string | null {
  if (typeof pending.refId === 'string' && pending.refId.length > 0) return pending.refId
  if (!pending.metadata || typeof pending.metadata !== 'object') return null
  const gateway = (pending.metadata as { gateway?: { authority?: unknown } }).gateway
  if (typeof gateway?.authority === 'string' && gateway.authority.length > 0) {
    return gateway.authority
  }
  return null
}

function mapEvent(row: {
  event_id: string
  pending_transaction_id: string
  wallet_id: string
  status: string
}): CallbackEventRow {
  return {
    eventId: row.event_id,
    pendingTransactionId: row.pending_transaction_id,
    walletId: row.wallet_id,
    status: row.status as CallbackEventStatus,
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

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus,
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode)
}
