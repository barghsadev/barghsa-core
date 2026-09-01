import { randomUUID } from 'node:crypto'

/**
 * Payment gateway port used by online wallet top-up initiation
 * (T-04.2.02.01 / S-04.2.02).
 *
 * Initiation only starts a provider session and returns a browser
 * redirect URL. Wallet credit happens later in the authenticated
 * callback handler (T-04.2.02.02) — the redirect itself is not proof
 * of payment.
 */

/** Nest injection token for the payment gateway adapter. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY')

/** Path the provider will call after payment (implemented in T-04.2.02.02). */
export const ONLINE_TOPUP_CALLBACK_PATH = '/api/wallet/top-ups/callback'

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

/**
 * Redirect-style adapter: builds a hosted-checkout URL without talking
 * to a live PSP. A production adapter will replace this factory while
 * keeping the same {@link PaymentGateway} contract.
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
