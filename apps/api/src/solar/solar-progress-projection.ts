import type { PoolClient } from 'pg';
import { SOLAR_CONSTRUCTION_MILESTONES } from '@barghsa/db';
import { activityNames } from '../common/activity-identity.js';

/** The caller authorizes this request before reading progress or resolving display identities. */
export async function readSolarProgress(client: PoolClient, requestId: string) {
  const context = (
    await client.query<{
      profile_id: string;
      status: string;
      contract_id: string | null;
      contract_state: string | null;
      signature_at: Date | null;
      activation_at: Date | null;
      postal_status: string | null;
      postal_at: Date | null;
      document_at: Date | null;
      archived: boolean;
      profile_status: string;
    }>(
      `SELECT r.profile_id,r.status,r.contract_id,c.state AS contract_state,
       s.recorded_at AS signature_at,activation.activated_at AS activation_at,p.status AS postal_status,p.staff_confirmed_at AS postal_at,
       a.document_at,profile.archived,profile.status AS profile_status
     FROM solar_construction_requests r JOIN profiles profile ON profile.id=r.profile_id
     LEFT JOIN contracts c ON c.id=r.contract_id AND c.profile_id=r.profile_id AND c.service_type='solar'
     LEFT JOIN contract_signatures s ON s.contract_id=c.id AND s.version_id=c.current_version_id
     LEFT JOIN contract_activations activation ON activation.contract_id=c.id AND activation.version_id=c.current_version_id
     LEFT JOIN solar_construction_postal p ON p.request_id=r.id
     LEFT JOIN LATERAL (SELECT max(created_at) AS document_at FROM audit_log
       WHERE event='solar.documents.approved_for_postal' AND metadata::jsonb->>'requestId'=r.id::text) a ON true
     WHERE r.id=$1`,
      [requestId]
    )
  ).rows[0]!;
  const records = (
    await client.query<{
      stage: (typeof SOLAR_CONSTRUCTION_MILESTONES)[number];
      revision: number;
      recorded_at: Date;
      actor_user_id: string | null;
      actor_context: string;
      note: string;
    }>(
      `SELECT stage,revision,recorded_at,actor_user_id,COALESCE(actor_context,'unknown') AS actor_context,note FROM solar_construction_progress_events WHERE request_id=$1 ORDER BY revision`,
      [requestId]
    )
  ).rows;
  const names = await activityNames(
    client,
    records.map((row) => row.actor_user_id)
  );
  const revision = records.at(-1)?.revision ?? 0;
  const stopped =
    ['rejected', 'cancelled'].includes(context.status) || context.contract_state === 'Cancelled';
  const paperwork = [
    'waiting_for_postal_submission',
    'postal_documents_received',
    'final_review',
    'approved',
    'contract_created',
  ].includes(context.status);
  const steps = [
    {
      id: 'document_review',
      completed: paperwork,
      recordedAt: paperwork ? (context.document_at?.toISOString() ?? null) : null,
      note: null as string | null,
    },
    {
      id: 'postal_submission',
      completed: context.postal_status === 'received',
      recordedAt:
        context.postal_status === 'received' ? (context.postal_at?.toISOString() ?? null) : null,
      note: null as string | null,
    },
    {
      id: 'contract_signing',
      completed: !!context.signature_at,
      recordedAt: context.signature_at?.toISOString() ?? null,
      note: null as string | null,
    },
    ...SOLAR_CONSTRUCTION_MILESTONES.map((stage) => {
      const record = records.find((row) => row.stage === stage);
      return {
        id: stage,
        completed: !!record,
        recordedAt: record?.recorded_at.toISOString() ?? null,
        note: record?.note ?? null,
      };
    }),
  ];
  const current = stopped ? -1 : steps.findIndex((step) => !step.completed);
  const eligible =
    context.status === 'contract_created' &&
    ['Active', 'Completed'].includes(context.contract_state ?? '') &&
    !!context.signature_at &&
    !!context.activation_at &&
    context.postal_status === 'received' &&
    !context.archived &&
    !['DRAFT', 'SUSPENDED'].includes(context.profile_status) &&
    revision < 3;
  return {
    requestId,
    profileId: context.profile_id,
    contractId: context.contract_id,
    contractState: context.contract_state,
    revision,
    nextMilestone: SOLAR_CONSTRUCTION_MILESTONES[revision] ?? null,
    eligible,
    stopped,
    steps: steps.map((step, index) => ({
      ...step,
      state: step.completed
        ? ('complete' as const)
        : index === current
          ? ('current' as const)
          : ('pending' as const),
    })),
    events: records.map((record) => ({
      stage: record.stage,
      revision: record.revision,
      recordedAt: record.recorded_at.toISOString(),
      actorContext: record.actor_context,
      actorName: record.actor_user_id ? (names.get(record.actor_user_id) ?? null) : null,
      note: record.note,
    })),
  };
}
