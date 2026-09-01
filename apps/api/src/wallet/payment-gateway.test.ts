import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ONLINE_TOPUP_CALLBACK_PATH,
  assertSafePaymentGatewayUrl,
  createHttpPaymentGateway,
  createPaymentGatewayFromEnv,
  createRedirectPaymentGateway,
  createZarinpalPaymentGateway,
  resolvePaymentGatewayAdapterName,
  resolvePaymentGatewayAllowedHosts,
  resolvePaymentGatewayCallbackUrl,
  resolvePaymentGatewayStartUrl,
  type PaymentGatewayFetch,
} from './payment-gateway.js'

const START_REQUEST = {
  amountIrR: 250_000n,
  merchantOrderId: 'tx-001',
  description: 'Online wallet top-up',
  callbackUrl: 'http://localhost:4000/api/wallet/top-ups/callback',
}

const PRODUCTION_CALLBACK_ENV = {
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.barghsa.test',
} as const

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
    const result = await gateway.startPayment(START_REQUEST)

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
    const first = await gateway.startPayment(START_REQUEST)
    const second = await gateway.startPayment(START_REQUEST)
    expect(first.authority).not.toBe(second.authority)
  })

  it('rejects a non-https configured start URL', () => {
    expect(() =>
      createRedirectPaymentGateway({ startUrl: 'http://pay.example.test/checkout' }),
    ).toThrow(/https URL/)
  })

  it('resolves start and callback URLs from the supplied environment', () => {
    expect(resolvePaymentGatewayStartUrl({})).toBe('https://pay.sandbox.local/start')
    expect(resolvePaymentGatewayCallbackUrl({ NODE_ENV: 'development' })).toBe(
      `http://localhost:4000${ONLINE_TOPUP_CALLBACK_PATH}`,
    )

    expect(
      resolvePaymentGatewayStartUrl({ PAYMENT_GATEWAY_START_URL: 'https://psp.test/pay' }),
    ).toBe('https://psp.test/pay')
    expect(
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'development',
        API_PUBLIC_URL: 'https://api.barghsa.test/',
      }),
    ).toBe(`https://api.barghsa.test${ONLINE_TOPUP_CALLBACK_PATH}`)
  })
})

describe('resolvePaymentGatewayCallbackUrl (T-04.2.02.01)', () => {
  it('fails production startup when the public origin is missing', () => {
    expect(() => resolvePaymentGatewayCallbackUrl({ NODE_ENV: 'production' })).toThrow(
      /API_PUBLIC_URL or APP_PUBLIC_URL is required in production/,
    )
  })

  it('fails production startup when the public origin is malformed', () => {
    expect(() =>
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        API_PUBLIC_URL: 'not-a-url',
      }),
    ).toThrow(/not a valid absolute URL/)
  })

  it('fails production startup when the public origin is not https', () => {
    expect(() =>
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        API_PUBLIC_URL: 'http://api.barghsa.test',
      }),
    ).toThrow(/public https origin/)
  })

  it('fails production startup when the public origin is localhost', () => {
    expect(() =>
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        API_PUBLIC_URL: 'https://localhost:4000',
      }),
    ).toThrow(/public hostname/)
  })

  it('fails production startup when the public origin is an IP address', () => {
    expect(() =>
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        APP_PUBLIC_URL: 'https://127.0.0.1',
      }),
    ).toThrow(/public hostname/)
  })

  it('fails when the public origin includes credentials', () => {
    expect(() =>
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        API_PUBLIC_URL: 'https://user:pass@api.barghsa.test',
      }),
    ).toThrow(/must not include credentials/)
  })

  it('accepts a valid production https origin from API_PUBLIC_URL', () => {
    expect(
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        API_PUBLIC_URL: 'https://api.barghsa.test/',
      }),
    ).toBe(`https://api.barghsa.test${ONLINE_TOPUP_CALLBACK_PATH}`)
  })

  it('accepts a valid production https origin from APP_PUBLIC_URL', () => {
    expect(
      resolvePaymentGatewayCallbackUrl({
        NODE_ENV: 'production',
        APP_PUBLIC_URL: 'https://app.barghsa.test:8443',
      }),
    ).toBe(`https://app.barghsa.test:8443${ONLINE_TOPUP_CALLBACK_PATH}`)
  })
})

describe('payment gateway URL allow-list (T-04.2.02.01)', () => {
  it('collects hosts from env and configured URLs', () => {
    expect(
      resolvePaymentGatewayAllowedHosts(
        { PAYMENT_GATEWAY_ALLOWED_HOSTS: 'pay.psp.test, Checkout.PSP.test.' },
        ['https://payment.zarinpal.com/pg/StartPay', 'https://psp.test/v1/payments'],
      ),
    ).toEqual(['pay.psp.test', 'checkout.psp.test', 'payment.zarinpal.com', 'psp.test'])
  })

  it('rejects credentials, unsupported schemes, and unexpected hosts', () => {
    const allowed = ['psp.test']
    expect(() =>
      assertSafePaymentGatewayUrl('javascript:alert(1)', allowed, 'redirect'),
    ).toThrow(/unsupported URL scheme/)
    expect(() =>
      assertSafePaymentGatewayUrl('data:text/html,phish', allowed, 'redirect'),
    ).toThrow(/unsupported URL scheme/)
    expect(() =>
      assertSafePaymentGatewayUrl('http://psp.test/pay', allowed, 'redirect'),
    ).toThrow(/https URL/)
    expect(() =>
      assertSafePaymentGatewayUrl('https://user:pass@psp.test/pay', allowed, 'redirect'),
    ).toThrow(/credentials/)
    expect(() =>
      assertSafePaymentGatewayUrl('https://evil.test/phish', allowed, 'redirect'),
    ).toThrow(/allow-list/)
    expect(assertSafePaymentGatewayUrl('https://psp.test/pay', allowed, 'redirect').href).toBe(
      'https://psp.test/pay',
    )
  })
})

describe('ZarinPal payment gateway (T-04.2.02.01)', () => {
  it('authenticates with merchant_id and returns the provider authority and StartPay URL', async () => {
    const fetchImpl: PaymentGatewayFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { code: 100, authority: 'A00000000000000000000000000000000001', message: 'Success' },
        errors: [],
      }),
    })

    const gateway = createZarinpalPaymentGateway({
      merchantId: '11111111-1111-1111-1111-111111111111',
      fetchImpl,
    })
    const result = await gateway.startPayment(START_REQUEST)

    expect(result.authority).toBe('A00000000000000000000000000000000001')
    expect(result.redirectUrl).toBe(
      'https://payment.zarinpal.com/pg/StartPay/A00000000000000000000000000000000001',
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://payment.zarinpal.com/pg/v4/payment/request.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
    const posted = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string)
    expect(posted).toEqual({
      merchant_id: '11111111-1111-1111-1111-111111111111',
      amount: 250000,
      callback_url: START_REQUEST.callbackUrl,
      description: START_REQUEST.description,
      metadata: { order_id: 'tx-001' },
    })
  })

  it('rejects a provider error payload', async () => {
    const gateway = createZarinpalPaymentGateway({
      merchantId: '11111111-1111-1111-1111-111111111111',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {},
          errors: { code: -9, message: 'Merchant is invalid' },
        }),
      }),
    })
    await expect(gateway.startPayment(START_REQUEST)).rejects.toThrow(/Merchant is invalid/)
  })

  it('rejects a non-https configured StartPay URL', () => {
    expect(() =>
      createZarinpalPaymentGateway({
        merchantId: '11111111-1111-1111-1111-111111111111',
        startPayUrl: 'http://payment.zarinpal.com/pg/StartPay',
      }),
    ).toThrow(/https URL/)
  })
})

describe('HTTP payment gateway (T-04.2.02.01)', () => {
  it('sends a Bearer-authenticated request and returns the provider session', async () => {
    const fetchImpl: PaymentGatewayFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        authority: 'psp-auth-9',
        redirectUrl: 'https://psp.test/pay/psp-auth-9',
      }),
    })
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      fetchImpl,
    })
    const result = await gateway.startPayment(START_REQUEST)
    expect(result).toEqual({
      authority: 'psp-auth-9',
      redirectUrl: 'https://psp.test/pay/psp-auth-9',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://psp.test/v1/payments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-key',
          'X-API-KEY': 'secret-key',
        }),
      }),
    )
    const posted = JSON.parse((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string)
    expect(posted).toEqual({
      amount: 250000,
      orderId: 'tx-001',
      callbackUrl: START_REQUEST.callbackUrl,
      description: START_REQUEST.description,
    })
  })

  it('builds redirectUrl from startUrl when the provider omits it', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      startUrl: 'https://psp.test/pay',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ authority: 'auth-only' }),
      }),
    })
    const result = await gateway.startPayment(START_REQUEST)
    expect(result.redirectUrl).toBe('https://psp.test/pay/auth-only')
  })

  it('rejects a javascript: provider redirect', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authority: 'psp-auth-9',
          redirectUrl: 'javascript:alert(1)',
        }),
      }),
    })
    await expect(gateway.startPayment(START_REQUEST)).rejects.toThrow(/unsupported URL scheme/)
  })

  it('rejects an http provider redirect', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authority: 'psp-auth-9',
          redirectUrl: 'http://psp.test/pay',
        }),
      }),
    })
    await expect(gateway.startPayment(START_REQUEST)).rejects.toThrow(/https URL/)
  })

  it('rejects a provider redirect that includes credentials', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authority: 'psp-auth-9',
          redirectUrl: 'https://user:pass@psp.test/pay',
        }),
      }),
    })
    await expect(gateway.startPayment(START_REQUEST)).rejects.toThrow(/credentials/)
  })

  it('rejects a provider redirect whose host is not allow-listed', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://psp.test/v1/payments',
      apiKey: 'secret-key',
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authority: 'psp-auth-9',
          redirectUrl: 'https://evil.example/phish',
        }),
      }),
    })
    await expect(gateway.startPayment(START_REQUEST)).rejects.toThrow(/allow-list/)
  })

  it('allows a checkout host listed in PAYMENT_GATEWAY_ALLOWED_HOSTS', async () => {
    const gateway = createHttpPaymentGateway({
      requestUrl: 'https://api.psp.test/v1/payments',
      apiKey: 'secret-key',
      allowedHosts: ['api.psp.test', 'pay.psp.test'],
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          authority: 'psp-auth-9',
          redirectUrl: 'https://pay.psp.test/session/psp-auth-9',
        }),
      }),
    })
    const result = await gateway.startPayment(START_REQUEST)
    expect(result.redirectUrl).toBe('https://pay.psp.test/session/psp-auth-9')
  })

  it('rejects a non-https configured start URL', () => {
    expect(() =>
      createHttpPaymentGateway({
        requestUrl: 'https://psp.test/v1/payments',
        apiKey: 'secret-key',
        startUrl: 'http://psp.test/pay',
      }),
    ).toThrow(/https URL/)
  })
})

describe('createPaymentGatewayFromEnv (T-04.2.02.01)', () => {
  it('defaults to redirect outside production', () => {
    expect(resolvePaymentGatewayAdapterName({ NODE_ENV: 'development' })).toBe('redirect')
    expect(resolvePaymentGatewayAdapterName({ NODE_ENV: 'test' })).toBe('redirect')
    const gateway = createPaymentGatewayFromEnv({
      env: { NODE_ENV: 'development' },
    })
    expect(gateway.startPayment).toEqual(expect.any(Function))
  })

  it('refuses the redirect adapter in production', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: { ...PRODUCTION_CALLBACK_ENV, PAYMENT_GATEWAY_ADAPTER: 'redirect' },
      }),
    ).toThrow(/not allowed in production/)
  })

  it('fails production startup when the callback origin is missing', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: {
          NODE_ENV: 'production',
          PAYMENT_GATEWAY_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
        },
      }),
    ).toThrow(/API_PUBLIC_URL or APP_PUBLIC_URL is required in production/)
  })

  it('fails production startup when the callback origin is malformed', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: {
          NODE_ENV: 'production',
          API_PUBLIC_URL: '://bad',
          PAYMENT_GATEWAY_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
        },
      }),
    ).toThrow(/not a valid absolute URL/)
  })

  it('fails production startup when zarinpal credentials are missing', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: { ...PRODUCTION_CALLBACK_ENV },
      }),
    ).toThrow(/PAYMENT_GATEWAY_MERCHANT_ID/)
  })

  it('fails when the http adapter is selected without request URL and API key', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: { ...PRODUCTION_CALLBACK_ENV, PAYMENT_GATEWAY_ADAPTER: 'http' },
      }),
    ).toThrow(/PAYMENT_GATEWAY_REQUEST_URL/)
  })

  it('registers zarinpal when merchant id and a public https callback origin are present', async () => {
    const fetchImpl: PaymentGatewayFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { code: 100, authority: 'A00000000000000000000000000000000002' },
        errors: [],
      }),
    })
    const gateway = createPaymentGatewayFromEnv({
      env: {
        ...PRODUCTION_CALLBACK_ENV,
        PAYMENT_GATEWAY_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
      },
      fetchImpl,
    })
    const result = await gateway.startPayment(START_REQUEST)
    expect(result.authority).toBe('A00000000000000000000000000000000002')
  })

  it('fails production http adapter startup when the start URL is not https', () => {
    expect(() =>
      createPaymentGatewayFromEnv({
        env: {
          ...PRODUCTION_CALLBACK_ENV,
          PAYMENT_GATEWAY_ADAPTER: 'http',
          PAYMENT_GATEWAY_REQUEST_URL: 'https://psp.test/v1/payments',
          PAYMENT_GATEWAY_API_KEY: 'secret-key',
          PAYMENT_GATEWAY_START_URL: 'http://psp.test/pay',
        },
      }),
    ).toThrow(/https URL/)
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
