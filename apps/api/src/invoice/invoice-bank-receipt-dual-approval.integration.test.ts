import {
  receiptDecisionSession,
  seedReceiptDecisionSessions,
} from '../test/receipt-decision-session.js';
/**
 * Real-PostgreSQL integration tests for invoice bank-receipt dual-approval
 * (T-04.3.01.05).
 *
 * Proves against actual PostgreSQL:
 *   1. Amounts below the admin threshold still confirm in one step.
 *   2. Amounts at or above the threshold park in UnderReview and do not
 *      change invoice paid_amount or wallet balance.
 *   3. The same finance staff member cannot complete the parked confirm.
 *   4. A second, different finance staff member settles the receipt.
 *   5. A missing / zero threshold disables the gate.
 *   6. A corrupt stored threshold fails closed.
 *   7. Rejecting a parked receipt resolves the pending approval request
 *      through the canonical dual-approval path (different reviewer +
 *      approval_request_rejected audit) without crediting the wallet.
 *   8. DualApprovalService rejection of the pending request is durable:
 *      a later confirm does not mint a replacement request and
 *      synchronizes the receipt to Rejected.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import {
  DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
  INVOICE_BANK_RECEIPT_CONFIRM_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS,
  INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT,
  INVOICE_BANK_RECEIPT_CONFIRMED_EVENT,
  INVOICE_BANK_RECEIPT_REJECTED_EVENT,
} from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DualApprovalService } from '../admin/dual-approval.service.js';
import {
  APPROVAL_REQUEST_APPROVED_EVENT,
  APPROVAL_REQUEST_REJECTED_EVENT,
} from '../admin/dual-approval-resolution.js';
import { WalletService } from '../wallet/wallet.service.js';
import { InvoiceBankReceiptConfirmationService } from './invoice-bank-receipt-confirmation.service.js';
import { InvoiceStateMachineService } from './invoice-state-machine.service.js';
import { InvoiceAuditRepository } from './invoice-audit.repository.js';
import { InvoiceAdjustmentApprovalService } from './invoice-adjustment-approval.service.js';
import { CreateAdjustmentInvoiceService } from './create-adjustment-invoice.service.js';
import { DueAtCalculationService } from './due-at.service.js';
import { DueAtCalculationRepository } from './due-at.repository.js';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>();
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first');
      }
      return poolHolder.pool;
    },
  };
});

const PROFILE_A = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const FIRST_STAFF = 'staff-dual-approval-first';
const SECOND_STAFF = 'staff-dual-approval-second';
const CUSTOMER_USER_ID = 'customer-dual-approval-owner';
const THRESHOLD = 500_000n;
const NOW = new Date('2026-09-03T12:00:00.000Z');

function receiptKey(suffix: string): string {
  const pad = suffix
    .replace(/[^0-9a-f]/gi, 'a')
    .padStart(12, '0')
    .slice(0, 12);
  return `uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-${pad}.pdf`;
}

describe('InvoiceBankReceiptConfirmationService dual-approval — real PostgreSQL (T-04.3.01.05)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let walletService: WalletService;
  let service: InvoiceBankReceiptConfirmationService;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    walletService = new WalletService();
    service = new InvoiceBankReceiptConfirmationService(
      walletService,
      null,
      new InvoiceStateMachineService(new InvoiceAuditRepository())
    );

    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash, is_staff) VALUES ($1, $2, 'test-only', true), ($3, $4, 'test-only', true), ($5, $6, 'test-only', false)`,
      [
        FIRST_STAFF,
        'first-finance',
        SECOND_STAFF,
        'second-finance',
        CUSTOMER_USER_ID,
        'customer-dual',
      ]
    );
    await ctx.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'role-finance'),($2,'role-finance')",
      [FIRST_STAFF, SECOND_STAFF]
    );
    await ctx.pool.query(`INSERT INTO profiles (id, user_id, status) VALUES ($1, $2, 'ACTIVE')`, [
      PROFILE_A,
      CUSTOMER_USER_ID,
    ]);
    await ctx.pool.query(`INSERT INTO wallets (profile_id) VALUES ($1)`, [PROFILE_A]);
    await seedReceiptDecisionSessions(ctx.pool, [FIRST_STAFF, SECOND_STAFF]);
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx?.close();
  });

  async function setThreshold(thresholdIrR: number | null, raw?: unknown): Promise<void> {
    await ctx.pool.query(`DELETE FROM app_config WHERE key = $1`, [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
    ]);
    if (raw !== undefined) {
      await ctx.pool.query(`INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)`, [
        DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
        JSON.stringify(raw),
      ]);
      return;
    }
    if (thresholdIrR === null) return;
    await ctx.pool.query(`INSERT INTO app_config (key, value) VALUES ($1, $2::jsonb)`, [
      DUAL_APPROVAL_THRESHOLD_CONFIG_KEY,
      JSON.stringify({ threshold_irr: thresholdIrR }),
    ]);
  }

  async function insertInvoice(opts: {
    total: bigint;
    paid?: bigint;
    state?: string;
  }): Promise<string> {
    const id = uuidv7();
    await ctx.pool.query(
      `INSERT INTO invoices (id, profile_id, state, total_amount, paid_amount)
       VALUES ($1, $2, $3::invoice_state, $4::bigint, $5::bigint)`,
      [id, PROFILE_A, opts.state ?? 'Unpaid', opts.total.toString(), (opts.paid ?? 0n).toString()]
    );
    return id;
  }

  async function insertReceipt(opts: {
    invoiceId: string;
    amount: bigint;
    suffix: string;
  }): Promise<string> {
    const id = uuidv7();
    await ctx.pool.query(
      `INSERT INTO bank_receipts
         (id, invoice_id, profile_id, amount, payment_date, payer_reference, attachment_key, state)
       VALUES ($1, $2, $3, $4::bigint, $5, $6, $7, 'Submitted')`,
      [
        id,
        opts.invoiceId,
        PROFILE_A,
        opts.amount.toString(),
        '2026-08-15',
        `TRK-${opts.suffix}`,
        receiptKey(opts.suffix),
      ]
    );
    return id;
  }

  async function invoicePaid(invoiceId: string): Promise<{ paid: bigint; state: string }> {
    const result = await ctx.pool.query<{ paid_amount: string; state: string }>(
      `SELECT paid_amount, state FROM invoices WHERE id = $1`,
      [invoiceId]
    );
    return { paid: BigInt(result.rows[0]!.paid_amount), state: result.rows[0]!.state };
  }

  async function walletPosted(): Promise<bigint> {
    const result = await ctx.pool.query<{ posted_balance: string }>(
      `SELECT posted_balance FROM wallets WHERE profile_id = $1`,
      [PROFILE_A]
    );
    return BigInt(result.rows[0]!.posted_balance);
  }

  async function receiptState(receiptId: string): Promise<string> {
    const result = await ctx.pool.query<{ state: string }>(
      `SELECT state FROM bank_receipts WHERE id = $1`,
      [receiptId]
    );
    return result.rows[0]!.state;
  }

  async function pendingApprovals(
    receiptId: string
  ): Promise<Array<{ id: string; initiator_id: string; status: string; amount_irr: string }>> {
    const result = await ctx.pool.query<{
      id: string;
      initiator_id: string;
      status: string;
      amount_irr: string;
    }>(
      `SELECT id, initiator_id, status, amount_irr::text AS amount_irr
         FROM approval_requests
        WHERE action_type = $1
          AND details->>'receiptId' = $2
        ORDER BY created_at`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE, receiptId]
    );
    return result.rows;
  }

  it.each(['NULL', 'OLD'])(
    'rolls back approval creation when parking the receipt was suppressed: %s',
    async (returned) => {
      await setThreshold(Number(THRESHOLD));
      const invoiceId = await insertInvoice({ total: 2_000_000n });
      const receiptId = await insertReceipt({
        invoiceId,
        amount: THRESHOLD,
        suffix: `${returned === 'NULL' ? '0' : '1'}-suppressed-park`,
      });
      const beforeWallet = await walletPosted();
      await ctx.pool
        .query(`CREATE FUNCTION suppress_receipt_parking() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.state = 'UnderReview' THEN RETURN ${returned}; END IF; RETURN NEW; END $$;
      CREATE TRIGGER suppress_receipt_parking BEFORE UPDATE ON bank_receipts
      FOR EACH ROW EXECUTE FUNCTION suppress_receipt_parking()`);
      const input = {
        receiptId,
        actorUserId: FIRST_STAFF,
        ...receiptDecisionSession(FIRST_STAFF),
        ip: '10.0.0.9',
        now: NOW,
      };
      try {
        await expect(service.confirm(input)).rejects.toMatchObject({ status: 409 });
        expect(await receiptState(receiptId)).toBe('Submitted');
        expect(await pendingApprovals(receiptId)).toHaveLength(0);
        expect(await invoicePaid(invoiceId)).toEqual({ paid: 0n, state: 'Unpaid' });
        expect(await walletPosted()).toBe(beforeWallet);
        expect(
          (
            await ctx.pool.query(
              "SELECT id FROM audit_log WHERE metadata::jsonb->>'receiptId'=$1",
              [receiptId]
            )
          ).rows
        ).toHaveLength(0);
      } finally {
        await ctx.pool.query(
          'DROP TRIGGER suppress_receipt_parking ON bank_receipts; DROP FUNCTION suppress_receipt_parking()'
        );
      }
      expect((await service.confirm(input)).state).toBe('UnderReview');
      expect(await pendingApprovals(receiptId)).toHaveLength(1);
    }
  );

  it('confirms below-threshold receipts in one step', async () => {
    await setThreshold(Number(THRESHOLD));
    const invoiceId = await insertInvoice({ total: 1_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD - 1n,
      suffix: 'below',
    });
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(result.state).toBe('Confirmed');
    expect(result.dualApprovalPending).toBe(false);
    expect(result.confirmedBy).toBe(FIRST_STAFF);
    expect((await invoicePaid(invoiceId)).paid).toBe(THRESHOLD - 1n);
    expect(await pendingApprovals(receiptId)).toHaveLength(0);
  });

  it('parks at-threshold receipts until a second staff member confirms', async () => {
    await setThreshold(Number(THRESHOLD));
    const invoiceId = await insertInvoice({ total: 2_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD,
      suffix: 'equal',
    });
    const beforeWallet = await walletPosted();

    const first = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(first.state).toBe('UnderReview');
    expect(first.dualApprovalPending).toBe(true);
    expect(first.requiresDualApproval).toBe(true);
    expect(first.dualApprovalInitiatedBy).toBe(FIRST_STAFF);
    expect(first.confirmedBy).toBeNull();
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
    expect((await invoicePaid(invoiceId)).state).toBe('Unpaid');
    expect(await walletPosted()).toBe(beforeWallet);
    expect(await receiptState(receiptId)).toBe('UnderReview');

    const requests = await pendingApprovals(receiptId);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('pending');
    expect(requests[0]!.initiator_id).toBe(FIRST_STAFF);
    expect(BigInt(requests[0]!.amount_irr)).toBe(THRESHOLD);

    const requestedAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_DUAL_APPROVAL_REQUESTED_EVENT, receiptId]
    );
    expect(requestedAudit.rows).toHaveLength(1);

    const retry = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(retry.state).toBe('UnderReview');
    expect(retry.dualApprovalPending).toBe(true);
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
    expect(await pendingApprovals(receiptId)).toHaveLength(1);

    const second = await service.confirm({
      receiptId,
      actorUserId: SECOND_STAFF,
      ...receiptDecisionSession(SECOND_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(second.state).toBe('Confirmed');
    expect(second.dualApprovalPending).toBe(false);
    expect(second.confirmedBy).toBe(SECOND_STAFF);
    expect(second.dualApprovalInitiatedBy).toBe(FIRST_STAFF);
    expect((await invoicePaid(invoiceId)).paid).toBe(THRESHOLD);
    expect((await invoicePaid(invoiceId)).state).toBe('PartiallyFunded');
    expect(await receiptState(receiptId)).toBe('Confirmed');

    const after = await pendingApprovals(receiptId);
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('approved');
    expect(after[0]!.id).toBe(requests[0]!.id);

    const resolutionAudit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata::text AS metadata FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'requestId' = $2`,
      [APPROVAL_REQUEST_APPROVED_EVENT, requests[0]!.id]
    );
    expect(resolutionAudit.rows).toHaveLength(1);
    const resolutionMeta = JSON.parse(resolutionAudit.rows[0]!.metadata) as {
      initiatorUserId: string;
      reviewerUserId: string;
      actionType: string;
      amountIrR: number;
    };
    expect(resolutionMeta.initiatorUserId).toBe(FIRST_STAFF);
    expect(resolutionMeta.reviewerUserId).toBe(SECOND_STAFF);
    expect(resolutionMeta.actionType).toBe(INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ACTION_TYPE);
    expect(resolutionMeta.amountIrR).toBe(String(THRESHOLD));

    const confirmedAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_CONFIRMED_EVENT, receiptId]
    );
    expect(confirmedAudit.rows).toHaveLength(1);
  });

  it('parks amounts above the threshold the same way', async () => {
    await setThreshold(Number(THRESHOLD));
    const invoiceId = await insertInvoice({ total: 2_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD + 1n,
      suffix: 'above',
    });
    const first = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(first.state).toBe('UnderReview');
    expect(first.dualApprovalPending).toBe(true);
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
  });

  it('disables the gate when no threshold is configured', async () => {
    await setThreshold(null);
    const invoiceId = await insertInvoice({ total: 2_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 1_500_000n,
      suffix: 'disabled-missing',
    });
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(result.state).toBe('Confirmed');
    expect(result.dualApprovalPending).toBe(false);
    expect(await pendingApprovals(receiptId)).toHaveLength(0);
  });

  it('disables the gate when the threshold is 0', async () => {
    await setThreshold(0);
    const invoiceId = await insertInvoice({ total: 800_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 800_000n,
      suffix: 'disabled-zero',
    });
    const result = await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(result.state).toBe('Confirmed');
    expect((await invoicePaid(invoiceId)).state).toBe('Paid');
  });

  it('fails closed on a corrupt stored threshold', async () => {
    await setThreshold(null, { threshold_irr: -1 });
    const invoiceId = await insertInvoice({ total: 800_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: 800_000n,
      suffix: 'corrupt',
    });
    const rejection = await service
      .confirm({
        receiptId,
        actorUserId: FIRST_STAFF,
        ...receiptDecisionSession(FIRST_STAFF),
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(HttpException);
    expect((rejection as HttpException).getStatus()).toBe(409);
    expect((rejection as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.CONFIG_CORRUPT(),
    });
    expect(await receiptState(receiptId)).toBe('Submitted');
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
    expect(await pendingApprovals(receiptId)).toHaveLength(0);
  });

  it('rejects a parked receipt through the canonical dual-approval resolution', async () => {
    await setThreshold(Number(THRESHOLD));
    const invoiceId = await insertInvoice({ total: 2_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD,
      suffix: 'reject-parked',
    });
    const beforeWallet = await walletPosted();
    await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    const initiatorReject = await service
      .reject({
        receiptId,
        raw: { reason: 'Changed my mind' },
        actorUserId: FIRST_STAFF,
        ...receiptDecisionSession(FIRST_STAFF),
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error);
    expect(initiatorReject).toBeInstanceOf(HttpException);
    expect((initiatorReject as HttpException).getStatus()).toBe(403);
    expect((initiatorReject as HttpException).getResponse()).toMatchObject({
      error: ErrorCodes.AUTHZ_FORBIDDEN.code,
    });
    expect(await receiptState(receiptId)).toBe('UnderReview');
    expect((await pendingApprovals(receiptId))[0]!.status).toBe('pending');

    const rejected = await service.reject({
      receiptId,
      raw: { reason: 'Payer name does not match' },
      actorUserId: SECOND_STAFF,
      ...receiptDecisionSession(SECOND_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    expect(rejected.state).toBe('Rejected');
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
    expect(await walletPosted()).toBe(beforeWallet);
    const requests = await pendingApprovals(receiptId);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.status).toBe('rejected');

    const resolutionAudit = await ctx.pool.query<{ event: string; metadata: string }>(
      `SELECT event, metadata::text AS metadata FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'requestId' = $2`,
      [APPROVAL_REQUEST_REJECTED_EVENT, requests[0]!.id]
    );
    expect(resolutionAudit.rows).toHaveLength(1);
    const resolutionMeta = JSON.parse(resolutionAudit.rows[0]!.metadata) as {
      initiatorUserId: string;
      reviewerUserId: string;
      reviewReason: string;
    };
    expect(resolutionMeta.initiatorUserId).toBe(FIRST_STAFF);
    expect(resolutionMeta.reviewerUserId).toBe(SECOND_STAFF);
    expect(resolutionMeta.reviewReason).toBe('Payer name does not match');
  });

  it('does not restart confirmation after DualApprovalService rejects the request', async () => {
    await setThreshold(Number(THRESHOLD));
    const invoiceId = await insertInvoice({ total: 2_000_000n });
    const receiptId = await insertReceipt({
      invoiceId,
      amount: THRESHOLD,
      suffix: 'queue-reject',
    });
    const beforeWallet = await walletPosted();
    await service.confirm({
      receiptId,
      actorUserId: FIRST_STAFF,
      ...receiptDecisionSession(FIRST_STAFF),
      ip: '10.0.0.9',
      now: NOW,
    });
    const pending = await pendingApprovals(receiptId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('pending');

    const dualApproval = new DualApprovalService(
      new NotificationsService(),
      new InvoiceAdjustmentApprovalService(
        new CreateAdjustmentInvoiceService(
          new InvoiceStateMachineService(new InvoiceAuditRepository()),
          new DueAtCalculationService(new DueAtCalculationRepository())
        )
      )
    );
    const sessionId = uuidv7(),
      csrfToken = uuidv7();
    await ctx.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes',NOW())`,
      [sessionId, SECOND_STAFF, csrfToken]
    );
    await dualApproval.rejectApprovalRequest(
      pending[0]!.id,
      { userId: SECOND_STAFF, sessionId, csrfToken },
      '10.0.0.9',
      'Payer name does not match'
    );

    expect(await receiptState(receiptId)).toBe('UnderReview');
    const afterQueueReject = await pendingApprovals(receiptId);
    expect(afterQueueReject).toHaveLength(1);
    expect(afterQueueReject[0]!.status).toBe('rejected');

    const retry = await service
      .confirm({
        receiptId,
        actorUserId: FIRST_STAFF,
        ...receiptDecisionSession(FIRST_STAFF),
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error);
    expect(retry).toBeInstanceOf(HttpException);
    expect((retry as HttpException).getStatus()).toBe(409);
    expect((retry as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_DUAL_APPROVAL_ERRORS.APPROVAL_REJECTED(),
    });
    expect(await receiptState(receiptId)).toBe('Rejected');
    expect((await invoicePaid(invoiceId)).paid).toBe(0n);
    expect(await walletPosted()).toBe(beforeWallet);

    const afterConfirm = await pendingApprovals(receiptId);
    expect(afterConfirm).toHaveLength(1);
    expect(afterConfirm[0]!.status).toBe('rejected');

    const rejectedAudit = await ctx.pool.query<{ event: string }>(
      `SELECT event FROM audit_log
        WHERE event = $1 AND metadata::jsonb ->> 'receiptId' = $2`,
      [INVOICE_BANK_RECEIPT_REJECTED_EVENT, receiptId]
    );
    expect(rejectedAudit.rows).toHaveLength(1);

    const secondRetry = await service
      .confirm({
        receiptId,
        actorUserId: SECOND_STAFF,
        ...receiptDecisionSession(SECOND_STAFF),
        ip: '10.0.0.9',
        now: NOW,
      })
      .catch((error: unknown) => error);
    expect(secondRetry).toBeInstanceOf(HttpException);
    expect((secondRetry as HttpException).getStatus()).toBe(409);
    expect((secondRetry as HttpException).getResponse()).toMatchObject({
      message: INVOICE_BANK_RECEIPT_CONFIRM_ERRORS.ALREADY_REJECTED(),
    });
    expect(await pendingApprovals(receiptId)).toHaveLength(1);
  });
});
