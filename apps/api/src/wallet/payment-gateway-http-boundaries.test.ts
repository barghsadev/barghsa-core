import { expect, it, vi } from 'vitest';
import {
  createHttpPaymentGateway,
  isPaymentGatewayRejectedError,
  type PaymentGatewayFetch,
} from './payment-gateway.js';

const start = {
  amountIrR: 250_000n,
  merchantOrderId: 'order-1',
  idempotencyKey: 'order-1',
  callbackUrl: 'https://app.example.test/callback?orderId=order-1',
  description: 'Wallet top-up',
};
const verify = {
  amountIrR: start.amountIrR,
  merchantOrderId: start.merchantOrderId,
  idempotencyKey: start.idempotencyKey,
  authority: 'provider-authority',
};
function fixture(body: unknown, status = 200) {
  const json = vi.fn().mockResolvedValue(body);
  const fetch = vi
    .fn<PaymentGatewayFetch>()
    .mockResolvedValue({ ok: status >= 200 && status < 300, status, json });
  const gateway = createHttpPaymentGateway({
    requestUrl: 'https://psp.example.test/request',
    inquiryUrl: 'https://psp.example.test/inquiry?tenant=one',
    verifyUrl: 'https://psp.example.test/verify',
    apiKey: 'local-fixture-key',
    fetchImpl: fetch,
  });
  return { gateway, fetch, json };
}

it.each([
  { body: { paid: true, refId: 'ref-1' }, reference: 'ref-1' },
  { body: { status: 'paid', ref_id: 'ref-2' }, reference: 'ref-2' },
  { body: { status: 'OK', providerRefId: 'ref-3' }, reference: 'ref-3' },
  { body: { paid: true }, reference: verify.authority },
  { body: { paid: true, refId: '' }, reference: verify.authority },
])(
  'binds verification to the server amount, order and authority for $body',
  async ({ body, reference }) => {
    const { gateway, fetch } = fixture(body);
    await expect(gateway.verifyPayment(verify)).resolves.toEqual({
      paid: true,
      providerRefId: reference,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://psp.example.test/verify');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer local-fixture-key',
      'X-API-KEY': 'local-fixture-key',
      'Idempotency-Key': start.idempotencyKey,
    });
    expect(JSON.parse(init!.body!)).toEqual({
      authority: verify.authority,
      amount: 250000,
      orderId: start.merchantOrderId,
      idempotencyKey: start.idempotencyKey,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  }
);

it.each([
  { body: null },
  { body: [] },
  { body: 'paid' },
  { body: { paid: 'true' } },
  { body: { paid: 1 } },
  { body: { status: 'OKAY' } },
  { body: { paid: false, refId: 'not-proof' } },
])('does not credit malformed or unsuccessful provider response $body', async ({ body }) => {
  const { gateway } = fixture(body);
  await expect(gateway.verifyPayment(verify)).resolves.toEqual({
    paid: false,
    providerRefId: null,
  });
});

it.each([0n, -1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n])(
  'rejects unsafe amount %s before starting or verifying',
  async (amountIrR) => {
    const { gateway, fetch } = fixture({ paid: true });
    await expect(gateway.startPayment({ ...start, amountIrR })).rejects.toThrow(
      'safe positive integer'
    );
    await expect(gateway.verifyPayment({ ...verify, amountIrR })).rejects.toThrow(
      'safe positive integer'
    );
    expect(fetch).not.toHaveBeenCalled();
  }
);

it.each([400, 401, 403, 404, 422, 408, 429, 500, 503])(
  'distinguishes definite rejection from an uncertain HTTP %i outcome',
  async (status) => {
    const { gateway } = fixture({ error: 'provider error' }, status);
    const error: unknown = await gateway.startPayment(start).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(isPaymentGatewayRejectedError(error)).toBe([400, 401, 403, 404, 422].includes(status));
  }
);

it.each(['startPayment', 'recoverPayment', 'verifyPayment'] as const)(
  'treats invalid JSON in %s as an uncertain failure',
  async (operation) => {
    const { gateway, json } = fixture(null);
    json.mockRejectedValue(new SyntaxError('truncated response'));
    const error: unknown = await gateway[operation]({ ...start, ...verify }).catch(
      (error: unknown) => error
    );
    expect(error).toMatchObject({ message: expect.stringContaining('invalid JSON') });
    expect(isPaymentGatewayRejectedError(error)).toBe(false);
  }
);

it.each(['recoverPayment', 'verifyPayment'] as const)(
  'does not accept an HTTP error body claiming success in %s',
  async (operation) => {
    const { gateway } = fixture(
      { paid: true, authority: 'authority', redirectUrl: 'https://psp.example.test/pay' },
      503
    );
    await expect(gateway[operation]({ ...start, ...verify })).rejects.toThrow('HTTP 503');
  }
);

it.each([404, 204])('treats inquiry HTTP %i as absent without parsing a body', async (status) => {
  const { gateway, json } = fixture(null, status);
  await expect(gateway.recoverPayment(start)).resolves.toBeNull();
  expect(json).not.toHaveBeenCalled();
});

it.each([{ body: null }, { body: [] }, { body: { authority: 42 } }, { body: { authority: '  ' } }])(
  'requires a real authority when recovering $body',
  async ({ body }) => {
    const { gateway } = fixture(body);
    await expect(gateway.recoverPayment(start)).resolves.toBeNull();
    await expect(gateway.startPayment(start)).rejects.toThrow('provider authority');
  }
);

it('recovers a provider session using the merchant identity and reuses it without a second payment request', async () => {
  const session = {
    authority: 'authority-1',
    redirectUrl: 'https://psp.example.test/pay/authority-1',
  };
  const { gateway, fetch } = fixture(session);
  await expect(gateway.recoverPayment(start)).resolves.toEqual(session);
  const inquiry = new URL(fetch.mock.calls[0]![0]);
  expect(inquiry.pathname).toBe('/inquiry');
  expect(Object.fromEntries(inquiry.searchParams)).toEqual({
    tenant: 'one',
    orderId: 'order-1',
    idempotencyKey: 'order-1',
  });
  await expect(gateway.startPayment(start)).resolves.toEqual(session);
  await expect(gateway.recoverPayment(start)).resolves.toEqual(session);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('fails closed without verification configuration or a usable payment redirect', async () => {
  const fetch = vi
    .fn<PaymentGatewayFetch>()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({ authority: 'one' }) });
  const gateway = createHttpPaymentGateway({
    requestUrl: 'https://psp.example.test/request',
    apiKey: 'fixture',
    fetchImpl: fetch,
  });
  await expect(gateway.verifyPayment(verify)).rejects.toThrow('VERIFY_URL is required');
  expect(fetch).not.toHaveBeenCalled();
  await expect(gateway.startPayment(start)).rejects.toThrow('did not include redirectUrl');
});

it.each(['inquiryUrl', 'verifyUrl'] as const)('rejects insecure %s configuration', (key) => {
  expect(() =>
    createHttpPaymentGateway({
      requestUrl: 'https://psp.example.test/request',
      apiKey: 'fixture',
      [key]: 'http://psp.example.test/endpoint',
    })
  ).toThrow('https URL');
});
