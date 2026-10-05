import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ConsultationPaidResolutionReview } from '@barghsa/shared/finance';
import {
  setupConsultationFeeOffers,
  paidRequest,
  unpaidRequest,
  originalInvoice,
  jsonbOrder,
} from './consultation-fee-offer-form-fixture';

export {
  paidRequest as closureRequest,
  unpaidRequest as recoveryRequest,
  originalInvoice as closureOriginal,
  jsonbOrder,
};
export type ResolutionAction = 'cancel' | 'reject' | 'recover_refund';
export type ResolutionCommand = {
  id: string;
  path: string;
  body: Record<string, string>;
  raw: string;
  csrf: string | null;
};
type PreviewMode = 'success' | 'owned' | 'mixed' | 'foreign' | 'held' | 'denied' | 'missing';
type WriteMode = 'success' | 'held' | 'rejected' | 'owned' | 'mixed' | 'denied';
const uuid = (n: number, version = 4) =>
  `7a000000-0000-${version}000-8000-${String(n).padStart(12, '0')}`;
export const closurePaidCharge = uuid(1);
export const closureUnpaidCharge = uuid(2);
export const recoveryOriginal = uuid(3);
export const recoveryPaidCharge = uuid(4);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}
export async function setupConsultationPaidResolution(page: Page, locale: 'en' | 'fa') {
  // Reuse the published shell, native password flow and mutable current CSRF cookie.
  const shell = await setupConsultationFeeOffers(page, locale);
  const invoices = shell.state.invoices;
  const rows: Record<
    string,
    Omit<(typeof shell.state.rows)[string], 'invoice_state'> & { invoice_state: string | null }
  > = shell.state.rows;
  const adjustmentKinds = new Map<string, string | null>();
  adjustmentKinds.set(originalInvoice, null);
  invoices.set(closurePaidCharge, {
    id: closurePaidCharge,
    requestId: paidRequest,
    state: 'Paid',
    totalAmount: '200000',
    paidAmount: '200000',
    available: '200000',
  });
  adjustmentKinds.set(closurePaidCharge, 'charge');
  if (locale === 'en') {
    invoices.set(closureUnpaidCharge, {
      id: closureUnpaidCharge,
      requestId: paidRequest,
      state: 'Unpaid',
      totalAmount: '150000',
      paidAmount: '0',
      available: '0',
    });
    adjustmentKinds.set(closureUnpaidCharge, 'charge');
  }
  Object.assign(rows[paidRequest]!, {
    profile_name: 'Paid closure buyer',
    status: locale === 'en' ? 'offer_pending' : 'offer_accepted',
    invoice_id: locale === 'en' ? closureUnpaidCharge : closurePaidCharge,
    invoice_state: locale === 'en' ? 'Unpaid' : 'Paid',
    fee: locale === 'en' ? '850000' : '700000',
    uncovered_credit: '0',
    has_paid_invoice: true,
    accepted_at: locale === 'en' ? null : '2026-09-23T10:00:00.000Z',
  });
  invoices.delete(rows[unpaidRequest]!.invoice_id!);
  invoices.set(recoveryOriginal, {
    id: recoveryOriginal,
    requestId: unpaidRequest,
    state: 'Paid',
    totalAmount: '450000',
    paidAmount: '450000',
    available: '450000',
  });
  invoices.set(recoveryPaidCharge, {
    id: recoveryPaidCharge,
    requestId: unpaidRequest,
    state: 'Paid',
    totalAmount: '200000',
    paidAmount: '200000',
    available: '200000',
  });
  adjustmentKinds.set(recoveryOriginal, null);
  adjustmentKinds.set(recoveryPaidCharge, 'charge');
  Object.assign(rows[unpaidRequest]!, {
    profile_name: 'Refund recovery buyer',
    status: 'offer_accepted',
    invoice_id: recoveryPaidCharge,
    invoice_state: 'Paid',
    has_paid_invoice: true,
    // A prior650000→300000 credit remains uncovered after its refund requests were rejected.
    fee: '300000',
    uncovered_credit: '350000',
    accepted_at: '2026-09-23T10:00:00.000Z',
  });
  const state = {
    rows,
    invoices,
    reads: [] as string[],
    previews: [] as ResolutionCommand[],
    writes: [] as ResolutionCommand[],
    previewMode: 'success' as PreviewMode,
    writeMode: 'success' as WriteMode,
    heldPreview: undefined as Route | undefined,
    heldWrite: undefined as Route | undefined,
    heldDetail: undefined as Route | undefined,
    holdDetail: false,
    detailMode: 'success' as 'success' | 'denied' | 'missing',
    effects: 0,
    shell: shell.state,
  };
  const saved = new Map<string, { raw: string; receipt: Record<string, unknown> }>();
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          correlationId: uuid(90),
          message: 'PRIVATE_RESOLUTION_SERVER_TEXT',
          ...(fields ? { fields } : {}),
        },
      },
    });
  function review(
    id: string,
    action: ResolutionAction,
    reason: string
  ): ConsultationPaidResolutionReview {
    const row = rows[id]!;
    const current = row.invoice_id ? invoices.get(row.invoice_id)! : null;
    const recovery = action === 'recover_refund';
    let remaining = recovery ? BigInt(row.uncovered_credit) : 0n;
    const allocations: ConsultationPaidResolutionReview['data']['refundAllocations'] = [];
    // Insertion order models service ORDER BY created_at DESC,id DESC for paid invoices.
    for (const invoice of [...invoices.values()].reverse()) {
      if (recovery && remaining === 0n) break;
      if (invoice.requestId !== id || !['Paid', 'PartiallyRefunded'].includes(invoice.state))
        continue;
      const available = BigInt(invoice.available);
      if (available <= 0n) continue;
      const amount = recovery && remaining < available ? remaining : available;
      allocations.push({
        invoiceId: invoice.id,
        state: invoice.state,
        amount: amount.toString(),
        availableBefore: invoice.available,
      });
      if (recovery) remaining -= amount;
    }
    if (remaining !== 0n) throw new Error('Fixture recovery exceeds available payment balance');
    const total = allocations.reduce((sum, item) => sum + BigInt(item.amount), 0n).toString();
    const data: ConsultationPaidResolutionReview['data'] = {
      action,
      serviceTitle: row.product_snapshot.title,
      profileName: row.profile_name,
      currentStatus: row.status,
      resultingStatus: recovery ? row.status : action === 'cancel' ? 'cancelled' : 'rejected',
      reason,
      currentInvoice: current
        ? {
            id: current.id,
            state: current.state,
            paidAmount: current.paidAmount,
            adjustmentKind: adjustmentKinds.get(current.id) ?? null,
          }
        : null,
      cancelInvoiceId:
        !recovery &&
        current &&
        current.paidAmount === '0' &&
        adjustmentKinds.get(current.id) !== 'credit'
          ? current.id
          : null,
      uncoveredCreditBefore: recovery ? row.uncovered_credit : '0',
      refundAllocations: allocations,
      totalCredit: recovery ? '0' : total,
      totalRefund: total,
    };
    const value = {
      schemaVersion: 1 as const,
      scope: {
        action: 'consultation.paid-resolution' as const,
        profileId: row.profile_id,
        resourceId: id,
      },
      data,
    };
    return {
      ...value,
      hash: createHash('sha256')
        .update(JSON.stringify(canonical(value)))
        .digest('hex'),
    };
  }
  function persist(command: ResolutionCommand) {
    const key = `${command.id}:${command.body.idempotencyKey}`;
    const previous = saved.get(key);
    if (previous) {
      if (previous.raw !== command.raw)
        throw new Error('Fixture replay changed exact captured body');
      return structuredClone(previous.receipt);
    }
    const action: ResolutionAction =
      command.path === 'refund-recovery'
        ? 'recover_refund'
        : command.path === 'paid-cancel'
          ? 'cancel'
          : 'reject';
    const captured = review(command.id, action, command.body.reason!);
    if (captured.hash !== command.body.expectedReviewHash)
      throw new Error('Fixture review mismatch');
    const refundIds = captured.data.refundAllocations.map((_, index) =>
      uuid(100 + state.effects * 20 + index, 7)
    );
    const receipt: Record<string, unknown> = {
      requestId: command.id,
      status: captured.data.resultingStatus,
      refundIds,
      financialReview: captured,
      ...(action === 'recover_refund'
        ? {}
        : {
            cancelledInvoiceId: captured.data.cancelInvoiceId,
            creditInvoiceIds: captured.data.refundAllocations.map((_, index) =>
              uuid(110 + state.effects * 20 + index, 7)
            ),
          }),
    };
    if (captured.data.cancelInvoiceId)
      invoices.get(captured.data.cancelInvoiceId)!.state = 'Cancelled';
    for (const allocation of captured.data.refundAllocations) {
      const invoice = invoices.get(allocation.invoiceId)!;
      invoice.available = (BigInt(invoice.available) - BigInt(allocation.amount)).toString();
    }
    rows[command.id]!.status = captured.data.resultingStatus;
    rows[command.id]!.uncovered_credit = '0';
    if (captured.data.cancelInvoiceId) rows[command.id]!.invoice_state = 'Cancelled';
    histories.get(command.id)!.push({
      status: captured.data.resultingStatus,
      actor_type: 'staff',
      actor_name: 'Staff reviewer',
      reason: command.body.reason!,
      created_at: '2026-10-05T01:00:00.000Z',
    });
    state.effects++;
    saved.set(key, { raw: command.raw, receipt: structuredClone(receipt) });
    return structuredClone(receipt);
  }
  function progressRefunds(id: string) {
    for (const invoice of invoices.values())
      if (invoice.requestId === id && BigInt(invoice.paidAmount) > 0n)
        invoice.state = invoice.available === '0' ? 'Refunded' : 'PartiallyRefunded';
    const current = invoices.get(rows[id]!.invoice_id!);
    if (current) rows[id]!.invoice_state = current.state;
  }
  const histories = new Map(Object.keys(rows).map((id) => [id, shell.detail(id).history]));
  const detail = (id: string) => ({
    ...shell.detail(id),
    history: structuredClone(histories.get(id)),
  });
  await page.route('**/api/admin/consultations/teams', (route) =>
    route.fulfill({ json: { teams: [{ name: 'Operations' }] } })
  );
  await page.route(/\/api\/admin\/consultations\/requests(?:\?[^/]*)?$/, (route) => {
    state.reads.push(route.request().url());
    const status = new URL(route.request().url()).searchParams.get('status');
    const requests = [rows[paidRequest]!, rows[unpaidRequest]!]
      .filter((row) =>
        status
          ? row.status === status
          : !['offer_declined', 'completed', 'rejected', 'cancelled'].includes(row.status)
      )
      .map((row) => ({
        id: row.id,
        profile_id: row.profile_id,
        status: row.status,
        product_snapshot: row.product_snapshot,
        staff_owner_id: row.staff_owner_id,
        staff_team: row.staff_team,
        submitted_at: row.submitted_at,
        expected_next_step: row.expected_next_step,
        priority: 'high',
        profile_name: row.profile_name,
        staff_owner_name: row.staff_owner_name,
      }));
    return route.fulfill({ json: { requests, nextAfter: null } });
  });
  await page.route(/\/api\/admin\/consultations\/requests\/[^/?]+$/, (route) => {
    state.reads.push(route.request().url());
    if (state.holdDetail) {
      state.heldDetail = route;
      return;
    }
    if (state.detailMode !== 'success')
      return error(
        route,
        state.detailMode === 'missing' ? 404 : 403,
        state.detailMode === 'missing'
          ? ErrorCodes.NOT_FOUND_RESOURCE.code
          : ErrorCodes.AUTHZ_FORBIDDEN.code
      );
    return route.fulfill({
      json: detail(new URL(route.request().url()).pathname.split('/').at(-1)!),
    });
  });
  await page.route(
    /\/api\/admin\/consultations\/requests\/[^/?]+\/paid-resolution-review$/,
    (route) => {
      const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
      const command: ResolutionCommand = {
        id,
        path: 'paid-resolution-review',
        body: route.request().postDataJSON(),
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      };
      state.previews.push(command);
      if (state.previewMode === 'held') {
        state.heldPreview = route;
        return;
      }
      if (state.previewMode === 'owned' || state.previewMode === 'mixed')
        return error(
          route,
          400,
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          state.previewMode === 'owned' ? ['reason'] : ['reason', 'action']
        );
      if (state.previewMode === 'denied' || state.previewMode === 'missing')
        return error(
          route,
          state.previewMode === 'missing' ? 404 : 403,
          state.previewMode === 'missing'
            ? ErrorCodes.NOT_FOUND_RESOURCE.code
            : ErrorCodes.AUTHZ_FORBIDDEN.code
        );
      const value = review(id, command.body.action as ResolutionAction, command.body.reason!);
      return route.fulfill({
        json:
          state.previewMode === 'foreign'
            ? { ...value, scope: { ...value.scope, resourceId: uuid(99) } }
            : value,
      });
    }
  );
  await page.route(
    /\/api\/admin\/consultations\/requests\/[^/?]+\/(paid-cancel|paid-reject|refund-recovery)$/,
    (route) => {
      const parts = new URL(route.request().url()).pathname.split('/');
      const command: ResolutionCommand = {
        id: parts.at(-2)!,
        path: parts.at(-1)!,
        body: route.request().postDataJSON(),
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      };
      state.writes.push(command);
      if (shell.state.needsStepUp)
        return route.fulfill({
          status: 403,
          json: {
            requiresStepUp: true,
            error: {
              code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
              correlationId: uuid(90),
              message: 'Step-up required',
            },
          },
        });
      if (state.writeMode === 'held') {
        state.heldWrite = route;
        return;
      }
      if (state.writeMode === 'rejected') return error(route, 409, ErrorCodes.CONFLICT_STATE.code);
      if (state.writeMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
      if (state.writeMode === 'owned' || state.writeMode === 'mixed')
        return error(
          route,
          400,
          ErrorCodes.VALIDATION_INPUT_INVALID.code,
          state.writeMode === 'owned' ? ['reason'] : ['reason', 'expectedReviewHash']
        );
      return route.fulfill({ json: jsonbOrder(persist(command)) });
    }
  );
  return { state, review, persist, progressRefunds, detail };
}
