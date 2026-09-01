import { afterEach, describe, expect, it } from 'vitest'
import {
  ONLINE_TOPUP_CALLBACK_PATH,
  createRedirectPaymentGateway,
  resolvePaymentGatewayCallbackUrl,
  resolvePaymentGatewayStartUrl,
} from './payment-gateway.js'

describe('RedirectPaymentGateway (T-04.2.02.01)', () => {
  const originalStart = process.env.PAYMENT_GATEWAY_START_URL
  const originalApi = process.env.API_PUBLIC_URL
  const originalApp = process.env.APP_PUBLIC_URL

  afterEach(() => {
    restoreEnv('PAYMENT_GATEWAY_START_URL', originalStart)
    restoreEnv('API_PUBLIC_URL', originalApi)
    restoreEnv('APP_PUBLIC_URL', originalApp)
  })

  it('builds a redirect URL with authority, amount, order id, and callback', async () => {
    const gateway = createRedirectPaymentGateway({
      startUrl: 'https://pay.example.test/checkout',
    })
    const result = await gateway.startPayment({
      amountIrR: 250_000n,
      merchantOrderId: 'tx-001',
      description: 'Online wallet top-up',
      callbackUrl: 'http://localhost:4000/api/wallet/top-ups/callback',
    })

    expect(result.authority).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    const url = new URL(result.redirectUrl)
    expect(url.origin + url.pathname).toBe('https://pay.example.test/checkout')
    expect(url.searchParams.get('authority')).toBe(result.authority)
    expect(url.searchParams.get('amount')).toBe('250000')
    expect(url.searchParams.get('orderId')).toBe('tx-001')
    expect(url.searchParams.get('callbackUrl')).toBe(
      'http://localhost:4000/api/wallet/top-ups/callback',
    )
  })

  it('issues a distinct authority on every start', async () => {
    const gateway = createRedirectPaymentGateway({
      startUrl: 'https://pay.example.test/checkout',
    })
    const request = {
      amountIrR: 1n,
      merchantOrderId: 'tx-a',
      description: 'Online wallet top-up',
      callbackUrl: 'http://localhost:4000/cb',
    }
    const first = await gateway.startPayment(request)
    const second = await gateway.startPayment(request)
    expect(first.authority).not.toBe(second.authority)
  })

  it('resolves start and callback URLs from env with documented defaults', () => {
    delete process.env.PAYMENT_GATEWAY_START_URL
    delete process.env.API_PUBLIC_URL
    delete process.env.APP_PUBLIC_URL
    expect(resolvePaymentGatewayStartUrl()).toBe('https://pay.sandbox.local/start')
    expect(resolvePaymentGatewayCallbackUrl()).toBe(
      `http://localhost:4000${ONLINE_TOPUP_CALLBACK_PATH}`,
    )

    process.env.PAYMENT_GATEWAY_START_URL = 'https://psp.test/pay'
    process.env.API_PUBLIC_URL = 'https://api.barghsa.test/'
    expect(resolvePaymentGatewayStartUrl()).toBe('https://psp.test/pay')
    expect(resolvePaymentGatewayCallbackUrl()).toBe(
      `https://api.barghsa.test${ONLINE_TOPUP_CALLBACK_PATH}`,
    )
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
