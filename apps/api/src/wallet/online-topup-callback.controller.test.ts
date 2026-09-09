import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  OnlineTopUpCallbackController,
  readZarinpalReturnQuery,
} from './online-topup-callback.controller.js';

vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}));

describe('OnlineTopUpCallbackController (T-04.2.02.02)', () => {
  beforeEach(() => vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.test'));
  afterEach(() => vi.unstubAllEnvs());
  it('does not credit the wallet on a GET without ZarinPal return params', async () => {
    const handle = vi.fn();
    const handleZarinpalReturn = vi.fn();
    const controller = new OnlineTopUpCallbackController({
      handle,
      handleZarinpalReturn,
    } as never);
    expect(await controller.browserReturn({})).toEqual({
      url: 'https://app.example.test/wallet',
    });
    expect(handle).not.toHaveBeenCalled();
    expect(handleZarinpalReturn).not.toHaveBeenCalled();
  });

  it('does not treat a GET with only orderId as a ZarinPal return', async () => {
    const handleZarinpalReturn = vi.fn();
    const controller = new OnlineTopUpCallbackController({
      handle: vi.fn(),
      handleZarinpalReturn,
    } as never);
    expect(
      await controller.browserReturn({
        orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      })
    ).toEqual({
      url: 'https://app.example.test/wallet',
    });
    expect(handleZarinpalReturn).not.toHaveBeenCalled();
  });

  it('redirects a complete GET to confirmation without calling the service', () => {
    const handleZarinpalReturn = vi.fn();
    const controller = new OnlineTopUpCallbackController({ handleZarinpalReturn } as never);
    const result = controller.browserReturn({
      orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      Authority: 'auth-1',
      Status: 'NOK',
    });
    const url = new URL(result.url);
    expect(url.origin).toBe('https://app.example.test');
    expect(url.searchParams.get('paymentAuthority')).toBe('auth-1');
    expect(handleZarinpalReturn).not.toHaveBeenCalled();
  });

  it('POST binds the trusted actor and always requests provider verification', async () => {
    const handleZarinpalReturn = vi.fn().mockResolvedValue({ credited: true });
    const controller = new OnlineTopUpCallbackController({ handleZarinpalReturn } as never);
    const body = { orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', authority: 'auth-1' };
    const session = { userId: 'user', sessionId: 'session', csrfToken: 'csrf' };
    await controller.confirmReturn(body, { session } as never);
    expect(handleZarinpalReturn).toHaveBeenCalledWith({ ...body, status: 'OK' }, session);
    await expect(
      controller.confirmReturn({ ...body, status: 'NOK' }, { session } as never)
    ).rejects.toMatchObject({ status: 400 });
    expect(handleZarinpalReturn).toHaveBeenCalledTimes(1);
  });

  it('reads ZarinPal query keys case-insensitively', () => {
    expect(
      readZarinpalReturnQuery({
        ORDERID: 'order-1',
        authority: 'auth-1',
        status: 'NOK',
      })
    ).toEqual({
      orderId: 'order-1',
      authority: 'auth-1',
      status: 'NOK',
    });
  });

  it('passes raw body and signature headers to the callback service', async () => {
    const handle = vi.fn().mockResolvedValue({
      ok: true,
      processed: true,
      credited: true,
      transactionId: 'tx-1',
      creditTransactionId: 'credit-1',
    });
    const controller = new OnlineTopUpCallbackController({ handle } as never);
    const req = {
      headers: {
        'x-barghsa-event-id': 'evt-1',
        'x-barghsa-timestamp': '1700000000',
        'x-barghsa-signature': 'v1,abc',
      },
      rawBody: Buffer.from('{"status":"paid"}', 'utf8'),
    };
    await expect(controller.receive(req as never)).resolves.toMatchObject({ credited: true });
    expect(handle).toHaveBeenCalledWith({
      headers: { eventId: 'evt-1', timestamp: '1700000000', signature: 'v1,abc' },
      rawBody: '{"status":"paid"}',
    });
  });
});
