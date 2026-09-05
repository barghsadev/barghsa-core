import { afterEach, describe, expect, it, vi } from 'vitest'
import { PollerGroup } from './poller-group.js'

afterEach(() => vi.useRealTimers())

describe('worker poller shutdown', () => {
  it('waits for every running job, prevents overlap and stops future dispatch', async () => {
    vi.useFakeTimers()
    const group = new PollerGroup(vi.fn())
    let finishDelivery!: () => void
    let finishFinance!: () => void
    const delivery = vi.fn(() => new Promise<void>(resolve => { finishDelivery = resolve }))
    const finance = vi.fn(() => new Promise<void>(resolve => { finishFinance = resolve }))
    group.every(delivery, 1000)
    group.every(finance, 1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(delivery).toHaveBeenCalledTimes(1)
    expect(finance).toHaveBeenCalledTimes(1)
    const poolClosed = vi.fn()
    const shutdown = group.drain().then(poolClosed)
    finishDelivery()
    await vi.advanceTimersByTimeAsync(5000)
    expect(poolClosed).not.toHaveBeenCalled()
    finishFinance()
    await shutdown
    expect(poolClosed).toHaveBeenCalledOnce()
    expect(delivery).toHaveBeenCalledTimes(1)
    expect(finance).toHaveBeenCalledTimes(1)
    expect(() => group.every(delivery, 1000)).toThrow('draining')
  })

  it('contains failures and allows later attempts before draining', async () => {
    vi.useFakeTimers()
    const report = vi.fn()
    const group = new PollerGroup(report)
    const job = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(undefined)
    group.every(job, 1000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(job).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledOnce()
    await group.drain()
  })
})
