import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import {
  CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
  toContractElectricityLimits,
} from '@barghsa/shared/admin';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { customerContractAccess } from '../contract/contract-customer-access.js';
import {
  auditContract,
  contractIdempotency,
  staffContractMutation,
  type ContractActor,
} from '../contract/contract-transactions.js';
import { notifyContractReview } from '../contract/contract-review-notifications.js';
import { activeProfileSql } from '../profiles/profile-context.js';

export const requestIncreaseSchema = z
  .object({
    requestedKwh: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(19),
    expectedVersionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const rejectIncreaseSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

interface IncreaseContract {
  id: string;
  profile_id: string;
  order_id: string;
  version_id: string;
  state: string;
  electricity_status: string;
  original_kwh: string;
  period_start: Date;
  period_end: Date;
}
const requestSelect = `SELECT r.id AS "requestId",r.contract_id AS "contractId",
 r.order_id AS "orderId",r.profile_id AS "profileId",r.version_id AS "versionId",
 r.original_kwh::text AS "originalKwh",r.requested_kwh::text AS "requestedKwh",
 r.max_percentage AS "maxPercentage",r.effective_from AS "effectiveFrom",
 r.period_end AS "periodEnd",r.status,r.review_reason AS "reviewReason",
 r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt",
 c.state AS "contractState" FROM electricity_quantity_increase_requests r
 JOIN contracts c ON c.id=r.contract_id`;

/** The cap is calculated with bigint so large metered quantities never lose precision. */
export function validateIncreaseQuantity(original: bigint, requested: bigint, maxPercent: number) {
  return (
    maxPercent > 0 &&
    requested > original &&
    requested <= 9_223_372_036_854_775_807n &&
    requested <= original + (original * BigInt(maxPercent)) / 100n
  );
}

function translateConcurrentChange(error: unknown): never {
  if (
    ['23505', '23514', '55P03', '40P01', '40001'].includes((error as { code?: string }).code ?? '')
  )
    throw new ConflictException('The contract or increase request changed; refresh and retry');
  throw error;
}

@Injectable()
export class ElectricityIncreaseService {
  private async contract(client: PoolClient, id: string, profileId: string, lock: boolean) {
    const row = (
      await client.query<IncreaseContract>(
        `SELECT c.id,c.profile_id,c.order_id,c.current_version_id AS version_id,c.state,
       e.status AS electricity_status,e.total_kwh::text AS original_kwh,
       e.period_start,e.period_end FROM contracts c
       JOIN electricity_contracts ec ON ec.contract_id=c.id
       JOIN electricity_orders e ON e.id=ec.order_id
       WHERE c.id=$1 AND c.profile_id=$2 AND c.service_type='electricity'
       ${lock ? 'FOR UPDATE OF c NOWAIT' : ''}`,
        [id, profileId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Electricity contract not found');
    return row;
  }

  private async maxPercent(client: PoolClient) {
    const row = (
      await client.query<{ value: unknown }>('SELECT value FROM app_config WHERE key=$1', [
        CONTRACT_ELECTRICITY_LIMITS_CONFIG_KEY,
      ])
    ).rows[0];
    return toContractElectricityLimits(row?.value).maxQuantityIncreasePercent;
  }

  private async request(client: PoolClient, id: string) {
    return (await client.query(requestSelect + ' WHERE r.contract_id=$1', [id])).rows[0] ?? null;
  }

  customer(id: string, actor: ContractActor) {
    return customerContractAccess(actor, false, async (client, profileId) => {
      const contract = await this.contract(client, id, profileId, false);
      const maxPercentage = await this.maxPercent(client);
      const request = await this.request(client, id);
      const mayRequest =
        (await client.query<{ id: string }>(activeProfileSql('contracts:sign'), [actor.userId]))
          .rows[0]?.id === profileId;
      return {
        request,
        maxPercentage,
        originalKwh: contract.original_kwh,
        canRequest:
          mayRequest &&
          !request &&
          maxPercentage > 0 &&
          contract.state === 'Active' &&
          contract.electricity_status === 'active' &&
          contract.period_end > new Date(),
      };
    });
  }

  async submit(
    id: string,
    input: z.infer<typeof requestIncreaseSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      return await customerContractAccess(actor, true, async (client, profileId) => {
        const contract = await this.contract(client, id, profileId, true);
        const requestId = await contractIdempotency(
          client,
          'electricity_quantity_increase',
          { ...input, contractId: id },
          actor,
          async () => {
            const now = new Date();
            if (
              contract.state !== 'Active' ||
              contract.electricity_status !== 'active' ||
              contract.version_id !== input.expectedVersionId ||
              contract.period_end <= now
            )
              throw new ConflictException('Contract is no longer eligible for an increase');
            if (await this.request(client, id))
              throw new ConflictException('This contract already has an increase request');
            const maxPercentage = await this.maxPercent(client);
            const original = BigInt(contract.original_kwh);
            const requested = BigInt(input.requestedKwh);
            if (!validateIncreaseQuantity(original, requested, maxPercentage))
              throw new ConflictException('Requested quantity exceeds the current increase limit');
            // Existing deliveries and paid invoice lines stay untouched. An approved
            // amendment will price only this incremental future quantity.
            const effectiveFrom = contract.period_start > now ? contract.period_start : now;
            const requestId = uuidv7();
            await client.query(
              `INSERT INTO electricity_quantity_increase_requests
               (id,contract_id,order_id,profile_id,version_id,requested_by,
                original_kwh,requested_kwh,max_percentage,effective_from,period_end)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [
                requestId,
                id,
                contract.order_id,
                profileId,
                contract.version_id,
                actor.userId,
                original.toString(),
                requested.toString(),
                maxPercentage,
                effectiveFrom,
                contract.period_end,
              ]
            );
            await auditContract(
              client,
              id,
              contract.version_id,
              'electricity.increase_requested',
              actor,
              ip,
              {
                requestId,
                orderId: contract.order_id,
                originalKwh: original.toString(),
                requestedKwh: requested.toString(),
                maxPercentage,
                effectiveFrom: effectiveFrom.toISOString(),
              }
            );
            await notifyContractReview(client, id, 'electricity_increase_requested');
            return requestId;
          }
        );
        return (await client.query(requestSelect + ' WHERE r.id=$1', [requestId])).rows[0];
      });
    } catch (error) {
      translateConcurrentChange(error);
    }
  }

  async queue(before?: string) {
    const rows = (
      await getDbPool().query(
        requestSelect +
          ` WHERE r.status='pending' AND ($1::uuid IS NULL OR r.id<$1)
        ORDER BY r.id DESC LIMIT 51`,
        [before ?? null]
      )
    ).rows;
    return {
      requests: rows.slice(0, 50),
      nextBefore: rows.length > 50 ? rows[49]!.requestId : null,
    };
  }

  async reject(
    requestId: string,
    input: z.infer<typeof rejectIncreaseSchema>,
    actor: ContractActor,
    ip: string
  ) {
    const owner = (
      await getDbPool().query<{ contract_id: string; profile_id: string }>(
        'SELECT contract_id,profile_id FROM electricity_quantity_increase_requests WHERE id=$1',
        [requestId]
      )
    ).rows[0];
    if (!owner) throw new NotFoundException('Increase request not found');
    try {
      return await staffContractMutation(owner.profile_id, actor, async (client, archived) => {
        if (archived) throw new ConflictException('Profile is archived');
        await client.query('SELECT id FROM contracts WHERE id=$1 FOR UPDATE NOWAIT', [
          owner.contract_id,
        ]);
        await contractIdempotency(
          client,
          'electricity_quantity_increase_reject',
          { ...input, requestId },
          actor,
          async () => {
            const row = (
              await client.query<{ status: string; version_id: string }>(
                'SELECT status,version_id FROM electricity_quantity_increase_requests WHERE id=$1 FOR UPDATE NOWAIT',
                [requestId]
              )
            ).rows[0];
            if (!row || row.status !== 'pending')
              throw new ConflictException('Request is no longer pending');
            await client.query(
              `UPDATE electricity_quantity_increase_requests
            SET status='rejected',reviewed_by=$2,review_reason=$3,reviewed_at=clock_timestamp() WHERE id=$1`,
              [requestId, actor.userId, input.reason]
            );
            await auditContract(
              client,
              owner.contract_id,
              row.version_id,
              'electricity.increase_rejected',
              actor,
              ip,
              { requestId, reason: input.reason }
            );
            await notifyContractReview(
              client,
              owner.contract_id,
              'electricity_increase_rejected',
              input.reason
            );
            return requestId;
          }
        );
        return (await client.query(requestSelect + ' WHERE r.id=$1', [requestId])).rows[0];
      });
    } catch (error) {
      translateConcurrentChange(error);
    }
  }
}
