import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { InvoiceStateMachineService } from '../invoice/invoice-state-machine.service.js';
import { DueAtCalculationService } from '../invoice/due-at.service.js';
import { calculateManualInvoice } from '../invoice/manual-invoice.calculation.js';
import { buildManualInvoiceCalculationSnapshot } from '../invoice/invoice-calculation-snapshot.js';

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
export const approveIncreaseSchema = z
  .object({
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const signIncreaseSchema = z
  .object({
    expectedAmendmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    expectedAdjustmentIrR: z.string().regex(/^[1-9]\d*$/),
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
 r.period_end AS "periodEnd",
 CASE WHEN r.status='awaiting_payment' AND ai.state='Paid'
      THEN 'awaiting_effective_date' ELSE r.status END AS status,
 r.review_reason AS "reviewReason",
 r.created_at AS "createdAt",r.reviewed_at AS "reviewedAt",
 r.reviewed_by AS "reviewedBy",r.requested_by AS "requestedBy",
 r.amendment_document AS "amendmentDocument",r.amendment_sha256 AS "amendmentSha256",
 r.signature_evidence AS "signatureEvidence",r.signed_at AS "signedAt",
 r.pricing_snapshot AS "pricingSnapshot",r.adjustment_amount::text AS "adjustmentAmount",
 r.adjustment_invoice_id AS "adjustmentInvoiceId",r.effective_at AS "effectiveAt",
 c.state AS "contractState" FROM electricity_quantity_increase_requests r
 JOIN contracts c ON c.id=r.contract_id
 LEFT JOIN invoices ai ON ai.id=r.adjustment_invoice_id`;

/** The cap is calculated with bigint so large metered quantities never lose precision. */
export function validateIncreaseQuantity(original: bigint, requested: bigint, maxPercent: number) {
  return (
    maxPercent > 0 &&
    requested > original &&
    requested <= 9_223_372_036_854_775_807n &&
    requested <= original + (original * BigInt(maxPercent)) / 100n
  );
}

export function quoteIncreaseAdjustment(input: {
  originalInvoiceIrR: bigint;
  originalKwh: bigint;
  requestedKwh: bigint;
  periodStart: Date;
  periodEnd: Date;
  effectiveFrom: Date;
  now: Date;
}) {
  const eligibleStart = new Date(
    Math.max(input.periodStart.getTime(), input.effectiveFrom.getTime(), input.now.getTime())
  );
  const remainingMs = BigInt(input.periodEnd.getTime() - eligibleStart.getTime());
  const periodMs = BigInt(input.periodEnd.getTime() - input.periodStart.getTime());
  if (
    input.originalInvoiceIrR <= 0n ||
    input.originalKwh <= 0n ||
    input.requestedKwh <= input.originalKwh ||
    periodMs <= 0n ||
    remainingMs <= 0n
  )
    throw new ConflictException('No eligible future delivery remains');
  const numerator =
    input.originalInvoiceIrR * (input.requestedKwh - input.originalKwh) * remainingMs;
  const denominator = input.originalKwh * periodMs;
  const amount = (numerator + denominator / 2n) / denominator;
  if (amount <= 0n || amount > 9_223_372_036_854_775_807n)
    throw new ConflictException('Adjustment amount is outside the payable range');
  return { amount, eligibleStart, remainingMs, periodMs };
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
  constructor(
    private readonly invoiceStates: InvoiceStateMachineService,
    private readonly dueDates: DueAtCalculationService
  ) {}

  private async originalInvoice(client: PoolClient, versionId: string, lock = false) {
    const row = (
      await client.query<{
        id: string;
        state: string;
        total_amount: string;
        paid_amount: string;
        refunded_amount: string;
        metadata: Record<string, unknown> | null;
      }>(
        `SELECT i.id,i.state,i.total_amount::text,i.paid_amount::text,
        i.refunded_amount::text,i.metadata FROM contract_activation_requirements r
        JOIN invoices i ON i.id=r.initial_invoice_id
        WHERE r.version_id=$1 ${lock ? 'FOR UPDATE OF i NOWAIT' : ''}`,
        [versionId]
      )
    ).rows[0];
    if (
      !row ||
      row.state !== 'Paid' ||
      BigInt(row.paid_amount) < BigInt(row.total_amount) ||
      BigInt(row.refunded_amount) !== 0n
    )
      throw new ConflictException('Original electricity invoice is not fully paid');
    return row;
  }
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
      let quote: { adjustmentIrR: string; eligibleFrom: Date } | null = null;
      if (request?.status === 'awaiting_signature' && contract.period_end > new Date()) {
        const invoice = await this.originalInvoice(client, contract.version_id);
        const result = quoteIncreaseAdjustment({
          originalInvoiceIrR: BigInt(invoice.total_amount),
          originalKwh: BigInt(request.originalKwh),
          requestedKwh: BigInt(request.requestedKwh),
          periodStart: contract.period_start,
          periodEnd: contract.period_end,
          effectiveFrom: request.effectiveFrom,
          now: new Date(),
        });
        quote = { adjustmentIrR: result.amount.toString(), eligibleFrom: result.eligibleStart };
      }
      const mayRequest =
        (await client.query<{ id: string }>(activeProfileSql('contracts:sign'), [actor.userId]))
          .rows[0]?.id === profileId;
      return {
        request,
        quote,
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

  async approve(
    requestId: string,
    input: z.infer<typeof approveIncreaseSchema>,
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
        const contract = await this.contract(client, owner.contract_id, owner.profile_id, true);
        const id = await contractIdempotency(
          client,
          'electricity_quantity_increase_approve',
          { ...input, requestId },
          actor,
          async () => {
            const request = (
              await client.query<{
                status: string;
                version_id: string;
                order_id: string;
                original_kwh: string;
                requested_kwh: string;
                max_percentage: number;
                effective_from: Date;
                period_end: Date;
                requested_by: string;
              }>(
                `SELECT status,version_id,order_id,original_kwh::text,requested_kwh::text,
                max_percentage,effective_from,period_end,requested_by
                FROM electricity_quantity_increase_requests WHERE id=$1 FOR UPDATE NOWAIT`,
                [requestId]
              )
            ).rows[0];
            const now = new Date();
            if (
              !request ||
              request.status !== 'pending' ||
              contract.state !== 'Active' ||
              contract.electricity_status !== 'active' ||
              contract.version_id !== request.version_id ||
              request.period_end <= now
            )
              throw new ConflictException('Request is no longer eligible for approval');
            const original = BigInt(request.original_kwh);
            const requested = BigInt(request.requested_kwh);
            const currentCap = await this.maxPercent(client);
            if (!validateIncreaseQuantity(original, requested, currentCap))
              throw new ConflictException('Current policy no longer permits this increase');
            const effectiveFrom = input.effectiveFrom
              ? new Date(input.effectiveFrom)
              : request.effective_from > now
                ? request.effective_from
                : now;
            if (
              effectiveFrom < now ||
              effectiveFrom < contract.period_start ||
              effectiveFrom >= request.period_end
            )
              throw new ConflictException(
                'Effective date must be in the remaining delivery period'
              );
            const amendment = {
              schemaVersion: 1,
              kind: 'electricity_quantity_increase',
              requestId,
              contractId: owner.contract_id,
              orderId: request.order_id,
              contractVersionId: request.version_id,
              requestedBy: request.requested_by,
              approvedBy: actor.userId,
              approvedAt: now.toISOString(),
              originalKwh: request.original_kwh,
              requestedKwh: request.requested_kwh,
              incrementalKwh: (requested - original).toString(),
              increaseBasisPoints: (((requested - original) * 10_000n) / original).toString(),
              maxPercentageAtRequest: request.max_percentage,
              maxPercentageAtApproval: currentCap,
              earliestEffectiveFrom: effectiveFrom.toISOString(),
              periodEnd: request.period_end.toISOString(),
              pricingRule:
                'Original paid invoice net unit value, prorated over the remaining eligible period at signature',
              activationRule:
                'Quantity increases only after customer signature and full adjustment payment, no earlier than the effective date',
            };
            const serialized = JSON.stringify(
              Object.fromEntries(
                Object.entries(amendment).sort(([left], [right]) => left.localeCompare(right))
              )
            );
            const digest = createHash('sha256').update(serialized).digest('hex');
            await client.query(
              `UPDATE electricity_quantity_increase_requests SET status='awaiting_signature',
              reviewed_by=$2,reviewed_at=$3,effective_from=$4,
              amendment_document=$5::jsonb,amendment_sha256=$6 WHERE id=$1`,
              [requestId, actor.userId, now, effectiveFrom, serialized, digest]
            );
            await auditContract(
              client,
              owner.contract_id,
              request.version_id,
              'electricity.increase_approved',
              actor,
              ip,
              { requestId, amendmentSha256: digest, effectiveFrom: effectiveFrom.toISOString() }
            );
            await notifyContractReview(client, owner.contract_id, 'electricity_increase_approved');
            return requestId;
          }
        );
        return (await client.query(requestSelect + ' WHERE r.id=$1', [id])).rows[0];
      });
    } catch (error) {
      translateConcurrentChange(error);
    }
  }

  async sign(
    id: string,
    input: z.infer<typeof signIncreaseSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      return await customerContractAccess(
        actor,
        true,
        async (client, profileId) => {
          const contract = await this.contract(client, id, profileId, true);
          const requestId = await contractIdempotency(
            client,
            'electricity_quantity_increase_sign',
            { ...input, contractId: id },
            actor,
            async () => {
              const request = (
                await client.query<{
                  id: string;
                  status: string;
                  version_id: string;
                  original_kwh: string;
                  requested_kwh: string;
                  effective_from: Date;
                  period_end: Date;
                  amendment_sha256: string;
                }>(
                  `SELECT id,status,version_id,original_kwh::text,requested_kwh::text,
                  effective_from,period_end,amendment_sha256
                  FROM electricity_quantity_increase_requests
                  WHERE contract_id=$1 FOR UPDATE NOWAIT`,
                  [id]
                )
              ).rows[0];
              const now = new Date();
              if (
                !request ||
                request.status !== 'awaiting_signature' ||
                contract.state !== 'Active' ||
                contract.electricity_status !== 'active' ||
                contract.version_id !== request.version_id ||
                request.period_end <= now
              )
                throw new ConflictException('Amendment is no longer eligible for signature');
              if (request.amendment_sha256 !== input.expectedAmendmentSha256)
                throw new ConflictException('Amendment changed; review it again');
              const originalInvoice = await this.originalInvoice(client, request.version_id, true);
              const quote = quoteIncreaseAdjustment({
                originalInvoiceIrR: BigInt(originalInvoice.total_amount),
                originalKwh: BigInt(request.original_kwh),
                requestedKwh: BigInt(request.requested_kwh),
                periodStart: contract.period_start,
                periodEnd: request.period_end,
                effectiveFrom: request.effective_from,
                now,
              });
              if (quote.amount.toString() !== input.expectedAdjustmentIrR)
                throw new ConflictException('Adjustment changed; review the current amount');
              const pricingSnapshot = {
                schemaVersion: 1,
                amendmentSha256: request.amendment_sha256,
                originalInvoiceId: originalInvoice.id,
                originalInvoiceIrR: originalInvoice.total_amount,
                originalKwh: request.original_kwh,
                requestedKwh: request.requested_kwh,
                eligibleFrom: quote.eligibleStart.toISOString(),
                periodStart: contract.period_start.toISOString(),
                periodEnd: request.period_end.toISOString(),
                remainingMs: quote.remainingMs.toString(),
                periodMs: quote.periodMs.toString(),
                rounding: 'half-up-to-nearest-IRR',
                adjustmentIrR: quote.amount.toString(),
              };
              const due = await this.dueDates.resolve(client, {
                serviceType: 'electricity',
                issuedAt: now,
              });
              const invoiceId = uuidv7();
              const line = {
                description: `Electricity quantity increase ${request.id}`,
                quantity: 1,
                unitPrice: quote.amount,
                vatRate: 0,
                isTaxable: false,
              };
              const calculation = calculateManualInvoice([line]);
              await client.query(
                `INSERT INTO invoices(id,profile_id,order_id,contract_id,type,state,total_amount,
                due_at,metadata,invoice_calculation_snapshot,adjustment_kind,adjustment_for_invoice_id)
                VALUES($1,$2,$3,$4,'manual','Draft',$5,$6,$7::jsonb,$8::jsonb,'charge',$9)`,
                [
                  invoiceId,
                  profileId,
                  contract.order_id,
                  id,
                  quote.amount.toString(),
                  due.dueAt < request.period_end ? due.dueAt : request.period_end,
                  JSON.stringify({
                    source: 'electricity_quantity_increase',
                    increaseRequestId: request.id,
                    generatedBy: actor.userId,
                    adjustmentForInvoiceId: originalInvoice.id,
                    pricing: pricingSnapshot,
                    due,
                  }),
                  JSON.stringify(buildManualInvoiceCalculationSnapshot([line], calculation)),
                  originalInvoice.id,
                ]
              );
              await client.query(
                `INSERT INTO invoice_lines(id,invoice_id,description,quantity,unit_price,line_total,
                vat_rate,vat_amount,is_taxable,position)
                VALUES($1,$2,$3,1,$4,$4,0,0,false,0)`,
                [uuidv7(), invoiceId, line.description, quote.amount.toString()]
              );
              await this.invoiceStates.transition(invoiceId, 'Draft', 'Unpaid', {
                actorUserId: actor.userId,
                reason: 'Signed electricity quantity increase amendment',
                now,
                ip,
                client,
              });
              const oldMetadata = originalInvoice.metadata ?? {};
              const adjustedIds = Array.isArray(oldMetadata.adjustedByInvoiceIds)
                ? oldMetadata.adjustedByInvoiceIds.filter(
                    (value): value is string => typeof value === 'string'
                  )
                : [];
              await client.query(
                'UPDATE invoices SET metadata=$2::jsonb,updated_at=$3 WHERE id=$1',
                [
                  originalInvoice.id,
                  JSON.stringify({
                    ...oldMetadata,
                    adjustedByInvoiceIds: [...adjustedIds, invoiceId],
                  }),
                  now,
                ]
              );
              await client.query(
                `UPDATE electricity_quantity_increase_requests
                SET status='awaiting_payment',signed_at=$2,signature_evidence=$3::jsonb,
                pricing_snapshot=$4::jsonb,adjustment_amount=$5,adjustment_invoice_id=$6
                WHERE id=$1`,
                [
                  request.id,
                  now,
                  JSON.stringify({
                    schemaVersion: 1,
                    amendmentSha256: request.amendment_sha256,
                    signedBy: actor.userId,
                    sessionId: actor.sessionId,
                    signedAt: now.toISOString(),
                    ip,
                    adjustmentIrR: quote.amount.toString(),
                  }),
                  JSON.stringify(pricingSnapshot),
                  quote.amount.toString(),
                  invoiceId,
                ]
              );
              await auditContract(
                client,
                id,
                request.version_id,
                'electricity.increase_signed',
                actor,
                ip,
                { requestId: request.id, invoiceId, adjustmentIrR: quote.amount.toString() }
              );
              await notifyContractReview(client, id, 'electricity_increase_signed');
              return request.id;
            }
          );
          return (await client.query(requestSelect + ' WHERE r.id=$1', [requestId])).rows[0];
        },
        { financialReview: true }
      );
    } catch (error) {
      translateConcurrentChange(error);
    }
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
