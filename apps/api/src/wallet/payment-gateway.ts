import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

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
export const DEFAULT_DEV_CALLBACK_ORIGIN = 'http://localhost:4000'
export const DEFAULT_DEV_START_URL = 'https://pay.sandbox.local/start'

export type PaymentGatewayAdapterName = 'zarinpal' | 'http' | 'redirect'

export interface PaymentGatewayStartRequest {
  /** Amount in IRR (positive integer). */
  amountIrR: bigint
  /** Merchant order id — the Pending wallet_transactions.id. */
  merchantOrderId: string
  description: string
  /** Server callback URL the provider should invoke on completion. */
  callbackUrl: string
  /**
   * Stable provider idempotency key tied to the Pending transaction id.
   * Adapters must reuse the same payable session when this key is repeated.
   */
  idempotencyKey: string
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

const AUTHORITY_NAMESPACE = 'barghsa.payment-gateway.authority.v1'

/**
 * Deterministic UUID derived from the provider idempotency key so the
 * local redirect adapter can safely retry after a crash without minting
 * a second payable session.
 */
export function stablePaymentAuthority(idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(AUTHORITY_NAMESPACE)
    .update('\0')
    .update(idempotencyKey)
    .digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production'
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

function uniqueHosts(hosts: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const host of hosts) {
    const normalized = normalizeHost(host)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function hostnameOf(raw: string): string | null {
  try {
    const host = normalizeHost(new URL(raw).hostname)
    return host || null
  } catch {
    return null
  }
}

function hostsFromConfiguredUrls(urls: readonly (string | undefined)[]): string[] {
  return uniqueHosts(
    urls.flatMap((raw) => {
      if (!raw) return []
      const host = hostnameOf(raw)
      return host ? [host] : []
    }),
  )
}

function parseAbsoluteUrl(raw: string, label: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${label} is not a valid absolute URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} uses an unsupported URL scheme`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials`)
  }
  if (!url.hostname) {
    throw new Error(`${label} must include a hostname`)
  }
  return url
}

function isNonPublicCallbackHostname(hostname: string): boolean {
  const host = normalizeHost(hostname)
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  return isIP(host) !== 0
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

function assertHttpsUrl(raw: string, label: string): URL {
  const url = parseAbsoluteUrl(raw, label)
  if (url.protocol !== 'https:') {
    throw new Error(`${label} must be an https URL`)
  }
  return url
}

/**
 * Parses a browser-facing gateway URL and accepts only HTTPS destinations
 * whose host is on the configured allow-list. Credentials and unsupported
 * schemes are rejected.
 */
export function assertSafePaymentGatewayUrl(
  raw: string,
  allowedHosts: readonly string[],
  label: string,
): URL {
  const url = assertHttpsUrl(raw, label)
  const host = normalizeHost(url.hostname)
  const allowed = uniqueHosts(allowedHosts)
  if (!allowed.includes(host)) {
    throw new Error(`${label} host "${host}" is not in the payment gateway host allow-list`)
  }
  return url
}

export function resolvePaymentGatewayAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
  configuredUrls: readonly (string | undefined)[] = [],
): string[] {
  const fromEnv = (env.PAYMENT_GATEWAY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return uniqueHosts([...fromEnv, ...hostsFromConfiguredUrls(configuredUrls)])
}

/**
 * Public origin the PSP will call after checkout. Production fails closed
 * unless `API_PUBLIC_URL` or `APP_PUBLIC_URL` is an explicit public HTTPS
 * origin. Development may omit both and uses localhost.
 */
export function resolvePaymentGatewayCallbackUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (env.API_PUBLIC_URL ?? env.APP_PUBLIC_URL ?? '').trim()
  const production = isProductionEnv(env)

  if (!raw) {
    if (production) {
      throw new Error(
        'API_PUBLIC_URL or APP_PUBLIC_URL is required in production so the payment provider can reach the top-up callback',
      )
    }
    return `${DEFAULT_DEV_CALLBACK_ORIGIN}${ONLINE_TOPUP_CALLBACK_PATH}`
  }

  const url = parseAbsoluteUrl(raw, 'API_PUBLIC_URL/APP_PUBLIC_URL')
  if (production) {
    if (url.protocol !== 'https:') {
      throw new Error(
        'API_PUBLIC_URL/APP_PUBLIC_URL must be a public https origin in production',
      )
    }
    if (isNonPublicCallbackHostname(url.hostname)) {
      throw new Error(
        'API_PUBLIC_URL/APP_PUBLIC_URL must be a public hostname in production (not localhost or an IP address)',
      )
    }
  } else if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('API_PUBLIC_URL/APP_PUBLIC_URL must be an http(s) origin')
  }

  return `${url.origin}${ONLINE_TOPUP_CALLBACK_PATH}`
}

export function resolvePaymentGatewayStartUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.PAYMENT_GATEWAY_START_URL?.trim()
  return raw && raw.length > 0 ? raw : DEFAULT_DEV_START_URL
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
  options: {
    startUrl?: string
    allowedHosts?: readonly string[]
    env?: NodeJS.ProcessEnv
  } = {},
): PaymentGateway {
  const startUrlRaw = options.startUrl ?? resolvePaymentGatewayStartUrl(options.env)
  const allowedHosts =
    options.allowedHosts ??
    resolvePaymentGatewayAllowedHosts(options.env ?? {}, [startUrlRaw])
  const startUrl = assertSafePaymentGatewayUrl(
    startUrlRaw,
    allowedHosts,
    'PAYMENT_GATEWAY_START_URL',
  )

  return {
    async startPayment(request) {
      const authority = stablePaymentAuthority(request.idempotencyKey)
      const url = new URL(startUrl.href)
      url.searchParams.set('authority', authority)
      url.searchParams.set('amount', request.amountIrR.toString())
      url.searchParams.set('orderId', request.merchantOrderId)
      url.searchParams.set('callbackUrl', request.callbackUrl)
      const redirectUrl = assertSafePaymentGatewayUrl(
        url.toString(),
        allowedHosts,
        'payment gateway redirectUrl',
      ).href
      return { authority, redirectUrl }
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
  allowedHosts?: readonly string[]
}): PaymentGateway {
  const fetchImpl = options.fetchImpl ?? (fetch as PaymentGatewayFetch)
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  const startUrlRaw = options.startUrl ? stripTrailingSlash(options.startUrl) : undefined
  const allowedHosts =
    options.allowedHosts ??
    resolvePaymentGatewayAllowedHosts({}, [options.requestUrl, startUrlRaw])

  assertHttpsUrl(options.requestUrl, 'PAYMENT_GATEWAY_REQUEST_URL')
  const startUrl = startUrlRaw
    ? stripTrailingSlash(
        assertSafePaymentGatewayUrl(
          startUrlRaw,
          allowedHosts,
          'PAYMENT_GATEWAY_START_URL',
        ).href,
      )
    : undefined

  return {
    async startPayment(request) {
      const amount = requireSafePositiveAmount(request.amountIrR)
      const res = await fetchImpl(options.requestUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'X-API-KEY': options.apiKey,
          'Idempotency-Key': request.idempotencyKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          amount,
          orderId: request.merchantOrderId,
          idempotencyKey: request.idempotencyKey,
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
        const redirectUrl = assertSafePaymentGatewayUrl(
          redirectFromProvider,
          allowedHosts,
          'payment gateway redirectUrl',
        ).href
        return { authority, redirectUrl }
      }
      if (!startUrl) {
        throw new Error(
          'Payment gateway response did not include redirectUrl and PAYMENT_GATEWAY_START_URL is not set',
        )
      }
      const redirectUrl = assertSafePaymentGatewayUrl(
        `${startUrl}/${encodeURIComponent(authority)}`,
        allowedHosts,
        'payment gateway redirectUrl',
      ).href
      return { authority, redirectUrl }
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
  allowedHosts?: readonly string[]
}): PaymentGateway {
  const fetchImpl = options.fetchImpl ?? (fetch as PaymentGatewayFetch)
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAYMENT_GATEWAY_TIMEOUT_MS
  const requestUrl = options.requestUrl ?? DEFAULT_ZARINPAL_REQUEST_URL
  const startPayUrlRaw = stripTrailingSlash(options.startPayUrl ?? DEFAULT_ZARINPAL_START_PAY_URL)
  const allowedHosts =
    options.allowedHosts ??
    resolvePaymentGatewayAllowedHosts({}, [requestUrl, startPayUrlRaw])

  assertHttpsUrl(requestUrl, 'PAYMENT_GATEWAY_REQUEST_URL')
  const startPayUrl = stripTrailingSlash(
    assertSafePaymentGatewayUrl(
      startPayUrlRaw,
      allowedHosts,
      'PAYMENT_GATEWAY_START_URL',
    ).href,
  )

  return {
    async startPayment(request) {
      const amount = requireSafePositiveAmount(request.amountIrR)
      const res = await fetchImpl(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({
          merchant_id: options.merchantId,
          amount,
          callback_url: request.callbackUrl,
          description: request.description,
          metadata: {
            order_id: request.merchantOrderId,
            idempotency_key: request.idempotencyKey,
          },
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

      const redirectUrl = assertSafePaymentGatewayUrl(
        `${startPayUrl}/${encodeURIComponent(authority)}`,
        allowedHosts,
        'payment gateway redirectUrl',
      ).href
      return { authority, redirectUrl }
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
 * credentials or a public HTTPS callback origin are missing.
 */
export function createPaymentGatewayFromEnv(
  options: CreatePaymentGatewayFromEnvOptions = {},
): PaymentGateway {
  const env = options.env ?? process.env
  const adapter = resolvePaymentGatewayAdapterName(env)
  const timeoutMs = resolveTimeoutMs(env)
  resolvePaymentGatewayCallbackUrl(env)

  if (adapter === 'redirect') {
    if (isProductionEnv(env)) {
      throw new Error(
        'PAYMENT_GATEWAY_ADAPTER=redirect is not allowed in production. Configure zarinpal (PAYMENT_GATEWAY_MERCHANT_ID) or http (PAYMENT_GATEWAY_REQUEST_URL and PAYMENT_GATEWAY_API_KEY).',
      )
    }
    const startUrl = env.PAYMENT_GATEWAY_START_URL?.trim()
    const resolvedStart = startUrl && startUrl.length > 0 ? startUrl : resolvePaymentGatewayStartUrl(env)
    const allowedHosts = resolvePaymentGatewayAllowedHosts(env, [resolvedStart])
    return createRedirectPaymentGateway({
      startUrl: resolvedStart,
      allowedHosts,
    })
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
    const allowedHosts = resolvePaymentGatewayAllowedHosts(env, [
      zarinpalRequestUrl || DEFAULT_ZARINPAL_REQUEST_URL,
      startPayUrl || DEFAULT_ZARINPAL_START_PAY_URL,
    ])
    return createZarinpalPaymentGateway({
      merchantId,
      timeoutMs,
      allowedHosts,
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
  const allowedHosts = resolvePaymentGatewayAllowedHosts(env, [requestUrl, startUrl])
  return createHttpPaymentGateway({
    requestUrl,
    apiKey,
    timeoutMs,
    allowedHosts,
    ...(startUrl ? { startUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
}
