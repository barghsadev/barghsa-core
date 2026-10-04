import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { fullNavigation } from './navigation-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';

export const consultationProfile = '73000000-0000-4000-8000-000000000001';
export const consultationProduct = '73000000-0000-4000-8000-000000000002';
export const informationRequest = '73000000-0000-4000-8000-000000000003';
export const unpaidRequest = '73000000-0000-4000-8000-000000000004';
export const paidRequest = '73000000-0000-4000-8000-000000000005';
export const createdRequest = '73000000-0000-4000-8000-000000000006';
const invoiceId = '73000000-0000-4000-8000-000000000007';
const unpaidInvoiceId = '73000000-0000-4000-8000-000000000008';
const submittedAt = '2026-09-23T10:00:00.000Z';
const title = { en: 'Energy consultation', fa: 'مشاوره انرژی' };
type History = {
  status: string;
  actor_type: 'staff' | 'customer';
  actor_name: string | null;
  reason: string | null;
  created_at: string;
};
type Intake = { profileId: string; productId: string; submissionKey: string };
type Command = { id: string; path: string; body: Record<string, unknown> };
const invalid = (route: Route, fields: string[]) =>
  route.fulfill({
    status: 400,
    json: {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        fields,
        message: 'PRIVATE_SERVER_VALIDATION_TEXT',
        correlationId: 'consultation-form-validation',
      },
    },
  });

export async function setupConsultationForms(
  page: Page,
  locale: 'en' | 'fa',
  dark: boolean,
  customer = false
) {
  await setupCatalogueForms(page, locale, dark);
  if (customer)
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'consultation-customer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          { id: consultationProfile, profileType: 'INDIVIDUAL', title: 'Consultation buyer' },
        ],
        activeProfileId: consultationProfile,
        hasDefault: true,
      },
    })
  );
  const request = (
    id: string,
    status: string,
    name: string,
    invoice: 'Unpaid' | 'Paid' | null
  ) => ({
    id,
    profile_id: consultationProfile,
    profile_name: name,
    status,
    product_snapshot: { title },
    submitted_at: submittedAt,
    staff_owner_id: null,
    staff_owner_name: null,
    staff_owner_username: null,
    staff_team: null,
    priority: 'normal',
    fee: invoice ? '500000' : null,
    scope: invoice ? 'Supply assessment' : null,
    deliverables: invoice ? 'Written report' : null,
    expected_next_step: null,
    offer_valid_until: invoice ? '2030-01-01T09:00:00.000Z' : null,
    invoice_id: invoice === 'Paid' ? invoiceId : invoice === 'Unpaid' ? unpaidInvoiceId : null,
    invoice_state: invoice,
    has_paid_invoice: invoice === 'Paid',
    accepted_at: invoice === 'Paid' ? submittedAt : null,
    uncovered_credit: '0',
    refund_pending: false,
  });
  const rows: Record<string, ReturnType<typeof request>> = {
    [informationRequest]: request(
      informationRequest,
      customer ? 'awaiting_customer_info' : 'under_review',
      'Information buyer',
      null
    ),
    [unpaidRequest]: request(unpaidRequest, 'offer_pending', 'Unpaid buyer', 'Unpaid'),
    [paidRequest]: request(paidRequest, 'offer_accepted', 'Paid buyer', 'Paid'),
    [createdRequest]: request(createdRequest, 'submitted', 'New buyer', null),
  };
  const initialHistory = (status: string): History[] => [
    {
      status: 'submitted',
      actor_type: 'customer',
      actor_name: 'Consultation buyer',
      reason: null,
      created_at: submittedAt,
    },
    {
      status,
      actor_type: 'staff',
      actor_name: 'Staff reviewer',
      reason: 'PRIVATE_EXISTING_REQUEST_CONTEXT',
      created_at: '2026-09-23T11:00:00.000Z',
    },
  ];
  const histories: Record<string, History[]> = Object.fromEntries(
    Object.values(rows).map((row) => [row.id, initialHistory(row.status)])
  );
  const state = {
    productsDenied: false,
    intakeMode: 'owned' as 'owned' | 'unsafe' | 'held' | 'malformed' | 'success',
    replyMode: 'owned' as 'owned' | 'unsafe' | 'held' | 'malformed' | 'success' | 'denied',
    detailMode: 'success' as 'success' | 'held' | 'denied' | 'wrong-profile',
    staffMode: 'owned' as 'owned' | 'unsafe' | 'held' | 'malformed' | 'success' | 'denied',
    intake: undefined as Route | undefined,
    reply: undefined as Route | undefined,
    detailRead: undefined as Route | undefined,
    staffCommand: undefined as Route | undefined,
    stepUp: undefined as Route | undefined,
    intakeWrites: [] as Intake[],
    replyWrites: [] as Command[],
    staffWrites: [] as Command[],
    paidPreviews: [] as Record<string, unknown>[],
    detailReads: [] as string[],
    queueReads: 0,
    verifications: 0,
    verified: false,
    created: false,
    rows,
    histories,
  };
  const detail = (id: string) => ({
    request: { ...rows[id]! },
    history: structuredClone(histories[id]),
    adjustments: [],
    refunds: [],
  });
  const persist = (id: string, status: string, reason: string, actor: 'staff' | 'customer') => {
    rows[id]!.status = status;
    histories[id]!.push({
      status,
      actor_type: actor,
      actor_name: actor === 'customer' ? 'Consultation buyer' : 'Staff reviewer',
      reason,
      created_at: '2026-09-23T12:00:00.000Z',
    });
  };
  await page.route('**/api/consultations/products?*', (route) =>
    route.fulfill({
      status: state.productsDenied ? 403 : 200,
      json: {
        products: [
          {
            id: consultationProduct,
            systemKey: null,
            title,
            description: { en: 'Assess your supply.', fa: 'ارزیابی تأمین انرژی.' },
          },
        ],
      },
    })
  );
  await page.route('**/api/consultations/requests?*', (route) =>
    route.fulfill({
      json: { requests: state.created ? [rows[createdRequest]] : [], nextBefore: null },
    })
  );
  await page.route('**/api/consultations/requests', (route) => {
    state.intakeWrites.push(route.request().postDataJSON());
    if (state.intakeMode === 'owned') return invalid(route, ['productId']);
    if (state.intakeMode === 'unsafe') return invalid(route, ['productId', 'submissionKey']);
    if (state.intakeMode === 'held') {
      state.intake = route;
      return;
    }
    state.created = true;
    return route.fulfill({
      status: 201,
      json:
        state.intakeMode === 'malformed'
          ? { requestId: createdRequest }
          : { requestId: createdRequest, status: 'submitted' },
    });
  });
  await page.route('**/api/consultations/requests/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    state.detailReads.push(id);
    if (state.detailMode === 'held') {
      state.detailRead = route;
      return;
    }
    if (state.detailMode === 'denied') return route.fulfill({ status: 403, json: {} });
    const result = detail(id);
    if (state.detailMode === 'wrong-profile')
      result.request.profile_id = '74000000-0000-4000-8000-000000000001';
    return route.fulfill({ json: result });
  });
  await page.route('**/api/consultations/requests/*/provide-info', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)!;
    const body = route.request().postDataJSON() as { reason: string };
    state.replyWrites.push({ id, path: 'provide-info', body });
    if (state.replyMode === 'owned') return invalid(route, ['reason']);
    if (state.replyMode === 'unsafe') return invalid(route, ['reason', 'PRIVATE_REQUEST_ID']);
    if (state.replyMode === 'denied') return route.fulfill({ status: 403, json: {} });
    if (state.replyMode === 'held') {
      state.reply = route;
      return;
    }
    if (state.replyMode === 'success') persist(id, 'under_review', body.reason, 'customer');
    return route.fulfill({
      json:
        state.replyMode === 'malformed'
          ? { requestId: unpaidRequest, status: 'under_review' }
          : { requestId: id, status: 'under_review' },
    });
  });
  await page.route('**/api/admin/consultations/teams', (route) =>
    route.fulfill({ json: { teams: [] } })
  );
  await page.route('**/api/admin/consultations/requests?*', (route) => {
    state.queueReads++;
    return route.fulfill({
      json: {
        requests: [rows[informationRequest], rows[unpaidRequest], rows[paidRequest]],
        nextAfter: null,
      },
    });
  });
  await page.route('**/api/admin/consultations/requests/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    state.detailReads.push(id);
    if (state.detailMode === 'held') {
      state.detailRead = route;
      return;
    }
    if (state.detailMode === 'denied') return route.fulfill({ status: 403, json: {} });
    return route.fulfill({ json: detail(id) });
  });
  const paidReview = (body: Record<string, unknown>) => ({
    schemaVersion: 1,
    hash: 'c'.repeat(64),
    scope: {
      action: 'consultation.paid-resolution',
      profileId: consultationProfile,
      resourceId: paidRequest,
    },
    data: {
      action: body.action,
      serviceTitle: title,
      profileName: 'Paid buyer',
      currentStatus: rows[paidRequest]!.status,
      resultingStatus: body.action === 'cancel' ? 'cancelled' : 'rejected',
      reason: body.reason,
      currentInvoice: { id: invoiceId, state: 'Paid', paidAmount: '500000', adjustmentKind: null },
      cancelInvoiceId: null,
      uncoveredCreditBefore: '0',
      refundAllocations: [
        { invoiceId, state: 'Paid', amount: '500000', availableBefore: '500000' },
      ],
      totalCredit: '500000',
      totalRefund: '500000',
    },
  });
  await page.route(
    `**/api/admin/consultations/requests/${paidRequest}/paid-resolution-review`,
    (route) => {
      const body = route.request().postDataJSON();
      state.paidPreviews.push(body);
      return route.fulfill({ json: paidReview(body) });
    }
  );
  await page.route(
    /\/api\/admin\/consultations\/requests\/[^/]+\/(request-info|complete|reject|cancel|paid-cancel)$/,
    (route) => {
      const [id, path] = new URL(route.request().url()).pathname.split('/').slice(-2);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.staffWrites.push({ id: id!, path: path!, body });
      if (id === unpaidRequest && !state.verified)
        return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      if (state.staffMode === 'owned') return invalid(route, ['reason']);
      if (state.staffMode === 'unsafe') return invalid(route, ['reason', 'PRIVATE_REVIEW_HASH']);
      if (state.staffMode === 'denied') return route.fulfill({ status: 403, json: {} });
      if (state.staffMode === 'held') {
        state.staffCommand = route;
        return;
      }
      const status =
        path === 'request-info'
          ? 'awaiting_customer_info'
          : path === 'complete'
            ? 'completed'
            : path === 'reject'
              ? 'rejected'
              : 'cancelled';
      if (state.staffMode === 'success') persist(id!, status, body.reason as string, 'staff');
      return route.fulfill({
        json:
          state.staffMode === 'malformed'
            ? { requestId: unpaidRequest, status }
            : {
                requestId: id,
                status,
                ...(path === 'paid-cancel' ? { financialReview: { hash: 'c'.repeat(64) } } : {}),
              },
      });
    }
  );
  await page.route('**/api/auth/step-up', (route) => {
    state.verifications++;
    state.stepUp = route;
  });
  return { state, detail, persist, paidReview };
}
