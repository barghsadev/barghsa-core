import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { activeProfileSql } from '../profiles/profile-context.js';
import { customerContractAccess } from './contract-customer-access.js';
import { contractUuid } from './contract-validation.js';
import {
  auditContract,
  contractIdempotency,
  staffContractMutation,
  type ContractActor,
} from './contract-transactions.js';
import { notifyContractReview } from './contract-review-notifications.js';

export const cancellationRequestSchema = z
  .object({
    expectedVersionId: contractUuid,
    reason: z.string().trim().min(1).max(1000),
    preferredDestination: z.enum(['wallet', 'external_bank']),
    idempotencyKey: contractUuid,
  })
  .strict();
export const rejectCancellationRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: contractUuid,
  })
  .strict();
const selection = `SELECT r.id,r.contract_id AS "contractId",r.version_id AS "versionId",r.reason,
 r.preferred_destination AS "preferredDestination",
 CASE WHEN r.status='Pending' AND (c.state IN ('Cancelled','Completed','Rejected')
   OR s.status IN ('completed','rejected','cancelled')) THEN 'Closed' ELSE r.status END AS status,
 r.resolution_reason AS "resolutionReason",r.created_at AS "createdAt",r.resolved_at AS "resolvedAt",
 c.state AS "contractState",c.service_type AS "serviceType",r.version_id<>c.current_version_id AS stale,
 s.id AS "savingOrderId",s.bill_identifier AS "billIdentifier",p.title AS "planTitle",
 u.username AS "customerName"
 FROM contract_cancellation_requests r JOIN contracts c ON c.id=r.contract_id
 LEFT JOIN saving_orders s ON s.order_id=c.order_id AND c.service_type='savings'
 LEFT JOIN products p ON p.id=s.saving_plan_id
 JOIN profiles profile ON profile.id=c.profile_id JOIN users u ON u.user_id=profile.user_id`;
function conflict(error: unknown): never {
  if (
    ['23505', '23514', '55P03', '40P01', '40001'].includes((error as { code?: string }).code ?? '')
  )
    throw new ConflictException('The request or contract changed; refresh before trying again');
  throw error;
}
@Injectable()
export class ContractCancellationRequestService {
  private async requestable(client: PoolClient, id: string, profile: string, lock = false) {
    const row = (
      await client.query<{
        current_version_id: string;
        state: string;
        current_requestable: boolean;
      }>(
        `SELECT c.current_version_id,c.state,
         (EXISTS(SELECT 1 FROM contract_publications p WHERE p.contract_id=c.id AND p.version_id=c.current_version_id)
           OR (c.service_type='savings' AND c.state='AwaitingStaffReview'
             AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id)))
           AND NOT EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id
             AND s.status IN ('completed','rejected','cancelled')) AS current_requestable
       FROM contracts c WHERE c.id=$1 AND c.profile_id=$2 AND (
         EXISTS(SELECT 1 FROM contract_publications p WHERE p.contract_id=c.id)
         OR (c.service_type='savings' AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=c.order_id)))
       ${lock ? 'FOR UPDATE OF c NOWAIT' : ''}`,
        [id, profile]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return row;
  }
  private async latest(client: Pool | PoolClient, id: string) {
    return (
      (
        await client.query(
          selection + ' WHERE r.contract_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 1',
          [id]
        )
      ).rows[0] ?? null
    );
  }
  customer(id: string, actor: ContractActor) {
    return customerContractAccess(actor, false, async (client, profile) => {
      const contract = await this.requestable(client, id, profile);
      const request = await this.latest(client, id);
      const authorized =
        (await client.query<{ id: string }>(activeProfileSql('contracts:sign'), [actor.userId]))
          .rows[0]?.id === profile;
      return {
        request,
        canRequest:
          authorized &&
          contract.current_requestable &&
          !['Cancelled', 'Completed', 'Rejected'].includes(contract.state) &&
          request?.status !== 'Pending',
      };
    });
  }
  async submit(
    id: string,
    input: z.infer<typeof cancellationRequestSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      return await customerContractAccess(actor, true, async (client, profile) => {
        const contract = await this.requestable(client, id, profile, true);
        const requestId = await contractIdempotency(
          client,
          'contract_cancellation_request',
          { ...input, contractId: id },
          actor,
          async () => {
            if (
              contract.current_version_id !== input.expectedVersionId ||
              !contract.current_requestable ||
              ['Cancelled', 'Completed', 'Rejected'].includes(contract.state)
            )
              throw new ConflictException('The current contract cannot receive this request');
            const requestId = uuidv7();
            await client.query(
              'INSERT INTO contract_cancellation_requests(id,contract_id,version_id,requested_by,reason,preferred_destination) VALUES($1,$2,$3,$4,$5,$6)',
              [
                requestId,
                id,
                input.expectedVersionId,
                actor.userId,
                input.reason,
                input.preferredDestination,
              ]
            );
            await auditContract(
              client,
              id,
              input.expectedVersionId,
              'contract.cancellation_requested',
              actor,
              ip,
              { requestId, reason: input.reason, preferredDestination: input.preferredDestination }
            );
            await notifyContractReview(client, id, 'cancellation_requested', input.reason);
            return requestId;
          }
        );
        return (await client.query(selection + ' WHERE r.id=$1', [requestId])).rows[0];
      });
    } catch (error) {
      conflict(error);
    }
  }
  async staff(id: string) {
    if (!(await getDbPool().query('SELECT id FROM contracts WHERE id=$1', [id])).rowCount)
      throw new NotFoundException();
    return { request: await this.latest(getDbPool(), id) };
  }
  async queue(before?: string, serviceType?: 'savings') {
    const rows = (
      await getDbPool().query(
        selection +
          ` WHERE r.status='Pending' AND c.state NOT IN ('Cancelled','Completed','Rejected')
            AND (s.status IS NULL OR s.status NOT IN ('completed','rejected','cancelled'))
            AND ($1::uuid IS NULL OR r.id<$1) AND ($2::text IS NULL OR c.service_type::text=$2)
            ORDER BY r.id DESC LIMIT 51`,
        [before ?? null, serviceType ?? null]
      )
    ).rows;
    return { requests: rows.slice(0, 50), nextBefore: rows.length > 50 ? rows[49]!.id : null };
  }
  async reject(
    requestId: string,
    input: z.infer<typeof rejectCancellationRequestSchema>,
    actor: ContractActor,
    ip: string
  ) {
    const owner = (
      await getDbPool().query<{ id: string; profile_id: string }>(
        'SELECT c.id,c.profile_id FROM contracts c JOIN contract_cancellation_requests r ON r.contract_id=c.id WHERE r.id=$1',
        [requestId]
      )
    ).rows[0];
    if (!owner) throw new NotFoundException();
    try {
      return await staffContractMutation(owner.profile_id, actor, async (client, archived) => {
        if (archived) throw new ConflictException('Profile is archived');
        await client.query('SELECT id FROM contracts WHERE id=$1 FOR UPDATE NOWAIT', [owner.id]);
        await contractIdempotency(
          client,
          'contract_cancellation_request_reject',
          { ...input, requestId },
          actor,
          async () => {
            const request = (
              await client.query(
                'SELECT * FROM contract_cancellation_requests WHERE id=$1 FOR UPDATE NOWAIT',
                [requestId]
              )
            ).rows[0];
            if (!request || request.status !== 'Pending')
              throw new ConflictException('Request is no longer pending');
            await client.query(
              "UPDATE contract_cancellation_requests SET status='Rejected',resolved_by=$2,resolution_reason=$3 WHERE id=$1",
              [requestId, actor.userId, input.reason]
            );
            await auditContract(
              client,
              owner.id,
              request.version_id,
              'contract.cancellation_request_rejected',
              actor,
              ip,
              { requestId, reason: input.reason }
            );
            await notifyContractReview(
              client,
              owner.id,
              'cancellation_request_rejected',
              input.reason
            );
            return requestId;
          }
        );
        return (await client.query(selection + ' WHERE r.id=$1', [requestId])).rows[0];
      });
    } catch (error) {
      conflict(error);
    }
  }
}
