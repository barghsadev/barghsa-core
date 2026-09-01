import { randomUUID } from 'node:crypto'

/**
 * Payment gateway port used by online wallet top-up initiation
 * (T-04.2.02.01 / S-04.2.02).
 *
 * Initiation starts a provider session and returns a browser redirect
 * URL. Wallet credit happens later in the authenticated callback
 * handler (T-04.2.02.02) — the redirect itself is not proof of payment.
 */

/** Nest injection token for the payment gateway adapter. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')

/** Path the provider will call after payment (implemented in T-04.2.02.02). */
export const ONLINE_TOPUP_CALLBACK_PATH = '/api/wallet/top-ups/callback'

export const DEFAULT_ZARINPAL_REQUEST_URL =
  'https://payment.zarinpal.com/pg/v4/payment/request.json'
export const DEFAULT_ZARINPAL_START_PAY_URL = 'https://payment.zarinpal.com/pg/StartPay'
export const DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS = 15_000

export type PaymentGatewayAdapterName = 'zarinpal' | 'http' | 'redirect'

export interface PaymentGatewayStartRequest {
  /** Amount in IRR (positive integer). */
  amountIrR: bigint
  /** Merchant order id — the Pending wallet_transactions.id. */
  merchantOrderId: string
  description: string
  /** Server callback URL the provider should invoke on completion. */
  callbackUrl: string
}

export interface PaymentGatewayStartResult {
  /** Browser URL the customer is sent to. */
  redirectUrl: string
  /** Provider session / authority id stored on the Pending ledger row. */
  authority: string
}

export interface PaymentGateway {
  startPayment(request: PaymentGatewayStartRequest): Promise<PaymentGatewayStartResult>
}

export type PaymentGatewayFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export function resolvePaymentGatewayCallbackUrl(): string {
  const base = (
    process.env.API_PUBLIC_URL ??
    process.env.APP_PUBLIC_URL ??
    'http://localhost:4000'
  ).replace(/\/$/, '')
  return `${base}${ONLINE_TOPUP_CALLBACK_PATH}`
}

export function resolvePaymentGatewayStartUrl(): string {
  return process.env.PAYMENT_GATEWAY_START_URL ?? 'https://pay.sandbox.local/start'
}

export function resolvePaymentGatewayAdapterName(
  env: NodeJS.ProcessEnv = process.env,
): PaymentGatewayAdapterName {
  const raw = (env.PAYMENT_GATEWAY_ADAPTER ?? '').trim().toLowerCase()
  if (raw === 'zarinpal' || raw === 'http' || raw === 'redirect') return raw
  if (raw.length > 0) {
    throw new Error(
      `Unknown PAYMENT_GATEWAY_ADAPTER "${raw}". Use zarinpal, http, or redirect.`,
    )
  }
  return env.NODE_ENV === 'production' ? 'zarinpal' : 'redirect'
}

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production'
}

function resolveTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.PAYMENT_GATEWAY_TIMEOUT_MS
  if (raw === undefined || raw.trim() === '') return DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 60_000) {
    return DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  }
  return parsed
}

/**
 * Redirect-style adapter: builds a hosted-checkout URL without talking
 * to a live PSP. Only for development/test when
 * `PAYMENT_GATEWAY_ADAPTER=redirect` is selected (or as the non-production
 * default). Production must use zarinpal or http.
 */
export function createRedirectPaymentGateway(
  options: { startUrl?: string } = {},
): PaymentGateway {
  const startUrl = options.startUrl ?? resolvePaymentGatewayStartUrl()
  return {
    async startPayment(request) {
      const authority = randomUUID()
      const url = new URL(startUrl)
      url.searchParams.set('authority', authority)
      url.searchParams.set('amount', request.amountIrR.toString())
      url.searchParams.set('orderId', request.merchantOrderId)
      url.searchParams.set('callbackUrl', request.callbackUrl)
      return { authority, redirectUrl: url.toString() }
    },
  }
}

function requireSafePositiveAmount(amountIrR: bigint): number {
  const amount = Number(amountIrR)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Payment amount is not a safe positive integer IRR value')
  }
  return amount
}

function readJsonObject(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return body as Record<string, unknown>
}

/**
 * Generic HTTP PSP adapter. Authenticates with the configured API key,
 * posts amount/order/callback, and requires a provider-issued authority
 * plus redirect URL (or a start-URL template to build the redirect).
 */
export function createHttpPaymentGateway(options: {
  requestUrl: string
  apiKey: string
  startUrl?: string
  timeoutMs?: number
  fetchImpl?: PaymentGatewayFetch
}): PaymentGateway {
  const fetchImpl = options.fetchImpl ?? (fetch as PaymentGatewayFetch)
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  const startUrl = options.startUrl?.replace(/\/$/, '')

  return {
    async startPayment(request) {
      const amount = requireSafePositiveAmount(request.amountIrR)
      const res = await fetchImpl(options.requestUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'X-API-KEY': options.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          amount,
          orderId: request.merchantOrderId,
          callbackUrl: request.callbackUrl,
          description: request.description,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new Error(`Payment gateway request failed: invalid JSON (HTTP ${res.status})`)
      }
      if (!res.ok) {
        throw new Error(`Payment gateway request failed: HTTP ${res.status}`)
      }

      const record = readJsonObject(body)
      const authority = typeof record?.authority === 'string' ? record.authority.trim() : ''
      if (!authority) {
        throw new Error('Payment gateway response did not include a provider authority')
      }

      const redirectFromProvider =
        typeof record?.redirectUrl === 'string' ? record.redirectUrl.trim() : ''
      if (redirectFromProvider) {
        return { authority, redirectUrl: redirectFromProvider }
      }
      if (!startUrl) {
        throw new Error(
          'Payment gateway response did not include redirectUrl and PAYMENT_GATEWAY_START_URL is not set',
        )
      }
      return {
        authority,
        redirectUrl: `${startUrl}/${encodeURIComponent(authority)}`,
      }
    },
  }
}

/**
 * ZarinPal v4 payment-request adapter. Sends merchant_id + amount +
 * callback to the provider and returns the provider-issued authority
 * plus StartPay redirect URL.
 */
export function createZarinpalPaymentGateway(options: {
  merchantId: string
  requestUrl?: string
  startPayUrl?: string
  timeoutMs?: number
  fetchImpl?: PaymentGatewayFetch
}): PaymentGateway {
  const fetchImpl = options.fetchImpl ?? (fetch as PaymentGatewayFetch)
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  const requestUrl = options.requestUrl ?? DEFAULT_ZARINPAL_REQUEST_URL
  const startPayUrl = (options.startPayUrl ?? DEFAULT_ZARINPAL_START_PAY_URL).replace(/\/$/, '')

  return {
    async startPayment(request) {
      const amount = requireSafePositiveAmount(request.amountIrR)
      const res = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          merchant_id: options.merchantId,
          amount,
          callback_url: request.callbackUrl,
          description: request.description,
          metadata: { order_id: request.merchantOrderId },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new Error(`ZarinPal request failed: invalid JSON (HTTP ${res.status})`)
      }

      const record = readJsonObject(body)
      const data = readJsonObject(record?.data)
      const errors = record?.errors
      const errorRecord = readJsonObject(errors)
      const code = data?.code
      const authority = typeof data?.authority === 'string' ? data.authority.trim() : ''

      if (!res.ok || (code !== 100 && code !== 101) || !authority) {
        const message =
          (typeof errorRecord?.message === 'string' && errorRecord.message) ||
          (typeof data?.message === 'string' && data.message) ||
          `HTTP ${res.status} code=${String(code ?? 'missing')}`
        throw new Error(`ZarinPal request rejected: ${message}`)
      }

      return {
        authority,
        redirectUrl: `${startPayUrl}/${encodeURIComponent(authority)}`,
      }
    },
  }
}

export interface CreatePaymentGatewayFromEnvOptions {
  env?: NodeJS.ProcessEnv
  fetchImpl?: PaymentGatewayFetch
}

/**
 * Selects the registered payment adapter from env. Production refuses
 * the local redirect builder and fails closed when merchant/API
 * credentials are missing.
 */
export function createPaymentGatewayFromEnv(
  options: CreatePaymentGatewayFromEnvOptions = {},
): PaymentGateway {
  const env = options.env ?? process.env
  const adapter = resolvePaymentGatewayAdapterName(env)
  const timeoutMs = resolveTimeoutMs(env)

  if (adapter === 'redirect') {
    if (isProductionEnv(env)) {
      throw new Error(
        'PAYMENT_GATEWAY_ADAPTER=redirect is not allowed in production. Configure zarinpal (PAYMENT_GATEWAY_MERCHANT_ID) or http (PAYMENT_GATEWAY_REQUEST_URL and PAYMENT_GATEWAY_API_KEY).',
      )
    }
    return createRedirectPaymentGateway(
      env.PAYMENT_GATEWAY_START_URL ? { startUrl: env.PAYMENT_GATEWAY_START_URL } : {},
    )
  }

  if (adapter === 'zarinpal') {
    const merchantId = env.PAYMENT_GATEWAY_MERCHANT_ID?.trim() ?? ''
    if (!merchantId) {
      throw new Error(
        'PAYMENT_GATEWAY_MERCHANT_ID is required for the zarinpal payment adapter',
      )
    }
    const zarinpalRequestUrl = env.PAYMENT_GATEWAY_REQUEST_URL?.trim()
    const startPayUrl = env.PAYMENT_GATEWAY_START_URL?.trim()
    return createZarinpalPaymentGateway({
      merchantId,
      timeoutMs,
      ...(zarinpalRequestUrl ? { requestUrl: zarinpalRequestUrl } : {}),
      ...(startPayUrl ? { startPayUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    })
  }

  const requestUrl = env.PAYMENT_GATEWAY_REQUEST_URL?.trim() ?? ''
  const apiKey = env.PAYMENT_GATEWAY_API_KEY?.trim() ?? ''
  if (!requestUrl || !apiKey) {
    throw new Error(
      'PAYMENT_GATEWAY_REQUEST_URL and PAYMENT_GATEWAY_API_KEY are required for the http payment adapter',
    )
  }
  const startUrl = env.PAYMENT_GATEWAY_START_URL?.trim()
  return createHttpPaymentGateway({
    requestUrl,
    apiKey,
    timeoutMs,
    ...(startUrl ? { startUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
}
