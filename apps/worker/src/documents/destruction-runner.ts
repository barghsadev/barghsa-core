import type { Pool, PoolClient } from 'pg';
import type { StorageProvider } from '@barghsa/shared/storage';

export const DOCUMENT_DESTRUCTION_JOB_TYPE = 'document_destruction';
export const DOCUMENT_DESTRUCTION_POLL_INTERVAL_MS = 60 * 60 * 1000;

type Item = {
  id: string;
  document_id: string;
  profile_id: string;
  policy_id: string;
  storage_key: string;
  upload_key: string;
  retention_deadline: Date;
  status: string;
};
type DocumentRow = {
  id: string;
  profile_id: string;
  business_record_type: string;
  storage_key: string | null;
  upload_key: string;
  state: string;
  uploaded_by: string;
};

async function audit(
  client: PoolClient,
  userId: string,
  event: string,
  itemId: string,
  documentId: string
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
     VALUES(uuid_generate_v7(),$1,$2,$3::jsonb,uuid_generate_v7(),'worker')`,
    [userId, event, JSON.stringify({ itemId, documentId })]
  );
}

/** Record small, immutable approval candidates; no object is deleted by planning. */
export async function planDocumentDestruction(pool: Pool, limit = 25) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query<{ id: string; document_id: string }>(
      `INSERT INTO document_destruction_items
        (document_id,profile_id,policy_id,storage_key,upload_key,retention_deadline)
       SELECT d.id,d.profile_id,e.policy_id,d.storage_key,d.upload_key,e.retention_deadline
       FROM documents d
       CROSS JOIN LATERAL document_retention_eligibility(d.id) e
       WHERE d.state='Removed' AND d.storage_key IS NOT NULL
         AND e.retention_deadline<=NOW() AND NOT document_is_held(d.id)
         AND NOT EXISTS (
           SELECT 1 FROM document_destruction_items prior
           WHERE prior.document_id=d.id AND prior.status IN ('pending_approval','approved','destroying','destroyed')
         )
       ORDER BY e.retention_deadline,d.id LIMIT $1
       ON CONFLICT DO NOTHING
       RETURNING id,document_id`,
      [limit]
    );
    for (const item of created.rows) {
      const owner = (
        await client.query<{ uploaded_by: string }>(
          'SELECT uploaded_by FROM documents WHERE id=$1',
          [item.document_id]
        )
      ).rows[0]!;
      await audit(
        client,
        owner.uploaded_by,
        'document_destruction_planned',
        item.id,
        item.document_id
      );
    }
    await client.query('COMMIT');
    return created.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function lockedItem(client: PoolClient, candidate: Item) {
  await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [candidate.profile_id]);
  const document = (
    await client.query<DocumentRow>(
      'SELECT id,profile_id,business_record_type,storage_key,upload_key,state,uploaded_by FROM documents WHERE id=$1 FOR UPDATE',
      [candidate.document_id]
    )
  ).rows[0];
  const item = (
    await client.query<Item>(
      `SELECT id,document_id,profile_id,policy_id,storage_key,upload_key,
        retention_deadline,status FROM document_destruction_items WHERE id=$1 FOR UPDATE`,
      [candidate.id]
    )
  ).rows[0];
  return { document, item };
}

async function beginDestruction(pool: Pool, candidate: Item) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { document, item } = await lockedItem(client, candidate);
    if (!document || !item || !['approved', 'destroying'].includes(item.status)) {
      await client.query('ROLLBACK');
      return false;
    }
    if (item.status === 'destroying') {
      await client.query('COMMIT');
      return true;
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('document_retention_policy:' || $1))",
      [document.business_record_type]
    );
    const eligibility = (
      await client.query<{ policy_id: string; retention_deadline: Date }>(
        'SELECT policy_id,retention_deadline FROM document_retention_eligibility($1)',
        [document.id]
      )
    ).rows[0];
    const valid =
      document.state === 'Removed' &&
      document.profile_id === item.profile_id &&
      document.storage_key === item.storage_key &&
      document.upload_key === item.upload_key &&
      eligibility?.policy_id === item.policy_id &&
      eligibility?.retention_deadline?.getTime() === item.retention_deadline.getTime() &&
      eligibility?.retention_deadline !== null &&
      eligibility?.retention_deadline !== undefined &&
      eligibility.retention_deadline <= new Date() &&
      !(await client.query<{ held: boolean }>('SELECT document_is_held($1) AS held', [document.id]))
        .rows[0]?.held;
    if (!valid) {
      await client.query(
        `UPDATE document_destruction_items SET status='cancelled',updated_at=NOW(),
          last_error='eligibility_changed' WHERE id=$1`,
        [item.id]
      );
      await audit(
        client,
        document.uploaded_by,
        'document_destruction_cancelled',
        item.id,
        document.id
      );
      await client.query('COMMIT');
      return false;
    }
    await client.query(
      `UPDATE document_destruction_items SET status='destroying',
        destruction_started_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [item.id]
    );
    await audit(client, document.uploaded_by, 'document_destruction_started', item.id, document.id);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function finishDestruction(pool: Pool, candidate: Item, storage: StorageProvider) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { document, item } = await lockedItem(client, candidate);
    if (!document || !item || item.status !== 'destroying') {
      await client.query('ROLLBACK');
      return false;
    }
    if (
      document.state !== 'Removed' ||
      document.storage_key !== item.storage_key ||
      document.upload_key !== item.upload_key
    )
      throw new Error('Document changed after destruction started');
    if (!storage.deleteObjectVersions)
      throw new Error('Version-aware document deletion is unavailable');
    await storage.deleteObjectVersions(item.storage_key);
    if (item.upload_key !== item.storage_key) await storage.deleteObjectVersions(item.upload_key);
    const changed = await client.query<{ revision: number }>(
      `UPDATE documents SET storage_key=NULL,original_name='[destroyed]',
        detected_mime=NULL,checksum=NULL,rejection_reason=NULL,review_comment=NULL,
        updated_at=NOW() WHERE id=$1 AND state='Removed' RETURNING revision`,
      [document.id]
    );
    if (!changed.rows[0]) throw new Error('Document changed during destruction');
    await client.query(
      `INSERT INTO document_events(id,document_id,revision,previous_state,state,actor_id,reason)
       VALUES(uuid_generate_v7(),$1,$2,'Removed','Removed',$3,'approved_retention_destruction')`,
      [document.id, changed.rows[0].revision, document.uploaded_by]
    );
    await client.query(
      `UPDATE storage_records SET file_name=NULL,content_type=NULL,file_size=NULL,
        category=NULL,status='removed',removed_at=NOW(),
        metadata=jsonb_build_object('destructionItemId',$2::text,'destroyedAt',NOW()),
        updated_at=NOW() WHERE storage_key=ANY($1::text[])`,
      [[item.storage_key, item.upload_key], item.id]
    );
    await client.query(
      `UPDATE document_destruction_items SET status='destroyed',destroyed_at=NOW(),
        attempts=attempts+1,last_error=NULL,updated_at=NOW() WHERE id=$1`,
      [item.id]
    );
    await audit(
      client,
      document.uploaded_by,
      'document_destruction_completed',
      item.id,
      document.id
    );
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    await pool.query(
      `UPDATE document_destruction_items SET attempts=attempts+1,
        last_error='destruction_retry_required',updated_at=NOW()
       WHERE id=$1 AND status='destroying'`,
      [candidate.id]
    );
    throw error;
  } finally {
    client.release();
  }
}

/** Run a bounded nightly batch. A started item is retried until both keys are gone. */
export async function runDocumentDestruction(pool: Pool, storage: StorageProvider | null) {
  const planned = await planDocumentDestruction(pool);
  const candidates = (
    await pool.query<Item>(
      `SELECT id,document_id,profile_id,policy_id,storage_key,upload_key,
        retention_deadline,status FROM document_destruction_items
       WHERE status IN ('approved','destroying') ORDER BY planned_at,id LIMIT 25`
    )
  ).rows;
  const result = { planned, destroyed: 0, failed: 0, cancelled: 0 };
  if (candidates.length && !storage)
    throw new Error('Document destruction requires an available storage provider');
  for (const candidate of candidates) {
    try {
      if (!(await beginDestruction(pool, candidate))) {
        result.cancelled++;
        continue;
      }
      if (await finishDestruction(pool, candidate, storage!)) result.destroyed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
