import type { PoolClient, Pool } from 'pg';
import { activityNames } from '../common/activity-identity.js';

const visibleEvents = [
  'contract.created',
  'contract.version_created',
  'contract.submitted',
  'contract.resubmitted',
  'contract.changes_requested',
  'contract.accepted',
  'contract.signature_requested',
  'contract.signed_copy_recorded',
  'contract.cancelled',
  'contract.amendment_created',
  'contract.amendment_accepted',
];

/** Called only after contract/version authorization. Customer history excludes pre-publication work. */
export async function contractStatusHistory(
  client: PoolClient | Pool,
  contractId: string,
  versionId: string,
  staff: boolean
) {
  const rows = (
    await client.query<{
      id: string;
      event: string;
      created_at: Date;
      actor_type: 'staff' | 'customer' | 'system';
      user_id: string | null;
      reason: string | null;
    }>(
      `WITH events AS (
       SELECT a.id::text,a.event,a.created_at,
         CASE WHEN a.user_id IS NULL THEN 'system'
           WHEN a.event IN ('contract.accepted','contract.amendment_accepted')
             OR (a.event='contract.signed_copy_recorded' AND a.metadata::jsonb->>'recordedByType'='customer')
             THEN 'customer' ELSE 'staff' END AS actor_type,
         CASE WHEN jsonb_typeof(a.metadata::jsonb->'reason')='string'
           THEN left(a.metadata::jsonb->>'reason',1000) ELSE NULL END AS reason,a.user_id
       FROM audit_log a
       WHERE a.metadata::jsonb->>'contractId'=$1::text AND a.metadata::jsonb->>'versionId'=$2::text
         AND a.event=ANY($3::text[])
       UNION ALL
       SELECT p.version_id::text||':published',
         CASE WHEN amendment.version_id IS NULL THEN 'contract.published'
           ELSE 'contract.amendment_published' END,p.published_at,'staff',NULL,p.published_by
       FROM contract_publications p
       LEFT JOIN contract_amendments amendment ON amendment.contract_id=p.contract_id AND amendment.version_id=p.version_id
       WHERE p.contract_id=$1::uuid AND p.version_id=$2::uuid
       UNION ALL
       SELECT version_id::text||':activated','contract.activated',activated_at,'system',NULL,NULL
       FROM contract_activations WHERE contract_id=$1::uuid AND version_id=$2::uuid
       UNION ALL
       SELECT version_id::text||':completed','contract.completed',completed_at,'system',NULL,NULL
       FROM contract_completions WHERE contract_id=$1::uuid AND version_id=$2::uuid
     ) SELECT * FROM events a
     WHERE ($4 OR EXISTS (
         SELECT 1 FROM contract_publications p
         WHERE p.contract_id=$1::uuid AND p.version_id=$2::uuid AND a.created_at>=p.published_at
       ))
     ORDER BY a.created_at DESC,a.id DESC LIMIT 201`,
      [contractId, versionId, visibleEvents, staff]
    )
  ).rows;
  const visible = rows.slice(0, 200).reverse();
  const names = await activityNames(
    client,
    visible.map((row) => row.user_id)
  );
  return {
    history: visible.map((row) => ({
      id: row.id,
      event: row.event,
      at: row.created_at.toISOString(),
      actorType: row.actor_type,
      actorName: row.user_id ? (names.get(row.user_id) ?? null) : null,
      reason: row.reason,
    })),
    historyTruncated: rows.length > 200,
  };
}
