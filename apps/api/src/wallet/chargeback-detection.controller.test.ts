import { describe, it, expect, vi } from 'vitest'
import { ChargebackDetectionController } from './chargeback-detection.controller.js'

vi.mock('../rate-limit/rate-limit.decorator.js', () => ({
  RateLimit: () => () => {},
}))

describe('ChargebackDetectionController (T-04.2.04.02)', () => {
  it('passes raw body and signature headers to the chargeback service', async () => {
    const handle = vi.fn().mockResolvedValue({
      ok: true,
      processed: true,
      mapped: true,
      reversed: true,
      originalTransactionId: 'tx-1',
      reversalTransactionId: 'rev-1',
      matchMethod: 'merchant_order_id',
      status: 'reversed',
    })
    const controller = new ChargebackDetectionController({ handle } as never)
    const req = {
      headers: {
        'x-barghsa-event-id': 'evt-cb-1',
        'x-barghsa-timestamp': '1700000000',
        'x-barghsa-signature': 'v1,abc',
      },
      rawBody: Buffer.from('{"type":"chargeback"}', 'utf8'),
    }
    await expect(controller.receive(req as never)).resolves.toMatchObject({ reversed: true })
    expect(handle).toHaveBeenCalledWith({
      headers: { eventId: 'evt-cb-1', timestamp: '1700000000', signature: 'v1,abc' },
      rawBody: '{"type":"chargeback"}',
    })
  })

  it('passes an empty body when Nest did not populate rawBody', async () => {
    const handle = vi.fn().mockResolvedValue({ ok: true, processed: false })
    const controller = new ChargebackDetectionController({ handle } as never)
    await controller.receive({ headers: {} } as never)
    expect(handle).toHaveBeenCalledWith({
      headers: { eventId: undefined, timestamp: undefined, signature: undefined },
      rawBody: '',
    })
  })
})
