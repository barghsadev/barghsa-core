import { describe, it, expect, vi } from 'vitest'
import {
  OnlineTopUpCallbackController,
  readZarinpalReturnQuery,
} from './online-topup-callback.controller.js'

vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}))

describe('OnlineTopUpCallbackController (T-04.2.02.02)', () => {
  it('does not credit the wallet on a GET without ZarinPal return params', async () => {
    const handle = vi.fn()
    const handleZarinpalReturn = vi.fn()
    const controller = new OnlineTopUpCallbackController({
      handle,
      handleZarinpalReturn,
    } as never)
    expect(await controller.browserReturn({})).toEqual({
      ok: true,
      credited: false,
      reason: 'browser_redirect_ignored',
    })
    expect(handle).not.toHaveBeenCalled()
    expect(handleZarinpalReturn).not.toHaveBeenCalled()
  })

  it('does not treat a GET with only orderId as a ZarinPal return', async () => {
    const handleZarinpalReturn = vi.fn()
    const controller = new OnlineTopUpCallbackController({
      handle: vi.fn(),
      handleZarinpalReturn,
    } as never)
    expect(
      await controller.browserReturn({
        orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      }),
    ).toEqual({
      ok: true,
      credited: false,
      reason: 'browser_redirect_ignored',
    })
    expect(handleZarinpalReturn).not.toHaveBeenCalled()
  })

  it('delegates ZarinPal GET returns (orderId, Authority, Status) to the callback service', async () => {
    const handleZarinpalReturn = vi.fn().mockResolvedValue({
      ok: true,
      processed: true,
      credited: true,
      transactionId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      creditTransactionId: 'credit-1',
    })
    const controller = new OnlineTopUpCallbackController({
      handle: vi.fn(),
      handleZarinpalReturn,
    } as never)
    await expect(
      controller.browserReturn({
        orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
        Authority: 'A00000000000000000000000000000000001',
        Status: 'OK',
      }),
    ).resolves.toMatchObject({ credited: true })
    expect(handleZarinpalReturn).toHaveBeenCalledWith({
      orderId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
      authority: 'A00000000000000000000000000000000001',
      status: 'OK',
    })
  })

  it('reads ZarinPal query keys case-insensitively', () => {
    expect(
      readZarinpalReturnQuery({
        ORDERID: 'order-1',
        authority: 'auth-1',
        status: 'NOK',
      }),
    ).toEqual({
      orderId: 'order-1',
      authority: 'auth-1',
      status: 'NOK',
    })
  })

  it('passes raw body and signature headers to the callback service', async () => {
    const handle = vi.fn().mockResolvedValue({
      ok: true,
      processed: true,
      credited: true,
      transactionId: 'tx-1',
      creditTransactionId: 'credit-1',
    })
    const controller = new OnlineTopUpCallbackController({ handle } as never)
    const req = {
      headers: {
        'x-barghsa-event-id': 'evt-1',
        'x-barghsa-timestamp': '1700000000',
        'x-barghsa-signature': 'v1,abc',
      },
      rawBody: Buffer.from('{"status":"paid"}', 'utf8'),
    }
    await expect(controller.receive(req as never)).resolves.toMatchObject({ credited: true })
    expect(handle).toHaveBeenCalledWith({
      headers: { eventId: 'evt-1', timestamp: '1700000000', signature: 'v1,abc' },
      rawBody: '{"status":"paid"}',
    })
  })
})
