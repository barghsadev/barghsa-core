import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobProgress } from './JobProgress.js';
import { fetchJobStatus, retryFailedJob, type JobStatus } from '../../lib/jobs.js';

vi.mock('../../lib/jobs.js', () => ({
  fetchJobStatus: vi.fn(),
  retryFailedJob: vi.fn(),
}));

let host: HTMLElement;
let root: Root;
const status = (state: JobStatus['status'], progress: number): JobStatus => ({
  id: 'job-1',
  type: 'test-export',
  status: state,
  progress_pct: progress,
  result_url: state === 'completed' ? '/account' : null,
  error_message: null,
  created_at: '2026-09-29T00:00:00.000Z',
  started_at: null,
  completed_at: null,
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(fetchJobStatus).mockReset();
  vi.mocked(retryFailedJob).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('polls every two seconds while active and stops after completion', async () => {
  vi.mocked(fetchJobStatus)
    .mockResolvedValueOnce(status('queued', 0))
    .mockResolvedValueOnce(status('processing', 45))
    .mockResolvedValueOnce(status('completed', 100));
  await act(async () => root.render(<JobProgress jobId="job-1" />));
  expect(host.textContent).toContain('Queued');
  expect(fetchJobStatus).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(host.textContent).toContain('In progress');
  await act(async () => vi.advanceTimersByTimeAsync(2_000));
  expect(host.textContent).toContain('Completed');
  expect(host.querySelector('a[href="/account"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(fetchJobStatus).toHaveBeenCalledTimes(3);
});

it('recovers a failed job through the retry endpoint and resumes polling', async () => {
  vi.mocked(fetchJobStatus)
    .mockResolvedValueOnce(status('failed', 25))
    .mockResolvedValueOnce(status('queued', 0));
  vi.mocked(retryFailedJob).mockResolvedValue(status('queued', 0));
  await act(async () => root.render(<JobProgress jobId="job-1" />));
  expect(host.textContent).toContain('Failed');
  const retry = host.querySelector('button')!;
  expect(retry.textContent).toBe('Try again');
  await act(async () => retry.click());
  expect(retryFailedJob).toHaveBeenCalledWith('job-1');
  expect(host.textContent).toContain('Queued');
  expect(fetchJobStatus).toHaveBeenCalledTimes(2);
});

it('recovers a status load failure without submitting a job retry', async () => {
  vi.mocked(fetchJobStatus)
    .mockRejectedValueOnce(new Error('temporary'))
    .mockResolvedValueOnce(status('completed', 100));
  await act(async () => root.render(<JobProgress jobId="job-1" />));
  await act(async () => host.querySelector('button')!.click());
  expect(retryFailedJob).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Completed');
});

it('aborts an old job read and never displays its late result for another job', async () => {
  let finish!: (job: JobStatus) => void;
  vi.mocked(fetchJobStatus)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce({ ...status('processing', 30), id: 'job-2' });
  await act(async () => root.render(<JobProgress jobId="job-1" />));
  const signal = vi.mocked(fetchJobStatus).mock.calls[0]![1]!;
  await act(async () => root.render(<JobProgress jobId="job-2" />));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(status('completed', 100)));
  expect(host.textContent).toContain('30%');
  expect(host.querySelector('a')).toBeNull();
});
