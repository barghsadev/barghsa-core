import { afterEach, expect, it, vi } from 'vitest';
import { AiInferenceQueue } from './ai-inference-queue.js';

afterEach(() => vi.useRealTimers());

it('admits at most the configured concurrency and starts waiting requests in FIFO order', async () => {
  const queue = new AiInferenceQueue(1, 1_000, 3);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  const first = queue.run(async () => {
    started.push('first');
    await gate;
    return 'first';
  });
  const second = queue.run(async () => {
    started.push('second');
    return 'second';
  });
  const third = queue.run(async () => {
    started.push('third');
    return 'third';
  });
  expect(queue.snapshot()).toMatchObject({ active: 1, pending: 2, saturated: true });
  expect(started).toEqual(['first']);
  release();
  expect(await Promise.all([first, second, third])).toEqual(['first', 'second', 'third']);
  expect(started).toEqual(['first', 'second', 'third']);
  expect(queue.snapshot()).toMatchObject({ active: 0, pending: 0, rejected: 0 });
});

it('rejects an expired waiter without starting its provider call', async () => {
  vi.useFakeTimers();
  const queue = new AiInferenceQueue(1, 30, 2);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
  const work = vi.fn(async () => undefined);
  const second = queue.run(work);
  const rejected = expect(second).rejects.toMatchObject({ status: 503 });
  await vi.advanceTimersByTimeAsync(31);
  await rejected;
  expect(work).not.toHaveBeenCalled();
  expect(queue.snapshot()).toMatchObject({ active: 1, pending: 0, rejected: 1 });
  release();
  await first;
});

it('rejects overflow immediately and releases capacity after work fails', async () => {
  const queue = new AiInferenceQueue(1, 1_000, 1);
  let release!: () => void;
  const first = queue.run(() => new Promise<void>((resolve) => (release = resolve)));
  const second = queue.run(async () => 'second');
  await expect(queue.run(async () => 'third')).rejects.toMatchObject({ status: 503 });
  expect(queue.snapshot().rejected).toBe(1);
  release();
  await first;
  expect(await second).toBe('second');
  await expect(
    queue.run(async () => {
      throw new Error('provider failed');
    })
  ).rejects.toThrow('provider failed');
  expect(await queue.run(async () => 'recovered')).toBe('recovered');
});
