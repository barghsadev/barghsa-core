import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { fullNavigation } from './navigation-fixture';
import { mockOtpStepUp } from './otp-step-up-fixture';
import { savingWork } from '../src/test/staff-business-fixtures';
import {
  correctionOrder as electricityOrder,
  correctionProfile as profileId,
  setupElectricityCorrectionForms,
} from './electricity-correction-form-fixture';
export { electricityOrder, profileId };
export const savingOrder = '89000000-0000-4000-8000-000000000001';
export const otherElectricityOrder = '89000000-0000-4000-8000-000000000002';
export const buyerId = '89000000-0000-4000-8000-000000000003';
export const staffId = '89000000-0000-4000-8000-000000000004';
const correlationId = '89000000-0000-4000-8000-000000000005';
const stamp = '2026-10-05T08:00:00.000Z';
export type Kind = 'electricity' | 'saving';
export type CommentCommand = { idempotencyKey: string; body: string; visibility?: string };
export type Comment = {
  id: string;
  orderId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'staff' | 'customer';
  body: string;
  createdAt: string;
  visibility?: 'public' | 'internal';
};
const id = (number: number) => `89100000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function rows(orderId: string, kind: Kind) {
  // Database microseconds can order comments whose serialized millisecond dates are equal.
  // Deliberately reverse UUID order without altering the server's chronological order.
  const values: Comment[] = Array.from({ length: 52 }, (_, index) => ({
    id: id(100 - index),
    orderId,
    authorUserId: index === 7 ? buyerId : staffId,
    authorName: index === 7 ? 'Comment buyer' : 'Comment expert',
    authorRole: index === 7 ? 'customer' : 'staff',
    body: index === 7 ? 'Existing <script> reply' : `Chronological comment ${index}`,
    createdAt: index < 2 ? '2026-10-05T07:59:59.999Z' : stamp,
    ...(kind === 'electricity' ? { visibility: 'public' as const } : {}),
  }));
  if (kind === 'electricity')
    values.push({
      id: id(1000),
      orderId,
      authorUserId: staffId,
      authorName: 'Comment expert',
      authorRole: 'staff',
      body: 'PRIVATE_INTERNAL_NOTE',
      createdAt: stamp,
      visibility: 'internal',
    });
  return values;
}
export async function setupOrderCommentForms(page: Page, locale: 'en' | 'fa', staff: boolean) {
  const shell = await setupElectricityCorrectionForms(page, locale, locale === 'fa');
  shell.state.context = staff ? 'staff' : 'customer';
  shell.state.actor = staff ? staffId : buyerId;
  const otp = await mockOtpStepUp(page);
  const state = {
    actor: shell.state.actor,
    staff,
    otp,
    needsStepUp: false,
    readMode: 'success' as 'success' | 'held' | 'denied' | 'missing' | 'malformed' | 'leak',
    writeMode: 'owned-body' as 'owned-body' | 'owned-visibility' | 'held' | 'success' | 'denied',
    reads: [] as { path: string; before: string | null }[],
    writes: [] as { path: string; body: CommentCommand }[],
    readRoute: undefined as Route | undefined,
    writeRoute: undefined as Route | undefined,
    threads: new Map<string, Comment[]>([
      [electricityOrder, rows(electricityOrder, 'electricity')],
      [otherElectricityOrder, rows(otherElectricityOrder, 'electricity')],
      [savingOrder, rows(savingOrder, 'saving')],
    ]),
    receipts: new Map<string, Comment>(),
  };
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: state.actor,
        isStaff: state.staff,
        operatingContext: state.staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: {
          ...fullNavigation(state.staff ? 'staff' : 'customer', 'LEGAL'),
          profileId: state.staff ? null : profileId,
        },
      },
    })
  );
  await page.route(/\/api\/staff\/electricity\/orders(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        orders: [
          shell.state.staff,
          {
            ...shell.state.staff,
            orderId: otherElectricityOrder,
            customerName: 'Other Comment Buyer',
          },
        ],
        nextAfter: null,
      },
    })
  );
  await page.route(`**/api/staff/electricity/orders/${otherElectricityOrder}`, (route) =>
    route.fulfill({
      json: {
        ...shell.state.staff,
        orderId: otherElectricityOrder,
        customerName: 'Other Comment Buyer',
      },
    })
  );
  const saving = { ...savingWork(savingOrder), profileId, customerName: 'Comment saving buyer' };
  await page.route('**/api/staff/saving/orders?*', (route) =>
    route.fulfill({ json: { orders: [saving], nextAfter: null } })
  );
  await page.route(`**/api/staff/saving/orders/${savingOrder}`, (route) =>
    route.fulfill({ json: saving })
  );
  await page.route(`**/api/saving/orders/${savingOrder}`, (route) =>
    route.fulfill({
      json: {
        id: savingOrder,
        order_id: savingOrder,
        profile_id: profileId,
        saving_plan_id: savingOrder,
        hardware_product_id: savingOrder,
        current_hardware_title: saving.hardwareTitle,
        installation_address_id: savingOrder,
        can_edit: false,
        bill_identifier: saving.billIdentifier,
        submitted_at: stamp,
        address_snapshot: {
          full_address: 'Comment installation address',
          postal_code: '1234567890',
        },
        pricing_snapshot: {
          plan: saving.pricingSnapshot.plan,
          hardware: { title: saving.hardwareTitle },
          subtotalIrR: '1000',
          discountIrR: '0',
          vatIrR: '0',
          totalIrR: '1000',
        },
        verification_result: { status: 'verified' },
        agreement_snapshot: 'Accepted saving terms',
        agreement_updated: false,
        contract_version_id: saving.versionId,
        contract_id: null,
        contract_state: 'AwaitingStaffReview',
        invoice_id: null,
        invoice_state: null,
        cancellation_pending: false,
        status: 'awaiting_staff_review',
        financial_status: 'unpaid',
        stages: [],
        events: [],
        eventsTruncated: false,
        revisions: [],
        addressAmendments: [],
        hardwareAmendments: [],
        hardwareUpgrades: [],
      },
    })
  );
  const error = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          message: 'PRIVATE_SERVER_COMMENT_TEXT',
          correlationId,
          ...(fields ? { fields } : {}),
        },
      },
    });
  function persist(command: CommentCommand, orderId: string, kind: Kind) {
    const key = `${orderId}:${state.actor}:${command.idempotencyKey}`;
    const old = state.receipts.get(key);
    if (old) return old;
    const result: Comment = {
      id: id(2000 + state.receipts.size),
      orderId,
      authorUserId: state.actor,
      authorName: state.staff ? 'Comment expert' : 'Comment buyer',
      authorRole: state.staff ? 'staff' : 'customer',
      body: command.body,
      createdAt: '2026-10-05T08:01:00.000Z',
      ...(kind === 'electricity'
        ? { visibility: (state.staff ? command.visibility : 'public') as 'public' | 'internal' }
        : {}),
    };
    state.receipts.set(key, result);
    state.threads.get(orderId)!.push(result);
    return result;
  }
  await page.route(
    (url) =>
      /^\/api\/(?:staff\/)?(?:electricity|saving)\/orders\/[^/]+\/comments$/.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url()),
        parts = url.pathname.split('/');
      const staffRoute = parts[2] === 'staff',
        kind = parts[staffRoute ? 3 : 2] as Kind,
        orderId = parts[staffRoute ? 5 : 4]!;
      if (route.request().method() === 'POST') {
        const command = route.request().postDataJSON() as CommentCommand;
        state.writes.push({ path: url.pathname, body: command });
        if (state.needsStepUp && !otp.verified)
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
                message: 'Step-up required',
                correlationId,
              },
              requiresOtp: true,
            },
          });
        if (state.writeMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
        if (state.writeMode === 'owned-body' || state.writeMode === 'owned-visibility')
          return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, [
            state.writeMode === 'owned-body' ? 'body' : 'visibility',
          ]);
        if (state.writeMode === 'held') {
          state.writeRoute = route;
          return;
        }
        return route.fulfill({ status: 200, json: persist(command, orderId, kind) });
      }
      state.reads.push({ path: url.pathname, before: url.searchParams.get('before') });
      if (state.readMode === 'held') {
        state.readRoute = route;
        return;
      }
      if (state.readMode === 'denied') return error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code);
      if (state.readMode === 'missing')
        return error(route, 404, ErrorCodes.NOT_FOUND_RESOURCE.code);
      if (state.readMode === 'malformed')
        return route.fulfill({
          json: { comments: [{ id: id(100), body: 'MALFORMED_PRIVATE_THREAD' }], nextBefore: null },
        });
      if (state.readMode === 'leak')
        return route.fulfill({
          json: { comments: [rows(orderId, 'electricity').at(-1)], nextBefore: null },
        });
      const all = (state.threads.get(orderId) ?? []).filter(
        (row) => staffRoute || row.visibility !== 'internal'
      );
      const cursor = url.searchParams.get('before'),
        offset = cursor ? all.findIndex((row) => row.id === cursor) : all.length;
      if (offset < 0) return error(route, 404, ErrorCodes.NOT_FOUND_RESOURCE.code);
      const visible = all.slice(0, offset),
        comments = visible.slice(-50);
      return route.fulfill({
        json: { comments, nextBefore: visible.length > 50 ? comments[0]!.id : null },
      });
    }
  );
  return { state, persist };
}
