import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

export const correctionProfile = '86000000-0000-4000-8000-000000000001';
export const correctionOrder = '86000000-0000-4000-8000-000000000002';
export const otherCorrectionOrder = '86000000-0000-4000-8000-000000000003';
export const correctionContract = '86000000-0000-4000-8000-000000000004';
export const correctionInvoice = '86000000-0000-4000-8000-000000000005';
export const correctionVersion = '86000000-0000-4000-8000-000000000006';
export const revisedVersion = '86000000-0000-4000-8000-000000000007';
export const revisedInvoice = '86000000-0000-4000-8000-000000000008';
export const correctionProvince = '86000000-0000-4000-8000-000000000009';
export const correctionCity = '86000000-0000-4000-8000-000000000010';
const submittedAt = '2026-10-04T10:00:00.000Z';
export const correctionPeriodStart = '2026-10-05T20:30:00.000Z';
export const correctionPeriodEnd = '2026-10-12T20:30:00.000Z';
const productId = '86000000-0000-4000-8000-000000000011';
const greenProductId = '86000000-0000-4000-8000-000000000012';

export function correctionQuote(advanced = false) {
  const lines = [
    {
      productId,
      systemKey: 'thermal',
      quantityKwh: '10',
      unitPriceIrR: '10000',
      subtotalIrR: '100000',
      discountIrR: '0',
      vatRateBasisPoints: 0,
      vatIrR: '0',
      totalIrR: '100000',
    },
  ];
  if (advanced)
    lines.push({
      productId: greenProductId,
      systemKey: 'green',
      quantityKwh: '1',
      unitPriceIrR: '20000',
      subtotalIrR: '20000',
      discountIrR: '0',
      vatRateBasisPoints: 0,
      vatIrR: '0',
      totalIrR: '20000',
    });
  return {
    reviewDigest: 'a'.repeat(64),
    periodStart: correctionPeriodStart,
    periodEnd: correctionPeriodEnd,
    durationHours: '168',
    totalKwh: advanced ? '11' : '10',
    averagePowerKw: advanced ? '0.06547619' : '0.05952381',
    greenRuleApplies: advanced,
    lines,
    subtotalIrR: advanced ? '120000' : '100000',
    discountIrR: '0',
    vatIrR: '0',
    totalIrR: advanced ? '120000' : '100000',
  };
}

export function correctionDetail(advanced = false, id = correctionOrder) {
  const quote = correctionQuote(advanced);
  return {
    orderId: id,
    profileId: correctionProfile,
    profileName: id === correctionOrder ? 'Correction Buyer' : 'Other Correction Buyer',
    commercialStatus: 'PENDING',
    electricityStatus: 'changes_requested',
    financialStatus: 'unpaid',
    nextAction: 'correct_order',
    mode: advanced ? 'advanced' : 'simple',
    periodStart: quote.periodStart,
    periodEnd: quote.periodEnd,
    totalKwh: quote.totalKwh,
    effectiveTotalKwh: quote.totalKwh,
    pricingSnapshot: {
      subtotalIrR: quote.subtotalIrR,
      discountIrR: quote.discountIrR,
      vatIrR: quote.vatIrR,
      lines: quote.lines.map((line) => ({
        ...line,
        netIrR: line.subtotalIrR,
      })),
    },
    settingsSnapshot: { mandatoryGreenEnabled: advanced },
    greenRuleApplied: advanced,
    submittedAt,
    giftCodeId: null,
    giftCode: null,
    giftDiscountIrR: '0',
    lines: quote.lines.map((line) => ({
      productId: line.productId,
      systemKey: line.systemKey,
      title: {
        en: line.systemKey === 'thermal' ? 'Thermal electricity' : 'Green electricity',
        fa: line.systemKey === 'thermal' ? 'برق حرارتی' : 'برق سبز',
      },
      quantityKwh: line.quantityKwh,
      unitPriceIrR: line.unitPriceIrR,
      lineTotalIrR: line.subtotalIrR,
    })),
    timeline: [
      {
        id: 'event-request-changes',
        event: 'electricity.order_review.request-changes',
        at: submittedAt,
        actor: 'reviewer',
        actorName: 'Review Operator',
        reason: 'Please correct the delivery address.',
        comment: null as string | null,
      },
    ],
    fullAddress: id === correctionOrder ? 'Original Electricity Street' : 'OTHER_PRIVATE_ADDRESS',
    postalCode: '1234567890',
    provinceId: correctionProvince,
    cityId: correctionCity,
    contractId: correctionContract,
    contractState: 'ChangesRequested',
    versionId: correctionVersion,
    invoiceId: correctionInvoice,
    invoiceState: 'Unpaid',
    totalIrR: quote.totalIrR,
    paidIrR: '0',
    refundedIrR: '0',
    refundStatus: null,
    refundReason: null,
    financiallyClosed: false,
  };
}

export function correctionStaffOrder(id = correctionOrder) {
  const value = correctionDetail(false, id);
  return {
    ...value,
    customerName: value.profileName,
    commercialStatus: 'awaiting_staff_review',
    contractState: 'AwaitingStaffReview',
    nextAction: 'review_order',
    settingsSnapshot: { simpleGreenRuleEnabled: false },
    contractSnapshot: {
      orderId: id,
      template: {
        versionNumber: 1,
        name: 'Electricity supply terms',
        text: 'Supply starts after payment and customer acceptance.',
      },
    },
    ageHours: 1,
    priority: 'normal',
    timeline: [],
  };
}

export function correctionStaffReview(
  order: ReturnType<typeof correctionStaffOrder>,
  command: Record<string, unknown>
) {
  const action = command.action;
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: {
      action: `electricity.staff-review.${action}`,
      profileId: order.profileId,
      resourceId: order.orderId,
    },
    data: {
      action,
      reason: command.reason,
      customerName: order.customerName,
      contractId: order.contractId,
      contractState: order.contractState,
      versionId: order.versionId,
      versionNumber: order.versionId === correctionVersion ? 1 : 2,
      contractSnapshot: order.contractSnapshot,
      invoiceId: order.invoiceId,
      invoiceState: order.invoiceState,
      invoiceTotal: order.totalIrR,
      paidAmount: order.paidIrR,
      refundedAmount: order.refundedIrR,
      pendingRefundAmount: '0',
      periodStart: order.periodStart,
      periodEnd: order.periodEnd,
      totalKwh: order.totalKwh,
      pricingSnapshot: order.pricingSnapshot,
      outcome:
        action === 'approve'
          ? 'publish_contract'
          : action === 'request-changes'
            ? 'request_revision'
            : 'cancel_invoice',
      refundAmount: '0',
      releasesGiftCode: false,
    },
  };
}

type ReviewMode = 'owned' | 'unsafe' | 'held' | 'success';
type WriteMode = 'held' | 'success' | 'denied';
export async function setupElectricityCorrectionForms(
  page: Page,
  locale: 'en' | 'fa',
  dark: boolean,
  advanced = false
) {
  await setupCatalogueForms(page, locale, dark);
  const state = {
    context: 'customer' as 'staff' | 'customer',
    actor: 'correction-buyer',
    detail: correctionDetail(advanced),
    staff: correctionStaffOrder(),
    staffReviewMode: 'owned' as ReviewMode,
    quoteMode: 'owned' as ReviewMode,
    staffWriteMode: 'held' as WriteMode,
    addressWriteMode: 'held' as WriteMode,
    revisionWriteMode: 'held' as WriteMode,
    addressOwnedError: false,
    detailDenied: false,
    staffPreview: undefined as Route | undefined,
    quotePreview: undefined as Route | undefined,
    staffWrite: undefined as Route | undefined,
    addressWrite: undefined as Route | undefined,
    revisionWrite: undefined as Route | undefined,
    staffPreviews: [] as Record<string, unknown>[],
    quotePreviews: [] as Record<string, unknown>[],
    staffWrites: [] as Record<string, unknown>[],
    addressWrites: [] as Record<string, unknown>[],
    revisionWrites: [] as Record<string, unknown>[],
    detailReads: 0,
  };
  const invalid = (route: Route, fields: string[]) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          fields,
          message: 'PRIVATE_SERVER_VALIDATION_TEXT',
          correlationId: '86000000-0000-4000-8000-000000000013',
        },
      },
    });
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: state.actor,
        isStaff: true,
        operatingContext: state.context,
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: {
          ...fullNavigation(state.context, 'LEGAL'),
          profileId: state.context === 'customer' ? correctionProfile : null,
        },
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: correctionProfile, profileType: 'LEGAL', title: 'Correction Buyer' }],
        activeProfileId: correctionProfile,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: correctionProfile,
        activeProfileName: 'Correction Buyer',
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/geography/provinces', (route) =>
    route.fulfill({ json: [{ id: correctionProvince, nameEn: 'Tehran', nameFa: 'تهران' }] })
  );
  await page.route(`**/api/geography/provinces/${correctionProvince}/cities`, (route) =>
    route.fulfill({
      json: [
        { id: correctionCity, provinceId: correctionProvince, nameEn: 'Tehran', nameFa: 'تهران' },
      ],
    })
  );
  await page.route('**/api/electricity/periods/simple', (route) =>
    route.fulfill({
      json: {
        periods: [{ key: 'next_week', start: correctionPeriodStart, end: correctionPeriodEnd }],
      },
    })
  );
  await page.route('**/api/electricity/periods/advanced', (route) =>
    route.fulfill({ json: { mandatoryGreenEnabled: true } })
  );
  await page.route('**/api/**/comments*', (route) =>
    route.fulfill({ json: { comments: [], nextBefore: null } })
  );
  await page.route('**/api/staff/electricity/orders', (route) =>
    route.fulfill({
      json: {
        orders: [state.staff, correctionStaffOrder(otherCorrectionOrder)],
        nextAfter: null,
      },
    })
  );
  for (const id of [correctionOrder, otherCorrectionOrder]) {
    await page.route(`**/api/staff/electricity/orders/${id}`, (route) =>
      route.fulfill({ json: id === correctionOrder ? state.staff : correctionStaffOrder(id) })
    );
    await page.route(`**/api/staff/electricity/orders/${id}/financial-review`, (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.staffPreviews.push(body);
      if (state.staffReviewMode === 'owned') return invalid(route, ['reason']);
      if (state.staffReviewMode === 'unsafe') return invalid(route, ['expectedReviewHash']);
      if (state.staffReviewMode === 'held') {
        state.staffPreview = route;
        return;
      }
      return route.fulfill({
        json: correctionStaffReview(
          id === correctionOrder ? state.staff : correctionStaffOrder(id),
          body
        ),
      });
    });
    for (const action of ['approve', 'request-changes', 'reject']) {
      await page.route(`**/api/staff/electricity/orders/${id}/${action}`, (route) => {
        state.staffWrites.push(route.request().postDataJSON());
        if (state.staffWriteMode === 'denied') return route.fulfill({ status: 403, json: {} });
        if (state.staffWriteMode === 'held') {
          state.staffWrite = route;
          return;
        }
        const status =
          action === 'request-changes'
            ? 'changes_requested'
            : action === 'approve'
              ? 'approved'
              : 'rejected';
        const order = id === correctionOrder ? state.staff : correctionStaffOrder(id);
        if (id === correctionOrder) {
          state.staff = {
            ...state.staff,
            commercialStatus: status,
            contractState:
              action === 'request-changes'
                ? 'ChangesRequested'
                : action === 'approve'
                  ? 'AwaitingCustomerAcceptance'
                  : 'Rejected',
            invoiceState: action === 'reject' ? 'Cancelled' : state.staff.invoiceState,
          };
        }
        return route.fulfill({
          json: {
            orderId: id,
            status,
            contractId: order.contractId,
            invoiceId: order.invoiceId,
            refundId: null,
          },
        });
      });
    }
  }
  await page.route(`**/api/electricity/orders/${correctionOrder}`, (route) => {
    state.detailReads++;
    return state.detailDenied
      ? route.fulfill({ status: 404, json: {} })
      : route.fulfill({ json: state.detail });
  });
  await page.route(`**/api/electricity/orders/${correctionOrder}/revision-preview`, (route) => {
    state.quotePreviews.push(route.request().postDataJSON());
    if (state.quoteMode === 'owned') return invalid(route, [advanced ? 'thermal' : 'totalKwh']);
    if (state.quoteMode === 'unsafe') return invalid(route, ['expectedVersionId']);
    if (state.quoteMode === 'held') {
      state.quotePreview = route;
      return;
    }
    return route.fulfill({ json: correctionQuote(advanced) });
  });
  await page.route(`**/api/electricity/orders/${correctionOrder}/resubmit-address`, (route) => {
    state.addressWrites.push(route.request().postDataJSON());
    if (state.addressOwnedError) return invalid(route, ['postalCode']);
    if (state.addressWriteMode === 'denied') return route.fulfill({ status: 404, json: {} });
    if (state.addressWriteMode === 'held') {
      state.addressWrite = route;
      return;
    }
    return route.fulfill({
      json: {
        orderId: correctionOrder,
        contractId: correctionContract,
        versionId: revisedVersion,
        status: 'awaiting_staff_review',
      },
    });
  });
  await page.route(`**/api/electricity/orders/${correctionOrder}/resubmit`, (route) => {
    state.revisionWrites.push(route.request().postDataJSON());
    if (state.revisionWriteMode === 'denied') return route.fulfill({ status: 404, json: {} });
    if (state.revisionWriteMode === 'held') {
      state.revisionWrite = route;
      return;
    }
    const quote = correctionQuote(advanced);
    return route.fulfill({
      json: {
        orderId: correctionOrder,
        contractId: correctionContract,
        versionId: revisedVersion,
        invoiceId: revisedInvoice,
        status: 'awaiting_staff_review',
        ...quote,
        // The durable idempotency result comes from jsonb, which reorders object keys.
        lines: quote.lines.map((line) =>
          Object.fromEntries(
            Object.entries(line).sort(
              ([left], [right]) => left.length - right.length || left.localeCompare(right)
            )
          )
        ),
      },
    });
  });
  function persistCorrection(kind: 'address' | 'revision') {
    const body = (kind === 'address' ? state.addressWrites : state.revisionWrites).at(-1)!;
    const address = kind === 'address' ? body : (body.address as Record<string, unknown>);
    state.detail = {
      ...state.detail,
      versionId: revisedVersion,
      invoiceId: kind === 'revision' ? revisedInvoice : correctionInvoice,
      electricityStatus: 'awaiting_staff_review',
      contractState: 'AwaitingStaffReview',
      nextAction: 'await_review',
      fullAddress: String(address.fullAddress),
      postalCode: String(address.postalCode),
      timeline: [
        ...state.detail.timeline,
        {
          id: 'event-resubmitted',
          event: 'electricity.order_resubmitted',
          at: '2026-10-04T10:05:00.000Z',
          actor: state.actor,
          actorName: 'Correction Buyer',
          reason: '',
          comment: String(body.responseNote),
        },
      ],
    };
  }
  return { state, persistCorrection };
}
