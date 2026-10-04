import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

const uuid = (n: number) => `89200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const savingChangeOrder = uuid(1),
  otherSavingChangeOrder = uuid(2),
  changeProfile = uuid(3);
export const changePlan = uuid(4),
  currentHardware = uuid(5),
  replacementHardware = uuid(6);
export const currentAddress = uuid(7),
  replacementAddress = uuid(8),
  changeAgreement = uuid(9);
export const changeVersion = uuid(10),
  changeInvoice = uuid(11),
  changeGift = uuid(12);
export const changeContract = uuid(13),
  changedVersion = uuid(14),
  unavailableHardware = uuid(15);
const province = uuid(16),
  city = uuid(17),
  correlationId = uuid(18),
  amendmentId = uuid(19);
const stamp = '2026-10-05T10:00:00.000Z';
export const hardwareTitle = { fa: 'دستگاه کم‌مصرف', en: 'Efficient device' };
export const replacementTitle = { fa: 'دستگاه جایگزین', en: 'Replacement device' };
const planTitle = { fa: 'طرح صرفه‌جویی', en: 'Saving plan' };
export const changeAddresses = [currentAddress, replacementAddress].map((id, index) => ({
  id,
  profileId: changeProfile,
  provinceId: province,
  cityId: city,
  provinceNameFa: 'تهران',
  provinceNameEn: 'Tehran',
  cityNameFa: 'تهران',
  cityNameEn: 'Tehran',
  fullAddress: index ? 'Replacement installation address' : 'Original installation address',
  postalCode: index ? '9876543210' : '1234567890',
  mainAddress: !index,
  createdAt: stamp,
  updatedAt: stamp,
}));
function wireAddress(id: string) {
  const address = changeAddresses.find((row) => row.id === id)!;
  return {
    id: address.id,
    province_id: address.provinceId,
    city_id: address.cityId,
    full_address: address.fullAddress,
    postal_code: address.postalCode,
  };
}
export const changeHardware = [
  {
    id: currentHardware,
    title: hardwareTitle,
    description: null,
    price: '200000',
    status: 'active',
    stock_tracking: true,
    available_count: 3,
  },
  {
    id: replacementHardware,
    title: replacementTitle,
    description: null,
    price: '250000',
    status: 'active',
    stock_tracking: true,
    available_count: 2,
  },
  {
    id: unavailableHardware,
    title: { fa: 'ناموجود', en: 'Unavailable device' },
    description: null,
    price: '300000',
    status: 'inactive',
    stock_tracking: true,
    available_count: 0,
  },
];
export function savingChangeQuote(
  hardwareProductId = replacementHardware,
  installationAddressId = replacementAddress
) {
  const changed = hardwareProductId === replacementHardware;
  const publicQuote = {
    plan: { id: changePlan, title: planTitle },
    hardware: { id: hardwareProductId, title: changed ? replacementTitle : hardwareTitle },
    billIdentifier: '1234567890123',
    address: wireAddress(installationAddressId),
    agreement: {
      versionId: changeAgreement,
      title: 'Accepted saving terms',
      body: 'Saving agreement body.',
    },
    lines: [
      {
        type: 'plan_price',
        productId: changePlan,
        title: planTitle,
        amountIrR: '100000',
        discountIrR: changed ? '8571' : '10000',
        netIrR: changed ? '91429' : '90000',
        vatRateBps: 900,
        vatIrR: changed ? '8229' : '8100',
      },
      {
        type: 'hardware_price',
        productId: hardwareProductId,
        title: changed ? replacementTitle : hardwareTitle,
        amountIrR: changed ? '250000' : '200000',
        discountIrR: changed ? '21429' : '20000',
        netIrR: changed ? '228571' : '180000',
        vatRateBps: 900,
        vatIrR: changed ? '20571' : '16200',
      },
    ],
    subtotalIrR: changed ? '350000' : '300000',
    discountIrR: '30000',
    vatIrR: changed ? '28800' : '24300',
    totalIrR: changed ? '348800' : '294300',
    giftCodeId: changeGift,
    baseVersionId: changeVersion,
  };
  // The customer service hashes its original property order, unlike staff financial reviews.
  return {
    ...publicQuote,
    reviewDigest: createHash('sha256').update(JSON.stringify(publicQuote)).digest('hex'),
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
    );
  return value;
}
export type CustomerSelection = { hardwareProductId: string; installationAddressId: string };
export type CustomerCommand = CustomerSelection & {
  expectedQuoteDigest: string;
  idempotencyKey: string;
};
export type StaffSelection = {
  expectedVersionId: string;
  expectedAddressId: string;
  addressId: string;
  reason: string;
};
export type StaffCommand = StaffSelection & { expectedReviewHash: string; idempotencyKey: string };
function initialCustomerDetail() {
  return {
    id: savingChangeOrder,
    order_id: savingChangeOrder,
    profile_id: changeProfile,
    saving_plan_id: changePlan,
    hardware_product_id: currentHardware,
    current_hardware_title: hardwareTitle,
    installation_address_id: currentAddress,
    can_edit: true,
    bill_identifier: '1234567890123',
    submitted_at: stamp,
    address_snapshot: wireAddress(currentAddress),
    pricing_snapshot: savingChangeQuote(currentHardware, currentAddress),
    verification_result: { status: 'verified' },
    agreement_version_id: changeAgreement,
    agreement_snapshot: 'Accepted saving terms\nSaving agreement body.',
    agreement_updated: false,
    contract_version_id: changeVersion,
    contract_id: changeContract,
    contract_state: 'AwaitingStaffReview',
    invoice_id: changeInvoice,
    invoice_state: 'Unpaid',
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
  };
}
function initialStaffDetail(id = savingChangeOrder) {
  return {
    id,
    orderId: id,
    profileId: changeProfile,
    savingPlanId: changePlan,
    customerId: 'saving-change-buyer',
    verificationResult: { status: 'verified' },
    customerName: id === savingChangeOrder ? 'Change Buyer' : 'Other Change Buyer',
    status: 'in_progress',
    financialStatus: 'paid',
    submittedAt: stamp,
    billIdentifier: '1234567890123',
    addressSnapshot: wireAddress(currentAddress),
    installationAddressId: currentAddress,
    hardwareProductId: currentHardware,
    hardwareTitle,
    pricingSnapshot: savingChangeQuote(currentHardware, currentAddress),
    agreementSnapshot: 'Saving agreement body.',
    versionId: changeVersion,
    contractId: changeContract,
    invoiceId: changeInvoice,
    invoiceState: 'Paid',
    contractState: 'Active',
    totalIrR: '294300',
    paidIrR: '294300',
    refundedIrR: '0',
    pendingRefundIrR: '0',
    stages: [
      {
        stage: 'request_confirmation',
        status: 'completed',
        completed_at: stamp,
        explanation: null,
        handover_description: null,
      },
      {
        stage: 'product_delivery',
        status: 'in_progress',
        completed_at: null,
        explanation: null,
        handover_description: null,
      },
      ...['installation_and_document_upload', 'equipment_handover', 'process_completion'].map(
        (stage) => ({
          stage,
          status: 'pending',
          completed_at: null,
          explanation: null,
          handover_description: null,
        })
      ),
    ],
    events: [],
    eventsTruncated: false,
    revisions: [],
    addressAmendments: [],
    hardwareAmendments: [],
    hardwareUpgrades: [],
    addressOptions: changeAddresses.map(({ id, fullAddress, postalCode }) => ({
      id,
      fullAddress,
      postalCode,
    })),
    hardwareOptions: [{ id: replacementHardware, title: replacementTitle, priceDeltaIrR: '54500' }],
    canAmendAddress: true,
    canAmendHardware: true,
  };
}
export function savingAddressReview(
  detail: ReturnType<typeof initialStaffDetail>,
  selection: StaffSelection
) {
  const body = canonical({
    schemaVersion: 1,
    scope: {
      action: 'saving.staff-address-amendment',
      profileId: detail.profileId,
      resourceId: detail.id,
    },
    data: {
      reason: selection.reason,
      customerName: detail.customerName,
      profileName: 'Change Buyer',
      billIdentifier: detail.billIdentifier,
      orderId: detail.orderId,
      hardwareTitle: detail.hardwareTitle,
      pricingSnapshot: detail.pricingSnapshot,
      agreementSnapshot: detail.agreementSnapshot,
      contractId: detail.contractId,
      contractState: detail.contractState,
      versionId: detail.versionId,
      versionNumber: 1,
      contractSnapshot: {},
      invoiceId: detail.invoiceId,
      invoiceState: detail.invoiceState,
      invoiceTotalIrR: detail.totalIrR,
      paidAmountIrR: detail.paidIrR,
      refundedAmountIrR: '0',
      pendingRefundAmountIrR: '0',
      previousAddressId: detail.installationAddressId,
      previousAddress: detail.addressSnapshot,
      replacementAddressId: selection.addressId,
      replacementAddress: wireAddress(selection.addressId),
      outcome: 'update_installation_address_without_repricing',
    },
  }) as Record<string, unknown>;
  return { ...body, hash: createHash('sha256').update(JSON.stringify(body)).digest('hex') };
}
type PreviewMode = 'owned' | 'held' | 'foreign' | 'malformed' | 'success' | 'denied' | 'missing';
type WriteMode = 'held' | 'foreign' | 'malformed' | 'success' | 'denied' | 'missing' | 'rejected';
export async function setupSavingChangeAddressForms(
  page: Page,
  locale: 'en' | 'fa',
  staff: boolean
) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const stepUp = { verified: false, requests: [] as Array<{ password: string }> };
  await page.route('**/api/auth/step-up', async (route) => {
    const body = route.request().postDataJSON() as { password: string };
    stepUp.requests.push(body);
    stepUp.verified = body.password === 'Saving-form-proof-42!';
    if (!stepUp.verified) return route.fulfill({ status: 422, json: {} });
    await page.context().addCookies([
      {
        name: 'barghsa_csrf',
        value: 'rotated-saving-password-proof',
        url: new URL(route.request().url()).origin,
      },
    ]);
    return route.fulfill({
      json: {
        message: 'Step-up authentication successful.',
        stepUpVerifiedAt: new Date().toISOString(),
      },
    });
  });
  const state = {
    actor: staff ? 'saving-change-staff' : 'saving-change-buyer',
    staff,
    stepUp,
    needsStepUp: false,
    customerDetail: initialCustomerDetail(),
    staffDetails: new Map([
      [savingChangeOrder, initialStaffDetail()],
      [otherSavingChangeOrder, initialStaffDetail(otherSavingChangeOrder)],
    ]),
    customerQuoteMode: 'owned' as PreviewMode,
    staffReviewMode: 'owned' as PreviewMode,
    customerWriteMode: 'success' as WriteMode,
    staffWriteMode: 'success' as WriteMode,
    optionsDenied: false,
    customerDetailDenied: false,
    staffDetailDenied: false,
    customerQuotes: [] as CustomerSelection[],
    customerWrites: [] as CustomerCommand[],
    customerSerializedWrites: [] as string[],
    staffReviews: [] as StaffSelection[],
    staffWrites: [] as StaffCommand[],
    staffSerializedWrites: [] as string[],
    reads: [] as string[],
    customerQuoteRoute: undefined as Route | undefined,
    customerWriteRoute: undefined as Route | undefined,
    staffReviewRoute: undefined as Route | undefined,
    staffWriteRoute: undefined as Route | undefined,
    staffDetailRoute: undefined as Route | undefined,
    holdStaffDetail: false,
    customerReceipts: new Map<string, ReturnType<typeof customerReceipt>>(),
    staffReceipts: new Map<
      string,
      { amendmentId: string; savingOrderId: string; address: ReturnType<typeof wireAddress> }
    >(),
  };
  function customerReceipt(command: CustomerCommand) {
    return {
      savingOrderId: savingChangeOrder,
      contractVersionId: changedVersion,
      invoiceId: changeInvoice,
      ...savingChangeQuote(command.hardwareProductId, command.installationAddressId),
    };
  }
  function persistCustomer(command: CustomerCommand) {
    const old = state.customerReceipts.get(command.idempotencyKey);
    if (old) return old;
    const receipt = customerReceipt(command);
    state.customerReceipts.set(command.idempotencyKey, receipt);
    state.customerDetail = {
      ...state.customerDetail,
      hardware_product_id: command.hardwareProductId,
      current_hardware_title: receipt.hardware.title,
      installation_address_id: command.installationAddressId,
      address_snapshot: receipt.address,
      contract_version_id: receipt.contractVersionId,
      pricing_snapshot: receipt,
    };
    return receipt;
  }
  function persistStaff(command: StaffCommand) {
    const old = state.staffReceipts.get(command.idempotencyKey);
    if (old) return old;
    const receipt = {
      amendmentId,
      savingOrderId: savingChangeOrder,
      address: wireAddress(command.addressId),
    };
    state.staffReceipts.set(command.idempotencyKey, receipt);
    const detail = state.staffDetails.get(savingChangeOrder)!;
    state.staffDetails.set(savingChangeOrder, {
      ...detail,
      installationAddressId: command.addressId,
      addressSnapshot: receipt.address,
    });
    return receipt;
  }
  function error(route: Route, status: number, code: string, fields?: string[]) {
    return route.fulfill({
      status,
      json: {
        error: {
          code,
          message: 'PRIVATE_CHANGE_SERVER_MESSAGE',
          correlationId,
          ...(fields ? { fields } : {}),
        },
      },
    });
  }
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: state.actor,
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: {
          ...fullNavigation(staff ? 'staff' : 'customer', 'INDIVIDUAL'),
          profileId: staff ? null : changeProfile,
        },
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          { id: changeProfile, profileType: 'INDIVIDUAL', title: 'Change Buyer', status: 'ACTIVE' },
        ],
        activeProfileId: changeProfile,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: changeProfile,
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/saving/plans', (route) => {
    state.reads.push('/api/saving/plans');
    return state.optionsDenied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({
          json: {
            plans: [
              {
                id: changePlan,
                title: planTitle,
                description: null,
                price: '100000',
                status: 'active',
                available: true,
                hardware: changeHardware,
                agreement: {
                  versionId: changeAgreement,
                  title: 'Accepted saving terms',
                  body: 'Saving agreement body.',
                  effectiveFrom: null,
                },
              },
            ],
          },
        });
  });
  await page.route(`**/api/profiles/${changeProfile}/addresses`, (route) => {
    state.reads.push(`/api/profiles/${changeProfile}/addresses`);
    return state.optionsDenied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({ json: { addresses: changeAddresses } });
  });
  await page.route(`**/api/saving/orders/${savingChangeOrder}`, (route) => {
    state.reads.push('/api/saving/orders/' + savingChangeOrder);
    return state.customerDetailDenied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({ json: state.customerDetail });
  });
  await page.route(/\/api\/(?:staff\/)?saving\/orders\/[^/]+\/(?:comments|documents)$/, (route) =>
    route.fulfill({ json: { comments: [], nextBefore: null, documents: [], nextAfter: null } })
  );
  await page.route(/\/api\/staff\/saving\/orders(?:\?.*)?$/, (route) => {
    state.reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { orders: [...state.staffDetails.values()], nextAfter: null } });
  });
  await page.route(/\/api\/staff\/saving\/orders\/[^/]+$/, (route) => {
    const url = new URL(route.request().url());
    state.reads.push(url.pathname);
    if (state.holdStaffDetail) {
      state.staffDetailRoute = route;
      return;
    }
    return state.staffDetailDenied
      ? error(route, 403, ErrorCodes.AUTHZ_FORBIDDEN.code)
      : route.fulfill({ json: state.staffDetails.get(url.pathname.split('/').at(-1)!) });
  });
  await page.route(`**/api/saving/orders/${savingChangeOrder}/change-quote`, (route) => {
    const selection = route.request().postDataJSON() as CustomerSelection;
    state.customerQuotes.push(selection);
    if (state.customerQuoteMode === 'held') {
      state.customerQuoteRoute = route;
      return;
    }
    if (state.customerQuoteMode === 'owned')
      return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['installationAddressId']);
    if (state.customerQuoteMode === 'denied' || state.customerQuoteMode === 'missing')
      return error(
        route,
        state.customerQuoteMode === 'denied' ? 403 : 404,
        state.customerQuoteMode === 'denied'
          ? ErrorCodes.AUTHZ_FORBIDDEN.code
          : ErrorCodes.NOT_FOUND_RESOURCE.code
      );
    const quote = savingChangeQuote(selection.hardwareProductId, selection.installationAddressId);
    return route.fulfill({
      status: 201,
      json:
        state.customerQuoteMode === 'foreign'
          ? { ...quote, baseVersionId: changedVersion }
          : state.customerQuoteMode === 'malformed'
            ? { ...quote, totalIrR: '1' }
            : quote,
    });
  });
  await page.route(`**/api/saving/orders/${savingChangeOrder}/change`, (route) => {
    const command = route.request().postDataJSON() as CustomerCommand;
    state.customerWrites.push(command);
    state.customerSerializedWrites.push(route.request().postData()!);
    if (state.customerWriteMode === 'held') {
      state.customerWriteRoute = route;
      return;
    }
    if (
      state.customerWriteMode === 'denied' ||
      state.customerWriteMode === 'missing' ||
      state.customerWriteMode === 'rejected'
    )
      return error(
        route,
        state.customerWriteMode === 'denied'
          ? 403
          : state.customerWriteMode === 'missing'
            ? 404
            : 409,
        state.customerWriteMode === 'denied'
          ? ErrorCodes.AUTHZ_FORBIDDEN.code
          : state.customerWriteMode === 'missing'
            ? ErrorCodes.NOT_FOUND_RESOURCE.code
            : ErrorCodes.CONFLICT_STATE.code
      );
    const receipt = persistCustomer(command);
    return route.fulfill({
      status: 201,
      json:
        state.customerWriteMode === 'foreign'
          ? { ...receipt, invoiceId: changeContract }
          : state.customerWriteMode === 'malformed'
            ? { ...receipt, contractVersionId: changeVersion }
            : receipt,
    });
  });
  await page.route(
    `**/api/staff/saving/orders/${savingChangeOrder}/amend-address-review`,
    (route) => {
      const selection = route.request().postDataJSON() as StaffSelection;
      state.staffReviews.push(selection);
      if (state.staffReviewMode === 'held') {
        state.staffReviewRoute = route;
        return;
      }
      if (state.staffReviewMode === 'owned')
        return error(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['reason']);
      if (state.staffReviewMode === 'denied' || state.staffReviewMode === 'missing')
        return error(
          route,
          state.staffReviewMode === 'denied' ? 403 : 404,
          state.staffReviewMode === 'denied'
            ? ErrorCodes.AUTHZ_FORBIDDEN.code
            : ErrorCodes.NOT_FOUND_RESOURCE.code
        );
      const review = savingAddressReview(state.staffDetails.get(savingChangeOrder)!, selection);
      return route.fulfill({
        status: 200,
        json:
          state.staffReviewMode === 'foreign'
            ? {
                ...review,
                scope: {
                  action: 'saving.staff-address-amendment',
                  profileId: changePlan,
                  resourceId: savingChangeOrder,
                },
              }
            : state.staffReviewMode === 'malformed'
              ? { ...review, hash: 'bad' }
              : review,
      });
    }
  );
  await page.route(`**/api/staff/saving/orders/${savingChangeOrder}/amend-address`, (route) => {
    const command = route.request().postDataJSON() as StaffCommand;
    state.staffWrites.push(command);
    state.staffSerializedWrites.push(route.request().postData()!);
    if (state.needsStepUp && !stepUp.verified)
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code,
            message: 'Step-up required',
            correlationId,
          },
          requiresStepUp: true,
        },
      });
    if (state.staffWriteMode === 'held') {
      state.staffWriteRoute = route;
      return;
    }
    if (
      state.staffWriteMode === 'denied' ||
      state.staffWriteMode === 'missing' ||
      state.staffWriteMode === 'rejected'
    )
      return error(
        route,
        state.staffWriteMode === 'denied' ? 403 : state.staffWriteMode === 'missing' ? 404 : 409,
        state.staffWriteMode === 'denied'
          ? ErrorCodes.AUTHZ_FORBIDDEN.code
          : state.staffWriteMode === 'missing'
            ? ErrorCodes.NOT_FOUND_RESOURCE.code
            : ErrorCodes.CONFLICT_STATE.code
      );
    const receipt = persistStaff(command);
    return route.fulfill({
      status: 201,
      json:
        state.staffWriteMode === 'foreign'
          ? { ...receipt, savingOrderId: otherSavingChangeOrder }
          : state.staffWriteMode === 'malformed'
            ? { ...receipt, address: { ...receipt.address, postal_code: '0000000000' } }
            : receipt,
    });
  });
  return { state, persistCustomer, persistStaff };
}
