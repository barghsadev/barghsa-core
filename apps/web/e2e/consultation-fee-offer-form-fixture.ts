import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { ConsultationFeeReview, ConsultationPaidFeeReview } from '@barghsa/shared/finance';
import { fullNavigation } from './navigation-fixture';
import {
  setupConsultationForms,
  informationRequest,
  unpaidRequest,
  paidRequest,
} from './consultation-form-fixture';

export { informationRequest, unpaidRequest, paidRequest };
export const originalDeadline = '2030-01-01T09:00:45.678Z';
export const originalInvoice = '73000000-0000-4000-8000-000000000007';
const uuid = (n: number, version = 4) =>
  `79000000-0000-${version}000-8000-${String(n).padStart(12, '0')}`;
export type FeeTerms = {
  fee: string;
  scope: string;
  deliverables: string;
  validUntil: string;
  reason?: string;
};
export type PaidTerms = { fee: string; reason: string; validUntil: string };
type PreviewMode = 'success' | 'owned' | 'mixed' | 'held' | 'foreign' | 'denied' | 'missing';
type WriteMode = 'success' | 'held' | 'rejected';
export type FeeCommand = {
  id: string;
  family: 'fee' | 'paid-fee';
  body: Record<string, string>;
  raw: string;
  csrf: string | null;
};
type Invoice = {
  id: string;
  requestId: string;
  state: string;
  totalAmount: string;
  paidAmount: string;
  available: string;
};
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
function snapshot<T>(action: string, id: string, profileId: string, data: T) {
  const value = { schemaVersion: 1 as const, scope: { action, resourceId: id, profileId }, data };
  return {
    ...value,
    hash: createHash('sha256')
      .update(JSON.stringify(canonical(value)))
      .digest('hex'),
  };
}
/** Stored audit JSONB may reorder object keys without changing ordered refund allocations. */
export function jsonbOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, jsonbOrder(child)])
    );
  return value;
}
export async function setupConsultationFeeOffers(page: Page, locale: 'en' | 'fa') {
  const shell = await setupConsultationForms(page, locale, locale === 'fa');
  const rows = shell.state.rows;
  rows[informationRequest]!.profile_name = 'Initial consultation buyer';
  rows[unpaidRequest]!.profile_name = 'Replacement consultation buyer';
  rows[unpaidRequest]!.profile_id = uuid(11);
  rows[paidRequest]!.profile_name = 'Paid consultation buyer';
  rows[paidRequest]!.profile_id = uuid(12);
  rows[unpaidRequest]!.offer_valid_until = originalDeadline;
  rows[paidRequest]!.offer_valid_until = originalDeadline;
  const invoices = new Map<string, Invoice>([
    [
      originalInvoice,
      {
        id: originalInvoice,
        requestId: paidRequest,
        state: 'Paid',
        totalAmount: '500000',
        paidAmount: '500000',
        available: '500000',
      },
    ],
    [
      rows[unpaidRequest]!.invoice_id!,
      {
        id: rows[unpaidRequest]!.invoice_id!,
        requestId: unpaidRequest,
        state: 'Unpaid',
        totalAmount: '500000',
        paidAmount: '0',
        available: '0',
      },
    ],
  ]);
  const state = {
    rows,
    invoices,
    reads: [] as string[],
    previewMode: 'success' as PreviewMode,
    writeMode: 'success' as WriteMode,
    ownedFields: ['fee'],
    previews: [] as FeeCommand[],
    writes: [] as FeeCommand[],
    heldPreview: undefined as Route | undefined,
    heldWrite: undefined as Route | undefined,
    detailDenied: false,
    timezone: 'Asia/Tehran',
    holdTimezone: false,
    heldTimezone: undefined as Route | undefined,
    needsStepUp: false,
    csrf: 'consultation-fee-initial',
    verifications: [] as { password: string }[],
    effects: 0,
  };
  const saved = new Map<string, Record<string, unknown>>();
  const savedCommands = new Map<string, string>();
  const detail = (id: string) => {
    const request = { ...rows[id]! };
    // These fields from the reused old shell are not emitted by actual detail().
    const wire = request as Record<string, unknown>;
    delete wire.refund_pending;
    delete wire.staff_owner_username;
    return { request, history: structuredClone(shell.state.histories[id]) };
  };
  function feeReview(id: string, input: FeeTerms): ConsultationFeeReview {
    const row = rows[id]!;
    const previous = row.invoice_id ? invoices.get(row.invoice_id)! : null;
    return snapshot('consultation.fee-offer', id, row.profile_id, {
      serviceTitle: row.product_snapshot.title,
      profileName: row.profile_name,
      scope: input.scope,
      deliverables: input.deliverables,
      fee: input.fee,
      validUntil: new Date(input.validUntil).toISOString(),
      reason: previous ? input.reason!.trim() : null,
      previousInvoice: previous
        ? { id: previous.id, state: previous.state, totalAmount: previous.totalAmount }
        : null,
      outcome: previous ? 'replace_unpaid_invoice' : 'issue_invoice',
    }) as ConsultationFeeReview;
  }
  function paidReview(id: string, input: PaidTerms): ConsultationPaidFeeReview {
    const row = rows[id]!,
      paid = invoices.get(row.invoice_id!)!;
    const difference = BigInt(input.fee) - BigInt(row.fee!);
    const refundPlan: ConsultationPaidFeeReview['data']['refundPlan'] = [];
    if (difference < 0n) {
      let remaining = -difference;
      for (const invoice of [...invoices.values()].reverse()) {
        if (remaining === 0n) break;
        if (
          invoice.requestId !== id ||
          BigInt(invoice.available) <= 0n ||
          !['Paid', 'PartiallyRefunded'].includes(invoice.state)
        )
          continue;
        const available = BigInt(invoice.available),
          amount = remaining < available ? remaining : available;
        refundPlan.push({
          invoiceId: invoice.id,
          amount: amount.toString(),
          availableBefore: invoice.available,
        });
        remaining -= amount;
      }
      if (remaining) throw new Error('Fixture credit exceeds actual available payments');
    }
    return snapshot('consultation.paid-fee-adjustment', id, row.profile_id, {
      serviceTitle: row.product_snapshot.title,
      profileName: row.profile_name,
      scope: row.scope!,
      deliverables: row.deliverables!,
      previousFee: row.fee!,
      revisedFee: input.fee,
      difference: difference.toString(),
      adjustmentAmount: (difference < 0n ? -difference : difference).toString(),
      reason: input.reason,
      validUntil: new Date(input.validUntil).toISOString(),
      paidInvoice: {
        id: paid.id,
        state: paid.state,
        totalAmount: paid.totalAmount,
        paidAmount: paid.paidAmount,
      },
      refundPlan,
      outcome: difference > 0n ? 'charge_invoice' : 'credit_and_wallet_refund',
    }) as ConsultationPaidFeeReview;
  }
  function persist(command: FeeCommand) {
    const key = `${command.id}:${command.body.idempotencyKey}`;
    if (saved.has(key)) {
      if (savedCommands.get(key) !== command.raw)
        throw new Error('Fixture replay changed captured body');
      return structuredClone(saved.get(key)!);
    }
    const row = rows[command.id]!,
      body = command.body;
    const review =
      command.family === 'fee'
        ? feeReview(command.id, body as unknown as FeeTerms)
        : paidReview(command.id, body as unknown as PaidTerms);
    if (review.hash !== body.expectedReviewHash) throw new Error('Fixture review mismatch');
    const invoiceId = uuid(100 + state.effects, 7);
    let result: Record<string, unknown>;
    if (command.family === 'fee') {
      if (row.invoice_id) invoices.get(row.invoice_id)!.state = 'Cancelled';
      invoices.set(invoiceId, {
        id: invoiceId,
        requestId: command.id,
        state: 'Unpaid',
        totalAmount: body.fee!,
        paidAmount: '0',
        available: '0',
      });
      result = {
        requestId: command.id,
        status: 'offer_pending',
        invoiceId,
        financialReview: review,
      };
      row.scope = body.scope!;
      row.deliverables = body.deliverables!;
      row.offer_valid_until = new Date(body.validUntil!).toISOString();
      row.invoice_id = invoiceId;
      row.invoice_state = 'Unpaid';
      row.status = 'offer_pending';
      row.accepted_at = null;
    } else {
      const paid = review as ConsultationPaidFeeReview;
      const charge = BigInt(paid.data.difference) > 0n;
      const refundIds = paid.data.refundPlan.map((_, index) =>
        uuid(200 + state.effects * 10 + index, 7)
      );
      result = {
        requestId: command.id,
        status: charge ? 'offer_pending' : 'offer_accepted',
        invoiceId: charge ? invoiceId : paid.data.paidInvoice.id,
        adjustmentInvoiceId: invoiceId,
        refundIds,
        financialReview: review,
      };
      // Credit invoice is not a paid invoice available to the later refund allocation.
      if (charge) {
        invoices.set(invoiceId, {
          id: invoiceId,
          requestId: command.id,
          state: 'Unpaid',
          totalAmount: paid.data.adjustmentAmount,
          paidAmount: '0',
          available: '0',
        });
        row.invoice_id = invoiceId;
        row.invoice_state = 'Unpaid';
        row.offer_valid_until = new Date(body.validUntil!).toISOString();
        row.accepted_at = null;
      } else {
        for (const allocation of paid.data.refundPlan) {
          const invoice = invoices.get(allocation.invoiceId)!;
          invoice.available = (BigInt(invoice.available) - BigInt(allocation.amount)).toString();
        }
      }
      row.status = charge ? 'offer_pending' : 'offer_accepted';
    }
    row.fee = body.fee!;
    shell.state.histories[command.id]!.push({
      status: row.status,
      actor_type: 'staff',
      actor_name: 'Fee reviewer',
      reason: body.reason ?? null,
      created_at: '2026-10-05T12:00:00.000Z',
    });
    ++state.effects;
    saved.set(key, structuredClone(result));
    savedCommands.set(key, command.raw);
    return structuredClone(result);
  }
  function acceptAndPay(id: string) {
    const row = rows[id]!,
      invoice = invoices.get(row.invoice_id!)!;
    invoice.state = 'Paid';
    invoice.paidAmount = invoice.totalAmount;
    invoice.available = invoice.totalAmount;
    row.status = 'offer_accepted';
    row.invoice_state = 'Paid';
    row.has_paid_invoice = true;
    row.accepted_at = '2026-10-05T12:01:00.000Z';
    shell.state.histories[id]!.push({
      status: 'offer_accepted',
      actor_type: 'customer',
      actor_name: row.profile_name,
      reason: null,
      created_at: row.accepted_at,
    });
  }
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          correlationId: uuid(90),
          message: 'PRIVATE_FEE_SERVER_TEXT',
          ...(fields ? { fields } : {}),
        },
      },
    });
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      headers: { 'set-cookie': `barghsa_csrf=${state.csrf}; Path=/; SameSite=Lax` },
      json: {
        userId: 'consultation-fee-staff',
        isStaff: true,
        operatingContext: 'staff',
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) => {
    if (state.holdTimezone) {
      state.heldTimezone = route;
      return;
    }
    return route.fulfill({ json: { timezone: state.timezone } });
  });
  await page.route('**/api/profile-invitations?*', (route) =>
    route.fulfill({ json: { invitations: [], nextAfter: null } })
  );
  await page.route(/\/api\/admin\/consultations\/requests(?:\?[^/]*)?$/, (route) => {
    state.reads.push(route.request().url());
    return route.fulfill({
      json: {
        requests: [rows[informationRequest], rows[unpaidRequest], rows[paidRequest]],
        nextAfter: null,
      },
    });
  });
  await page.route(/\/api\/admin\/consultations\/requests\/[^/?]+$/, (route) => {
    state.reads.push(route.request().url());
    return state.detailDenied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({ json: detail(new URL(route.request().url()).pathname.split('/').at(-1)!) });
  });
  await page.route(
    /\/api\/admin\/consultations\/requests\/[^/?]+\/(fee-review|paid-fee-review)$/,
    (route) => {
      const pieces = new URL(route.request().url()).pathname.split('/'),
        id = pieces.at(-2)!;
      const family = pieces.at(-1) === 'fee-review' ? 'fee' : 'paid-fee';
      const body = route.request().postDataJSON() as Record<string, string>;
      state.previews.push({
        id,
        family,
        body,
        raw: route.request().postData()!,
        csrf: route.request().headers()['x-csrf-token'] ?? null,
      });
      if (state.previewMode === 'held') {
        state.heldPreview = route;
        return;
      }
      if (state.previewMode === 'owned' || state.previewMode === 'mixed')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, [
          ...state.ownedFields,
          ...(state.previewMode === 'mixed' ? ['expectedReviewHash'] : []),
        ]);
      if (state.previewMode === 'denied' || state.previewMode === 'missing')
        return error(
          route,
          state.previewMode === 'denied' ? 403 : 404,
          state.previewMode === 'denied'
            ? ErrorCodes.AUTHZ_FORBIDDEN.code
            : ErrorCodes.NOT_FOUND_RESOURCE.code
        );
      const review =
        family === 'fee'
          ? feeReview(id, body as unknown as FeeTerms)
          : paidReview(id, body as unknown as PaidTerms);
      return route.fulfill({
        json:
          state.previewMode === 'foreign'
            ? { ...review, scope: { ...review.scope, resourceId: uuid(99) } }
            : review,
      });
    }
  );
  await page.route(/\/api\/admin\/consultations\/requests\/[^/?]+\/(fee|paid-fee)$/, (route) => {
    const pieces = new URL(route.request().url()).pathname.split('/'),
      id = pieces.at(-2)!;
    const command: FeeCommand = {
      id,
      family: pieces.at(-1) === 'fee' ? 'fee' : 'paid-fee',
      body: route.request().postDataJSON(),
      raw: route.request().postData()!,
      csrf: route.request().headers()['x-csrf-token'] ?? null,
    };
    state.writes.push(command);
    if (state.needsStepUp)
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
    return route.fulfill({ json: jsonbOrder(persist(command)) });
  });
  await page.route('**/api/auth/step-up', (route) => {
    state.verifications.push(route.request().postDataJSON());
    state.needsStepUp = false;
    state.csrf = 'consultation-fee-rotated';
    return route.fulfill({
      headers: { 'set-cookie': `barghsa_csrf=${state.csrf}; Path=/; SameSite=Lax` },
      json: { verified: true },
    });
  });
  return { state, feeReview, paidReview, persist, acceptAndPay, detail };
}
