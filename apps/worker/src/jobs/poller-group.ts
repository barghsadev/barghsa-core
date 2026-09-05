/** Owns timers and the promises they start, including failure recording. */
export class PollerGroup {
  private stopping = false
  private readonly timers = new Set<ReturnType<typeof setInterval>>()
  private readonly running = new Set<Promise<void>>()

  constructor(private readonly onError: (error: unknown) => void) {}

  every(job: () => Promise<void>, interval: number): ReturnType<typeof setInterval> {
    if (this.stopping) throw new Error('Worker is draining')
    if (!Number.isFinite(interval) || interval < 1000) throw new Error('Invalid worker interval')
    let active = false
    const timer = setInterval(() => {
      if (this.stopping || active) return
      active = true
      const work = Promise.resolve().then(job).catch(this.onError).finally(() => {
        active = false
        this.running.delete(work)
      })
      this.running.add(work)
    }, interval)
    timer.unref()
    this.timers.add(timer)
    return timer
  }

  async drain(): Promise<void> {
    this.stopping = true
    for (const timer of this.timers) clearInterval(timer)
    this.timers.clear()
    await Promise.allSettled([...this.running])
  }
}
