import { describe, it, expect, vi } from 'vitest'
import { OnlineTopUpCallbackController } from './online-topup-callback.controller.js'

vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}))

describe('OnlineTopUpCallbackController (T-04.2.02.02)', () => {
  it('does not credit the wallet on a browser GET redirect', async () => {
    const handle = vi.fn()
    const controller = new OnlineTopUpCallbackController({ handle } as never)
    expect(controller.browserReturn()).toEqual({
      ok: true,
      credited: false,
      reason: 'browser_redirect_ignored',
    })
    expect(handle).not.toHaveBeenCalled()
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
