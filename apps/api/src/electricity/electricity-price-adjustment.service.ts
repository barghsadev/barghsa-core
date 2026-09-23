import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
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
import { CreateAdjustmentInvoiceService } from '../invoice/create-adjustment-invoice.service.js';
import {
  calculateElectricityPriceAdjustment,
  type ElectricityPriceComponent,
} from './electricity-price-adjustment.calculation.js';

const idSchema = z.string().uuid();
export const proposePriceAdjustmentSchema = z
  .object({
    expectedVersionId: idSchema,
    effectiveFrom: z.string().datetime({ offset: true }),
    percentageBps: z.string().regex(/^-?[0-9]{1,18}$/),
    reason: z.string().trim().min(1).max(1000),
    contractualBasis: z.string().trim().min(1).max(2000),
    idempotencyKey: idSchema,
  })
  .strict();
export const finalizePriceAdjustmentSchema = z
  .object({
    expectedCalculationSha256: z.string().regex(/^[0-9a-f]{64}$/),
    idempotencyKey: idSchema,
  })
  .strict();
export const cancelPriceAdjustmentSchema = z.object({ idempotencyKey: idSchema }).strict();

interface ElectricityContract {
  id: string;
  profile_id: string;
  order_id: string;
  version_id: string;
  state: string;
  electricity_status: string;
  period_start: Date;
  period_end: Date;
}
interface PriceAdjustmentRow {
  id: string;
  contract_id: string;
  version_id: string;
  profile_id: string;
  original_invoice_id: string;
  status: string;
  effective_from: Date;
  period_end: Date;
  percentage_bps: string;
  reason: string;
  contractual_basis: string;
  adjustment_amount: string;
  calculation_sha256: string;
}

const publicSelect = `SELECT a.id AS "adjustmentId",a.contract_id AS "contractId",
 a.status,a.effective_from AS "effectiveFrom",a.period_end AS "periodEnd",
 a.percentage_bps::text AS "percentageBps",a.reason,
 a.contractual_basis AS "contractualBasis",a.calculation,
 a.calculation_sha256 AS "calculationSha256",
 a.adjustment_amount::text AS "adjustmentAmountIrR",
 a.adjustment_invoice_id AS "adjustmentInvoiceId",i.state AS "adjustmentInvoiceState",
 a.created_at AS "proposedAt",a.finalized_at AS "finalizedAt",
 a.cancelled_at AS "cancelledAt"
 FROM electricity_price_adjustments a
 LEFT JOIN invoices i ON i.id=a.adjustment_invoice_id`;

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function translateConflict(error: unknown): never {
  if (
    ['23505', '23514', '55P03', '40P01', '40001'].includes((error as { code?: string }).code ?? '')
  )
    throw new ConflictException('Electricity price adjustment changed; refresh and retry');
  throw error;
}

@Injectable()
export class ElectricityPriceAdjustmentService {
  constructor(private readonly invoiceAdjustments: CreateAdjustmentInvoiceService) {}

  private async contract(client: PoolClient, id: string, profileId: string, lock = false) {
    const row = (
      await client.query<ElectricityContract>(
        `SELECT c.id,c.profile_id,c.order_id,c.current_version_id AS version_id,c.state,
       e.status AS electricity_status,e.period_start,e.period_end
       FROM contracts c JOIN electricity_contracts ec ON ec.contract_id=c.id
       JOIN electricity_orders e ON e.id=ec.order_id
       WHERE c.id=$1 AND c.profile_id=$2 AND c.service_type='electricity'
       ${lock ? 'FOR UPDATE OF c NOWAIT' : ''}`,
        [id, profileId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Electricity contract not found');
    return row;
  }

  private async profileId(contractId: string) {
    const row = (
      await getDbPool().query<{ profile_id: string }>(
        "SELECT profile_id FROM contracts WHERE id=$1 AND service_type='electricity'",
        [contractId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Electricity contract not found');
    return row.profile_id;
  }

  private async currentBasis(client: PoolClient, contract: ElectricityContract) {
    const original = (
      await client.query<{
        id: string;
        state: string;
        total_amount: string;
        paid_amount: string;
        refunded_amount: string;
      }>(
        `SELECT i.id,i.state,i.total_amount::text,i.paid_amount::text,i.refunded_amount::text
       FROM contract_activation_requirements ar JOIN invoices i ON i.id=ar.initial_invoice_id
       WHERE ar.version_id=$1 FOR UPDATE OF i NOWAIT`,
        [contract.version_id]
      )
    ).rows[0];
    if (
      !original ||
      original.state !== 'Paid' ||
      BigInt(original.paid_amount) < BigInt(original.total_amount) ||
      BigInt(original.refunded_amount) !== 0n
    )
      throw new ConflictException('Original electricity invoice is not fully paid');
    const components: ElectricityPriceComponent[] = [
      {
        source: 'original_invoice',
        invoiceId: original.id,
        amountIrR: BigInt(original.total_amount),
        periodStart: contract.period_start,
        periodEnd: contract.period_end,
      },
    ];
    const increase = (
      await client.query<{
        status: string;
        adjustment_invoice_id: string | null;
        adjustment_amount: string | null;
        pricing_snapshot: { eligibleFrom?: string } | null;
        invoice_state: string | null;
        paid_amount: string | null;
        total_amount: string | null;
        refunded_amount: string | null;
      }>(
        `SELECT r.status,r.adjustment_invoice_id,r.adjustment_amount::text,r.pricing_snapshot,
       i.state AS invoice_state,i.paid_amount::text,i.total_amount::text,i.refunded_amount::text
       FROM electricity_quantity_increase_requests r
       LEFT JOIN invoices i ON i.id=r.adjustment_invoice_id
       WHERE r.contract_id=$1 FOR UPDATE OF r NOWAIT`,
        [contract.id]
      )
    ).rows[0];
    if (increase && !['rejected', 'expired', 'effective'].includes(increase.status))
      throw new ConflictException('Resolve the open quantity increase before changing price');
    if (increase?.status === 'effective') {
      const eligibleFrom = increase.pricing_snapshot?.eligibleFrom;
      if (
        !increase.adjustment_invoice_id ||
        !increase.adjustment_amount ||
        !eligibleFrom ||
        increase.invoice_state !== 'Paid' ||
        !increase.paid_amount ||
        !increase.total_amount ||
        BigInt(increase.paid_amount) < BigInt(increase.total_amount) ||
        BigInt(increase.refunded_amount ?? '0') !== 0n
      )
        throw new ConflictException('Effective quantity increase has no fully paid basis');
      components.push({
        source: 'quantity_increase',
        invoiceId: increase.adjustment_invoice_id,
        amountIrR: BigInt(increase.adjustment_amount),
        periodStart: new Date(eligibleFrom),
        periodEnd: contract.period_end,
      });
    }
    const previous = await client.query<{
      adjustment_invoice_id: string;
      adjustment_amount: string;
      effective_from: Date;
      status: string;
    }>(
      `SELECT a.adjustment_invoice_id,a.adjustment_amount::text,a.effective_from,i.state
       FROM electricity_price_adjustments a JOIN invoices i ON i.id=a.adjustment_invoice_id
       WHERE a.contract_id=$1 AND a.status='finalized'
       ORDER BY a.created_at,a.id`,
      [contract.id]
    );
    for (const row of previous.rows) {
      if (row.status === 'Cancelled')
        throw new ConflictException('A prior price adjustment invoice was cancelled');
      components.push({
        source: 'price_adjustment',
        invoiceId: row.adjustment_invoice_id,
        amountIrR: BigInt(row.adjustment_amount),
        periodStart: row.effective_from,
        periodEnd: contract.period_end,
      });
    }
    return { originalInvoiceId: original.id, components };
  }

  private async rows(client: PoolClient, contractId: string) {
    return (
      await client.query(
        `${publicSelect} WHERE a.contract_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
        [contractId]
      )
    ).rows;
  }

  customer(contractId: string, actor: ContractActor) {
    return customerContractAccess(actor, false, async (client, profileId) => {
      const contract = await this.contract(client, contractId, profileId);
      return { adjustments: await this.rows(client, contract.id) };
    });
  }

  async staff(contractId: string) {
    const profileId = await this.profileId(contractId);
    const client = await getDbPool().connect();
    try {
      const contract = await this.contract(client, contractId, profileId);
      const adjustments = await this.rows(client, contractId);
      const openIncrease =
        (
          await client.query<{ open: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM electricity_quantity_increase_requests
         WHERE contract_id=$1 AND status IN ('pending','approved','awaiting_signature','awaiting_payment')) AS open`,
            [contractId]
          )
        ).rows[0]?.open ?? false;
      return {
        contractId,
        versionId: contract.version_id,
        periodEnd: contract.period_end,
        canPropose:
          contract.state === 'Active' &&
          contract.electricity_status === 'active' &&
          contract.period_end > new Date() &&
          !openIncrease &&
          !adjustments.some((adjustment: { status: string }) => adjustment.status === 'proposed'),
        blockedByIncrease: openIncrease,
        adjustments,
      };
    } finally {
      client.release();
    }
  }

  async propose(
    contractId: string,
    input: z.infer<typeof proposePriceAdjustmentSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      const profileId = await this.profileId(contractId);
      return await staffContractMutation(
        profileId,
        actor,
        async (client, archived) => {
          const contract = await this.contract(client, contractId, profileId, true);
          const adjustmentId = await contractIdempotency(
            client,
            'electricity_price_propose',
            { ...input, contractId },
            actor,
            async () => {
              const now = new Date(),
                effectiveFrom = new Date(input.effectiveFrom);
              if (
                archived ||
                contract.state !== 'Active' ||
                contract.electricity_status !== 'active' ||
                contract.version_id !== input.expectedVersionId ||
                effectiveFrom <= now ||
                effectiveFrom < contract.period_start ||
                effectiveFrom >= contract.period_end
              )
                throw new ConflictException('Contract has no eligible future price period');
              const basis = await this.currentBasis(client, contract);
              const quote = calculateElectricityPriceAdjustment(
                basis.components,
                effectiveFrom,
                BigInt(input.percentageBps)
              );
              const calculation = {
                schemaVersion: 1,
                contractId,
                versionId: contract.version_id,
                originalInvoiceId: basis.originalInvoiceId,
                reason: input.reason,
                contractualBasis: input.contractualBasis,
                quote: {
                  ...quote,
                  amountIrR: quote.amountIrR.toString(),
                  oldFutureIrR: quote.oldFutureIrR.toString(),
                  newFutureIrR: quote.newFutureIrR.toString(),
                },
              };
              const id = uuidv7();
              await client.query(
                `INSERT INTO electricity_price_adjustments
             (id,contract_id,version_id,order_id,profile_id,original_invoice_id,
              proposed_by,reason,contractual_basis,percentage_bps,effective_from,period_end,
              adjustment_amount,calculation,calculation_sha256)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)`,
                [
                  id,
                  contractId,
                  contract.version_id,
                  contract.order_id,
                  profileId,
                  basis.originalInvoiceId,
                  actor.userId,
                  input.reason,
                  input.contractualBasis,
                  input.percentageBps,
                  effectiveFrom,
                  contract.period_end,
                  quote.amountIrR.toString(),
                  JSON.stringify(calculation),
                  hash(calculation),
                ]
              );
              await auditContract(
                client,
                contractId,
                contract.version_id,
                'electricity.price_proposed',
                actor,
                ip,
                {
                  adjustmentId: id,
                  percentageBps: input.percentageBps,
                  amountIrR: quote.amountIrR.toString(),
                  effectiveFrom: input.effectiveFrom,
                }
              );
              await notifyContractReview(
                client,
                contractId,
                'electricity_price_proposed',
                input.reason
              );
              return id;
            }
          );
          return (await client.query(`${publicSelect} WHERE a.id=$1`, [adjustmentId])).rows[0];
        },
        { financialReview: true }
      );
    } catch (error) {
      translateConflict(error);
    }
  }

  async finalize(
    adjustmentId: string,
    input: z.infer<typeof finalizePriceAdjustmentSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      const reference = (
        await getDbPool().query<{ contract_id: string; profile_id: string }>(
          'SELECT contract_id,profile_id FROM electricity_price_adjustments WHERE id=$1',
          [adjustmentId]
        )
      ).rows[0];
      if (!reference) throw new NotFoundException('Electricity price proposal not found');
      return await staffContractMutation(
        reference.profile_id,
        actor,
        async (client, archived) => {
          const contract = await this.contract(
            client,
            reference.contract_id,
            reference.profile_id,
            true
          );
          const id = await contractIdempotency(
            client,
            'electricity_price_finalize',
            { ...input, adjustmentId },
            actor,
            async () => {
              const proposal = (
                await client.query<PriceAdjustmentRow>(
                  'SELECT * FROM electricity_price_adjustments WHERE id=$1 FOR UPDATE NOWAIT',
                  [adjustmentId]
                )
              ).rows[0];
              if (
                !proposal ||
                proposal.status !== 'proposed' ||
                archived ||
                contract.state !== 'Active' ||
                contract.electricity_status !== 'active' ||
                contract.version_id !== proposal.version_id ||
                proposal.effective_from <= new Date() ||
                proposal.period_end.getTime() !== contract.period_end.getTime()
              )
                throw new ConflictException('Price proposal is no longer eligible to finalize');
              if (proposal.calculation_sha256 !== input.expectedCalculationSha256)
                throw new ConflictException('Price proposal changed; review it again');
              const basis = await this.currentBasis(client, contract);
              if (basis.originalInvoiceId !== proposal.original_invoice_id)
                throw new ConflictException('Original invoice changed');
              const quote = calculateElectricityPriceAdjustment(
                basis.components,
                proposal.effective_from,
                BigInt(proposal.percentage_bps)
              );
              const calculation = {
                schemaVersion: 1,
                contractId: contract.id,
                versionId: contract.version_id,
                originalInvoiceId: basis.originalInvoiceId,
                reason: proposal.reason,
                contractualBasis: proposal.contractual_basis,
                quote: {
                  ...quote,
                  amountIrR: quote.amountIrR.toString(),
                  oldFutureIrR: quote.oldFutureIrR.toString(),
                  newFutureIrR: quote.newFutureIrR.toString(),
                },
              };
              if (
                hash(calculation) !== proposal.calculation_sha256 ||
                quote.amountIrR.toString() !== proposal.adjustment_amount
              )
                throw new ConflictException(
                  'Price basis changed; cancel and publish a new proposal'
                );
              const invoice = await this.invoiceAdjustments.createAdjustmentInvoice(
                {
                  originalInvoiceId: basis.originalInvoiceId,
                  amount: quote.amountIrR,
                  reason: proposal.reason,
                  actorUserId: actor.userId,
                  actorSession: actor,
                  idempotencyKey: adjustmentId,
                  ip,
                },
                client
              );
              const now = new Date();
              await client.query(
                `UPDATE electricity_price_adjustments SET status='finalized',finalized_by=$2,
             finalized_at=$3,adjustment_invoice_id=$4,updated_at=$3 WHERE id=$1`,
                [adjustmentId, actor.userId, now, invoice.adjustmentInvoiceId]
              );
              await auditContract(
                client,
                contract.id,
                contract.version_id,
                'electricity.price_finalized',
                actor,
                ip,
                {
                  adjustmentId,
                  invoiceId: invoice.adjustmentInvoiceId,
                  amountIrR: quote.amountIrR.toString(),
                  kind: quote.kind,
                }
              );
              await notifyContractReview(
                client,
                contract.id,
                'electricity_price_finalized',
                proposal.reason
              );
              return adjustmentId;
            }
          );
          return (await client.query(`${publicSelect} WHERE a.id=$1`, [id])).rows[0];
        },
        { financialReview: true }
      );
    } catch (error) {
      translateConflict(error);
    }
  }

  async cancel(
    adjustmentId: string,
    input: z.infer<typeof cancelPriceAdjustmentSchema>,
    actor: ContractActor,
    ip: string
  ) {
    try {
      const reference = (
        await getDbPool().query<{ contract_id: string; profile_id: string }>(
          'SELECT contract_id,profile_id FROM electricity_price_adjustments WHERE id=$1',
          [adjustmentId]
        )
      ).rows[0];
      if (!reference) throw new NotFoundException('Electricity price proposal not found');
      return await staffContractMutation(
        reference.profile_id,
        actor,
        async (client) => {
          const contract = await this.contract(
            client,
            reference.contract_id,
            reference.profile_id,
            true
          );
          const id = await contractIdempotency(
            client,
            'electricity_price_cancel',
            { ...input, adjustmentId },
            actor,
            async () => {
              const proposal = (
                await client.query<PriceAdjustmentRow>(
                  'SELECT * FROM electricity_price_adjustments WHERE id=$1 FOR UPDATE NOWAIT',
                  [adjustmentId]
                )
              ).rows[0];
              if (!proposal || proposal.status !== 'proposed')
                throw new ConflictException('Only an open price proposal can be cancelled');
              const now = new Date();
              await client.query(
                `UPDATE electricity_price_adjustments SET status='cancelled',cancelled_at=$2,
             updated_at=$2 WHERE id=$1`,
                [adjustmentId, now]
              );
              await auditContract(
                client,
                contract.id,
                contract.version_id,
                'electricity.price_cancelled',
                actor,
                ip,
                { adjustmentId }
              );
              await notifyContractReview(client, contract.id, 'electricity_price_cancelled');
              return adjustmentId;
            }
          );
          return (await client.query(`${publicSelect} WHERE a.id=$1`, [id])).rows[0];
        },
        { financialReview: true }
      );
    } catch (error) {
      translateConflict(error);
    }
  }
}
