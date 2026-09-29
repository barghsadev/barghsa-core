import { afterEach, expect, it, vi } from 'vitest';
import { fetchJobStatus, retryFailedJob } from './jobs.js';

const job = {
  id: 'job-1',
  type: 'test-export',
  status: 'completed',
  progress_pct: 100,
  result_url: '/account',
  error_message: null,
  created_at: '2026-09-29T00:00:00.000Z',
  started_at: null,
  completed_at: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; Path=/';
});

it('accepts an owner-scoped job and refuses an external result link', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => job })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...job, result_url: '//outside.test' }),
    });
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchJobStatus('job-1')).toMatchObject({
    status: 'completed',
    result_url: '/account',
  });
  await expect(fetchJobStatus('job-1')).rejects.toThrow('Invalid job response');
  expect(fetcher).toHaveBeenCalledWith('/api/jobs/job-1', { credentials: 'include' });
});

it('sends the current CSRF proof when retrying a failed job', async () => {
  document.cookie = 'barghsa_csrf=proof; Path=/';
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...job, status: 'queued', progress_pct: 0, result_url: null }),
  });
  vi.stubGlobal('fetch', fetcher);
  expect((await retryFailedJob('job-1')).status).toBe('queued');
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  expect(options.method).toBe('POST');
  expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('proof');
});
