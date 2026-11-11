import { STORAGE_UPLOAD_SCAN_JOB_TYPE, type ScanVerdict } from '@barghsa/shared/storage';
import type { Pool } from 'pg';
import { Counter, Gauge } from 'prom-client';
import { registry } from '../notifications/worker-metrics.js';

type ScanSource = 'document' | 'upload';

const outcomes = new Counter({
  name: 'barghsa_storage_scan_outcomes_total',
  help: 'Committed scanner verdicts, without object or customer labels',
  labelNames: ['source', 'outcome'] as const,
  registers: [registry],
});

for (const source of ['document', 'upload']) {
  for (const outcome of ['clean', 'infected']) outcomes.labels(source, outcome).inc(0);
}

const backlog = new Gauge({
  name: 'barghsa_storage_scan_backlog',
  help: 'Active storage scan jobs by queue and state',
  labelNames: ['source', 'state'] as const,
  registers: [registry],
});

export function observeScanOutcome(source: ScanSource, outcome: ScanVerdict): void {
  outcomes.inc({ source, outcome });
}

export async function collectStorageScanBacklog(pool: Pick<Pool, 'query'>): Promise<void> {
  // Count active jobs using the same eligibility boundary as each runner.
  const { rows } = await pool.query<{
    source: ScanSource;
    waiting: string;
    processing: string | null;
    retrying: string;
  }>(
    `SELECT 'document' AS source,
       count(*) FILTER (WHERE j.last_error IS NULL) AS waiting,
       NULL::bigint AS processing,
       count(*) FILTER (WHERE j.last_error IS NOT NULL) AS retrying
     FROM document_scan_jobs j JOIN documents d ON d.id=j.document_id
     WHERE j.completed_at IS NULL AND d.state='PendingScan' AND d.storage_key IS NOT NULL
     UNION ALL
     SELECT 'upload',
       count(*) FILTER (WHERE status='queued'),
       count(*) FILTER (WHERE status='processing' AND lease_until>=now()),
       count(*) FILTER (WHERE status='processing' AND lease_until<now())
     FROM async_jobs WHERE type=$1 AND status IN ('queued','processing')`,
    [STORAGE_UPLOAD_SCAN_JOB_TYPE]
  );
  for (const { source, waiting, processing, retrying } of rows) {
    backlog.set({ source, state: 'waiting' }, Number(waiting));
    backlog.set({ source, state: 'retrying' }, Number(retrying));
    if (processing !== null) backlog.set({ source, state: 'processing' }, Number(processing));
  }
}
