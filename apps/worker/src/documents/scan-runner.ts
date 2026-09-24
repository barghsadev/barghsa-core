import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';
import { enqueueOutbox } from '../notifications/outbox-writer.js';
import { scanWithClamAv, type ScannerEndpoint, type ScanVerdict } from './clamav.js';

type ScanRow = {
  document_id: string;
  attempts: number;
  storage_key: string;
  checksum: string;
  size_bytes: string;
  supersedes_document_id: string | null;
  uploaded_by: string;
  original_name: string;
};

const MAX_SCAN_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_SCAN_INTERVAL_MS = 10_000;
export const DOCUMENT_SCAN_JOB_TYPE = 'document_scan';

async function readBytes(storage: StorageProvider, row: ScanRow) {
  const object = await storage.getObject(row.storage_key);
  if (object.contentLength && object.contentLength > MAX_SCAN_BYTES)
    throw new Error('document_scan_size_mismatch');
  const reader = object.body.getReader();
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SCAN_BYTES) throw new Error('document_scan_size_mismatch');
      const chunk = Buffer.from(value);
      hash.update(chunk);
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel();
  }
  if (size !== Number(row.size_bytes) || hash.digest('hex') !== row.checksum)
    throw new Error('document_scan_checksum_mismatch');
  return Buffer.concat(chunks);
}

async function event(
  client: PoolClient,
  documentId: string,
  revision: number,
  previousState: string,
  state: string,
  actorId: string,
  reason: string
) {
  await client.query(
    `INSERT INTO document_events(id,document_id,revision,previous_state,state,actor_id,reason)
     VALUES(uuid_generate_v7(),$1,$2,$3,$4,$5,$6)`,
    [documentId, revision, previousState, state, actorId, reason]
  );
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES(uuid_generate_v7(),$1,'document_scan_resolved',$2::jsonb,uuid_generate_v7(),'worker')`,
    [actorId, JSON.stringify({ documentId, previousState, state, revision, reason })]
  );
}

async function alertAdmins(client: PoolClient, row: ScanRow, eventKey: string) {
  const admins = await client.query<{ user_id: string; locale: string }>(
    `SELECT user_id,locale FROM users WHERE is_staff=true AND is_admin=true AND disabled_at IS NULL`
  );
  for (const admin of admins.rows) {
    const reason =
      eventKey === 'document.quarantined'
        ? admin.locale === 'fa'
          ? 'بدافزار شناسایی شد'
          : 'Malware detected'
        : admin.locale === 'fa'
          ? 'اسکنر در دسترس نیست؛ تلاش دوباره برنامه‌ریزی شد'
          : 'Scanner unavailable; retry pending';
    await enqueueOutbox(client, {
      profileId: null,
      userId: admin.user_id,
      eventKey,
      payload: { documentName: row.original_name, reason },
      channels: ['in_app'],
      idempotencyKey: `${eventKey}:${row.document_id}:${admin.user_id}`,
      priority: 'urgent',
    });
  }
}

async function retry(pool: Pool, row: ScanRow, reason: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attempts = row.attempts + 1;
    const delay = Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7));
    const updated = await client.query(
      `UPDATE document_scan_jobs SET attempts=attempts+1,last_error=$2,
       next_attempt_at=NOW()+($3::int * interval '1 second')
       WHERE document_id=$1 AND completed_at IS NULL AND attempts=$4 RETURNING document_id`,
      [row.document_id, reason, delay, row.attempts]
    );
    if (updated.rowCount && attempts === 3) await alertAdmins(client, row, 'document.scan_failed');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolve(client: PoolClient, row: ScanRow, verdict: ScanVerdict) {
  if (verdict === 'clean' && row.supersedes_document_id) {
    const previous = (
      await client.query<{ state: string; revision: number }>(
        'SELECT state,revision FROM documents WHERE id=$1 FOR UPDATE',
        [row.supersedes_document_id]
      )
    ).rows[0];
    if (!previous) throw new Error('document_scan_predecessor_missing');
    const changed = (
      await client.query<{ revision: number }>(
        "UPDATE documents SET state='Superseded' WHERE id=$1 RETURNING revision",
        [row.supersedes_document_id]
      )
    ).rows[0]!;
    await event(
      client,
      row.supersedes_document_id,
      changed.revision,
      previous.state,
      'Superseded',
      row.uploaded_by,
      'automated_scan_replacement'
    );
  }
  const state = verdict === 'clean' ? 'Available' : 'Quarantined';
  const changed = (
    await client.query<{ revision: number }>(
      `UPDATE documents SET state=$2,scan_state=$3,scan_skipped_reason=NULL
       WHERE id=$1 AND state='PendingScan' RETURNING revision`,
      [row.document_id, state, verdict === 'clean' ? 'Available' : 'Quarantined']
    )
  ).rows[0];
  if (!changed) throw new Error('document_scan_state_changed');
  await event(
    client,
    row.document_id,
    changed.revision,
    'PendingScan',
    state,
    row.uploaded_by,
    verdict === 'clean' ? 'automated_scan_clean' : 'automated_scan_infected'
  );
  if (verdict === 'infected') await alertAdmins(client, row, 'document.quarantined');
  await client.query(
    `UPDATE document_scan_jobs SET attempts=attempts+1,verdict=$2,completed_at=NOW(),
     last_error=NULL WHERE document_id=$1 AND completed_at IS NULL`,
    [row.document_id, verdict]
  );
}

/** Process a small due batch; every result and alert commits with the document transition. */
export async function runDocumentScans(
  pool: Pool,
  storage: StorageProvider,
  endpoint: ScannerEndpoint,
  scan: typeof scanWithClamAv = scanWithClamAv
) {
  const candidates = await pool.query<{ document_id: string }>(
    `SELECT j.document_id FROM document_scan_jobs j JOIN documents d ON d.id=j.document_id
     WHERE j.completed_at IS NULL AND j.next_attempt_at<=NOW() AND d.state='PendingScan'
       AND d.storage_key IS NOT NULL ORDER BY j.next_attempt_at,j.document_id LIMIT 5`
  );
  const result = { clean: 0, infected: 0, retrying: 0 };
  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    let row: ScanRow | undefined;
    try {
      await client.query('BEGIN');
      row = (
        await client.query<ScanRow>(
          `SELECT j.document_id,j.attempts,d.storage_key,d.checksum,d.size_bytes,
            d.supersedes_document_id,d.uploaded_by,d.original_name
           FROM document_scan_jobs j JOIN documents d ON d.id=j.document_id
           WHERE j.document_id=$1 AND j.completed_at IS NULL AND j.next_attempt_at<=NOW()
             AND d.state='PendingScan' AND d.storage_key IS NOT NULL
           FOR UPDATE OF j,d SKIP LOCKED`,
          [candidate.document_id]
        )
      ).rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        continue;
      }
      const bytes = await readBytes(storage, row);
      const verdict = await scan(bytes, endpoint);
      await resolve(client, row, verdict);
      await client.query('COMMIT');
      result[verdict === 'clean' ? 'clean' : 'infected']++;
    } catch {
      await client.query('ROLLBACK');
      if (row) {
        await retry(pool, row, 'scan_processing_failed');
        result.retrying++;
      }
    } finally {
      client.release();
    }
  }
  return result;
}
