import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JobProgress } from './JobProgress.js';
import { fetchJobStatus, type JobStatus } from '../../lib/jobs.js';

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
  vi.useFakeTimers();
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(fetchJobStatus).mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
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
