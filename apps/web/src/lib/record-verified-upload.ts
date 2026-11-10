import { readWithDeadline } from './server-query-client.js';

export async function recordVerifiedUpload(
  ownerSignal: AbortSignal,
  submit: (signal: AbortSignal) => Promise<Response>
): Promise<Response> {
  const response = await submit(ownerSignal);
  if (!response.ok) return response;
  const receipt = (await readWithDeadline(ownerSignal, () =>
    response
      .clone()
      .json()
      .catch(() => null)
  )) as { status?: unknown; jobId?: unknown } | null;
  if (receipt?.status !== 'pending_scan') return response;
  if (typeof receipt.jobId !== 'string') throw new Error('UPLOAD_FAILED');
  const jobId = receipt.jobId;
  return readWithDeadline(
    ownerSignal,
    async (signal) => {
      const { fetchJobStatus } = await import('./jobs.js');
      for (;;) {
        const job = await readWithDeadline(signal, (request) => fetchJobStatus(jobId, request));
        if (job.status === 'failed') throw new Error('UPLOAD_FAILED');
        if (job.status === 'completed') {
          const recorded = await readWithDeadline(signal, submit);
          if (recorded.ok && (await recorded.clone().json()).status !== 'recorded')
            throw new Error('UPLOAD_FAILED');
          return recorded;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        signal.throwIfAborted();
      }
    },
    90_000
  );
}
