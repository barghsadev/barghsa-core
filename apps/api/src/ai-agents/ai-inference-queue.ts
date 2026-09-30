import { HttpException } from '@nestjs/common';

export interface AiInferenceQueueSnapshot {
  active: number;
  pending: number;
  maxConcurrency: number;
  maxPending: number;
  queueTimeoutMs: number;
  rejected: number;
  saturated: boolean;
}

interface WaitingRequest {
  start: () => void;
  timer: ReturnType<typeof setTimeout>;
}

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

/** FIFO admission gate for AI calls in one API process. Pending calls hold no DB connection. */
export class AiInferenceQueue {
  private active = 0;
  private rejected = 0;
  private readonly pending: WaitingRequest[] = [];

  constructor(
    readonly maxConcurrency = positiveInteger(process.env.AI_INFERENCE_MAX_CONCURRENCY, 10, 100),
    readonly queueTimeoutMs = positiveInteger(
      process.env.AI_INFERENCE_QUEUE_TIMEOUT_MS,
      30_000,
      60_000
    ),
    readonly maxPending = positiveInteger(process.env.AI_INFERENCE_MAX_PENDING, 100, 1_000)
  ) {}

  snapshot(): AiInferenceQueueSnapshot {
    return {
      active: this.active,
      pending: this.pending.length,
      maxConcurrency: this.maxConcurrency,
      maxPending: this.maxPending,
      queueTimeoutMs: this.queueTimeoutMs,
      rejected: this.rejected,
      saturated: this.active >= this.maxConcurrency,
    };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency || this.pending.length > 0) {
      if (this.pending.length >= this.maxPending) {
        this.rejected += 1;
        throw this.busy();
      }
      await new Promise<void>((resolve, reject) => {
        const waiting: WaitingRequest = {
          start: resolve,
          timer: setTimeout(() => {
            const index = this.pending.indexOf(waiting);
            if (index < 0) return;
            this.pending.splice(index, 1);
            this.rejected += 1;
            reject(this.busy());
          }, this.queueTimeoutMs),
        };
        this.pending.push(waiting);
      });
    } else {
      this.active += 1;
    }
    try {
      return await work();
    } finally {
      this.active -= 1;
      const next = this.pending.shift();
      if (next) {
        clearTimeout(next.timer);
        this.active += 1;
        next.start();
      }
    }
  }

  private busy(): HttpException {
    return new HttpException({ statusCode: 503, error: 'AI_INFERENCE_BUSY' }, 503);
  }
}

export const aiInferenceQueue = new AiInferenceQueue();
