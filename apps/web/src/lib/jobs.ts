import { withCsrf } from './csrf.js';

export interface JobStatus {
  id: string;
  type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress_pct: number;
  result_url: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function parseJob(value: unknown, id: string): JobStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid job response');
  const job = value as Record<string, unknown>;
  if (
    job.id !== id ||
    typeof job.type !== 'string' ||
    !['queued', 'processing', 'completed', 'failed'].includes(String(job.status)) ||
    !Number.isInteger(job.progress_pct) ||
    Number(job.progress_pct) < 0 ||
    Number(job.progress_pct) > 100 ||
    (job.result_url !== null &&
      (typeof job.result_url !== 'string' ||
        !job.result_url.startsWith('/') ||
        job.result_url.startsWith('//')))
  )
    throw new Error('Invalid job response');
  return job as unknown as JobStatus;
}

export async function fetchJobStatus(id: string, signal?: AbortSignal): Promise<JobStatus> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, {
    credentials: 'include',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Job status HTTP ${response.status}`);
  return parseJob(await response.json(), id);
}

export async function retryFailedJob(id: string): Promise<JobStatus> {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/retry`, {
    method: 'POST',
    credentials: 'include',
    headers: withCsrf(),
  });
  if (!response.ok) throw new Error(`Job retry HTTP ${response.status}`);
  return parseJob(await response.json(), id);
}
