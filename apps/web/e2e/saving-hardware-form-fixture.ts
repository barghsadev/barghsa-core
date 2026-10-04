import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { SavingHardwareUpgrade } from '../src/components/SavingHardwareUpgradeHistory';
import {
  setupSavingChangeAddressForms,
  savingChangeOrder,
  otherSavingChangeOrder,
  currentHardware,
  replacementHardware,
  hardwareTitle,
  replacementTitle,
  changeVersion,
} from './saving-change-address-form-fixture';
export { savingChangeOrder, otherSavingChangeOrder, currentHardware, replacementHardware };
const uuid = (n: number) => `89300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const receiptUuid = (n: number) => uuid(n).replace('-4000-', '-7000-');
export const equalHardware = uuid(1),
  cheaperHardware = uuid(2),
  upgradeId = receiptUuid(3),
  nextUpgradeId = receiptUuid(4),
  chargeInvoiceId = receiptUuid(5),
  creditInvoiceId = receiptUuid(6),
  amendmentId = receiptUuid(7);
const correlationId = uuid(8),
  stamp = '2026-10-05T10:00:00.000Z';
const hardwareChoices = [
  {
    id: replacementHardware,
    title: replacementTitle,
    priceIrR: '250000',
    totalIrR: '348800',
    priceDeltaIrR: '54500',
  },
  {
    id: equalHardware,
    title: { en: 'Equal-price device', fa: 'دستگاه هم‌قیمت' },
    priceIrR: '200000',
    totalIrR: '294300',
    priceDeltaIrR: '0',
  },
  {
    id: cheaperHardware,
    title: { en: 'Lower-price device', fa: 'دستگاه ارزان‌تر' },
    priceIrR: '150000',
    totalIrR: '239800',
    priceDeltaIrR: '-54500',
  },
].map((row) => ({ ...row, vatRateBps: 900, stockTracking: true, availableCount: 2 }));
const allHardware = [
  {
    id: currentHardware,
    title: hardwareTitle,
    priceIrR: '200000',
    totalIrR: '294300',
    priceDeltaIrR: '0',
    vatRateBps: 900,
    stockTracking: true,
    availableCount: 3,
  },
  ...hardwareChoices,
];
function currentBasis(detail: HardwareDetail) {
  return allHardware.find((option) => option.id === detail.hardwareProductId)!;
}
function offeredHardware(detail: HardwareDetail) {
  if (!detail.canAmendHardware) return [];
  const current = currentBasis(detail);
  return allHardware
    .filter((option) => option.id !== current.id)
    .map((option) => ({
      ...option,
      priceDeltaIrR: (BigInt(option.totalIrR) - BigInt(current.totalIrR)).toString(),
    }));
}
export type HardwareDraft = {
  expectedVersionId: string;
  expectedHardwareId: string;
  hardwareProductId: string;
  reason: string;
};
export type CancellationDraft = { upgradeId: string; reason: string };
export type Command<T> = T & { idempotencyKey: string; expectedReviewHash: string };
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
function review(action: string, detail: HardwareDetail, data: Record<string, unknown>) {
  const body = {
    schemaVersion: 1,
    scope: { action, profileId: detail.profileId, resourceId: detail.id },
    data,
  };
  return {
    ...body,
    hash: createHash('sha256')
      .update(JSON.stringify(canonical(body)))
      .digest('hex'),
  };
}
type Base =
  Awaited<ReturnType<typeof setupSavingChangeAddressForms>>['state']['staffDetails'] extends Map<
    string,
    infer D
  >
    ? D
    : never;
type UpgradeRow = SavingHardwareUpgrade & { appliedAt: string | null; closedAt: string | null };
export type HardwareDetail = Omit<
  Base,
  'hardwareOptions' | 'hardwareUpgrades' | 'hardwareAmendments'
> & {
  hardwareOptions: typeof hardwareChoices;
  hardwareUpgrades: UpgradeRow[];
  hardwareAmendments: Array<{
    id: string;
    changedAt: string;
    reason: string;
    priceDeltaIrR: string;
    adjustmentInvoiceId: string | null;
    previousTitle: typeof hardwareTitle;
    hardwareTitle: typeof hardwareTitle;
    previousHardwareId: string;
    hardwareId: string;
  }>;
};
function financialSource(detail: HardwareDetail, reason: string) {
  return {
    reason,
    customerName: detail.customerName,
    profileName: 'Change Buyer',
    billIdentifier: detail.billIdentifier,
    addressSnapshot: detail.addressSnapshot,
    agreementSnapshot: detail.agreementSnapshot,
    contractId: detail.contractId,
    contractState: detail.contractState,
    versionId: detail.versionId,
    versionNumber: 1,
    contractSnapshot: {},
  };
}
export function savingHardwareReview(detail: HardwareDetail, draft: HardwareDraft) {
  const current = currentBasis(detail);
  const target = offeredHardware(detail).find((row) => row.id === draft.hardwareProductId)!;
  return review('saving.staff-hardware-amendment', detail, {
    ...financialSource(detail, draft.reason),
    invoiceId: detail.invoiceId,
    invoiceState: detail.invoiceState,
    invoiceTotal: detail.totalIrR,
    paidAmount: detail.paidIrR,
    refundedAmount: detail.refundedIrR,
    pendingRefundAmount: detail.pendingRefundIrR,
    currentHardwareId: detail.hardwareProductId,
    currentHardwareTitle: detail.hardwareTitle,
    currentHardwarePriceIrR: current.priceIrR,
    currentHardwareVatRateBps: current.vatRateBps,
    currentOrderTotalIrR: current.totalIrR,
    targetHardwareId: target.id,
    targetHardwareTitle: target.title,
    targetHardwarePriceIrR: target.priceIrR,
    targetHardwareVatRateBps: target.vatRateBps,
    targetOrderTotalIrR: target.totalIrR,
    priceDeltaIrR: target.priceDeltaIrR,
    targetStockTracking: target.stockTracking,
    targetAvailableCount: target.availableCount,
    outcome:
      BigInt(target.priceDeltaIrR) > 0n
        ? 'additional_charge'
        : BigInt(target.priceDeltaIrR) < 0n
          ? 'credit_note'
          : 'swap_without_price_change',
  });
}
export function savingHardwareCancellationReview(detail: HardwareDetail, draft: CancellationDraft) {
  const upgrade = detail.hardwareUpgrades.find((row) => row.id === draft.upgradeId)!;
  return review('saving.staff-hardware-upgrade-cancellation', detail, {
    ...financialSource(detail, draft.reason),
    upgradeVersionId: changeVersion,
    upgradeId: upgrade.id,
    previousHardware: {
      title: upgrade.previousTitle,
      priceIrR: '200000',
      vatRateBps: 900,
      totalIrR: '294300',
    },
    replacementHardware: {
      title: upgrade.hardwareTitle,
      priceIrR: '250000',
      vatRateBps: 900,
      totalIrR: '348800',
    },
    stockReserved: true,
    adjustmentInvoiceId: upgrade.adjustmentInvoiceId,
    adjustmentInvoiceState: upgrade.invoiceState,
    additionalChargeIrR: upgrade.priceDeltaIrR,
    invoiceTotalIrR: upgrade.priceDeltaIrR,
    invoicePaidIrR: '0',
    outcome: 'cancel_unpaid_charge_and_release_reservation',
  });
}
type PreviewMode = 'owned' | 'success' | 'held' | 'foreign' | 'malformed' | 'denied' | 'missing';
type WriteMode = 'success' | 'held' | 'foreign' | 'malformed' | 'rejected';
export async function setupSavingHardwareForms(page: Page, locale: 'en' | 'fa') {
  const base = await setupSavingChangeAddressForms(page, locale, true);
  const details = new Map<string, HardwareDetail>(
    [...base.state.staffDetails].map(([id, row]) => [
      id,
      {
        ...row,
        hardwareOptions: hardwareChoices,
        hardwareUpgrades: [],
        hardwareAmendments: [],
      },
    ])
  );
  const state = {
    details,
    stepUp: base.state.stepUp,
    reads: [] as string[],
    needsStepUp: false,
    hardwarePreviewMode: 'owned' as PreviewMode,
    cancelPreviewMode: 'owned' as PreviewMode,
    hardwareWriteMode: 'success' as WriteMode,
    cancelWriteMode: 'success' as WriteMode,
    hardwarePreviews: [] as HardwareDraft[],
    cancelPreviews: [] as CancellationDraft[],
    hardwareWrites: [] as Command<HardwareDraft>[],
    cancelWrites: [] as Command<CancellationDraft>[],
    hardwareBodies: [] as string[],
    hardwareCsrf: [] as string[],
    cancelBodies: [] as string[],
    hardwarePreviewRoute: undefined as Route | undefined,
    cancelPreviewRoute: undefined as Route | undefined,
    hardwareWriteRoute: undefined as Route | undefined,
    cancelWriteRoute: undefined as Route | undefined,
    hardwareReceipts: new Map<string, Record<string, unknown>>(),
    cancelReceipts: new Map<string, Record<string, unknown>>(),
  };
  const publicError = (route: Route, status: number, code: string, fields?: string[]) =>
    route.fulfill({
      status,
      json: {
        error: {
          code,
          message: 'PRIVATE_HARDWARE_SERVER_MESSAGE',
          correlationId,
          ...(fields ? { fields } : {}),
        },
      },
    });
  function pendingUpgrade(id = upgradeId): UpgradeRow {
    return {
      id,
      status: 'awaiting_payment',
      createdAt: stamp,
      appliedAt: null,
      closedAt: null,
      reason: 'Customer requested higher-price equipment',
      priceDeltaIrR: '54500',
      adjustmentInvoiceId: id === upgradeId ? chargeInvoiceId : receiptUuid(9),
      invoiceState: 'Unpaid',
      paidIrR: '0',
      previousTitle: hardwareTitle,
      hardwareTitle: replacementTitle,
    };
  }
  function persistHardware(command: Command<HardwareDraft>) {
    const old = state.hardwareReceipts.get(command.idempotencyKey);
    if (old) return old;
    const detail = state.details.get(savingChangeOrder)!,
      target = offeredHardware(detail).find((row) => row.id === command.hardwareProductId)!;
    const positive = BigInt(target.priceDeltaIrR) > 0n;
    const receipt = positive
      ? {
          upgradeId,
          savingOrderId: savingChangeOrder,
          hardwareProductId: target.id,
          priceDeltaIrR: target.priceDeltaIrR,
          adjustmentInvoiceId: chargeInvoiceId,
          status: 'awaiting_payment',
        }
      : {
          amendmentId,
          savingOrderId: savingChangeOrder,
          hardwareProductId: target.id,
          priceDeltaIrR: target.priceDeltaIrR,
          adjustmentInvoiceId: BigInt(target.priceDeltaIrR) < 0n ? creditInvoiceId : null,
        };
    state.hardwareReceipts.set(command.idempotencyKey, receipt);
    if (positive) {
      detail.hardwareUpgrades = [pendingUpgrade()];
      detail.canAmendHardware = false;
      detail.hardwareOptions = [];
    } else {
      detail.hardwareProductId = target.id;
      detail.hardwareTitle = target.title;
      detail.hardwareAmendments = [
        {
          id: amendmentId,
          changedAt: stamp,
          reason: command.reason,
          priceDeltaIrR: target.priceDeltaIrR,
          adjustmentInvoiceId: BigInt(target.priceDeltaIrR) < 0n ? creditInvoiceId : null,
          previousTitle: hardwareTitle,
          hardwareTitle: target.title,
          previousHardwareId: currentHardware,
          hardwareId: target.id,
        },
      ];
      detail.hardwareOptions = offeredHardware(detail);
    }
    return receipt;
  }
  function persistCancellation(command: Command<CancellationDraft>) {
    const old = state.cancelReceipts.get(command.idempotencyKey);
    if (old) return old;
    const detail = state.details.get(savingChangeOrder)!,
      upgrade = detail.hardwareUpgrades.find((row) => row.id === command.upgradeId)!;
    const receipt = {
      savingOrderId: savingChangeOrder,
      upgradeId: upgrade.id,
      status: 'cancelled',
    };
    state.cancelReceipts.set(command.idempotencyKey, receipt);
    upgrade.status = 'cancelled';
    upgrade.closedAt = stamp;
    upgrade.invoiceState = 'Cancelled';
    detail.canAmendHardware = true;
    detail.hardwareOptions = offeredHardware(detail);
    return receipt;
  }
  function nextPendingUpgrade() {
    const detail = state.details.get(savingChangeOrder)!;
    // A later authorized read may observe a new command made by another staff actor. At most one pending row exists.
    detail.hardwareUpgrades = [...detail.hardwareUpgrades, pendingUpgrade(nextUpgradeId)];
    detail.canAmendHardware = false;
    detail.hardwareOptions = [];
  }
  await page.route(/\/api\/staff\/saving\/orders(?:\?.*)?$/, (route) => {
    state.reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { orders: [...state.details.values()], nextAfter: null } });
  });
  await page.route(/\/api\/staff\/saving\/orders\/[^/]+$/, (route) => {
    const path = new URL(route.request().url()).pathname;
    state.reads.push(path);
    return route.fulfill({ json: state.details.get(path.split('/').at(-1)!) });
  });
  await page.route(
    /\/api\/staff\/saving\/orders\/[^/]+\/(?:amend-hardware-review|cancel-hardware-upgrade-review)$/,
    (route) => {
      const path = new URL(route.request().url()).pathname,
        hardware = path.endsWith('amend-hardware-review');
      const draft = route.request().postDataJSON();
      const mode = hardware ? state.hardwarePreviewMode : state.cancelPreviewMode;
      if (hardware) state.hardwarePreviews.push(draft);
      else state.cancelPreviews.push(draft);
      if (mode === 'held') {
        if (hardware) state.hardwarePreviewRoute = route;
        else state.cancelPreviewRoute = route;
        return;
      }
      if (mode === 'owned')
        return publicError(route, 400, ErrorCodes.VALIDATION_INPUT_INVALID.code, ['reason']);
      if (mode === 'denied' || mode === 'missing')
        return publicError(
          route,
          mode === 'denied' ? 403 : 404,
          mode === 'denied' ? ErrorCodes.AUTHZ_FORBIDDEN.code : ErrorCodes.NOT_FOUND_RESOURCE.code
        );
      const detail = state.details.get(path.split('/').at(-2)!)!;
      const value = hardware
        ? savingHardwareReview(detail, draft)
        : savingHardwareCancellationReview(detail, draft);
      const data = value.data as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        json:
          mode === 'foreign'
            ? { ...value, data: { ...data, contractId: nextUpgradeId } }
            : mode === 'malformed'
              ? { ...value, hash: 'bad' }
              : value,
      });
    }
  );
  await page.route(
    /\/api\/staff\/saving\/orders\/[^/]+\/(?:amend-hardware|cancel-hardware-upgrade)$/,
    (route) => {
      const path = new URL(route.request().url()).pathname,
        hardware = path.endsWith('amend-hardware');
      const command = route.request().postDataJSON(),
        mode = hardware ? state.hardwareWriteMode : state.cancelWriteMode;
      if (hardware) {
        state.hardwareWrites.push(command);
        state.hardwareBodies.push(route.request().postData()!);
        state.hardwareCsrf.push(route.request().headers()['x-csrf-token'] ?? '');
      } else {
        state.cancelWrites.push(command);
        state.cancelBodies.push(route.request().postData()!);
      }
      if (state.needsStepUp && !state.stepUp.verified)
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
      if (mode === 'held') {
        if (hardware) state.hardwareWriteRoute = route;
        else state.cancelWriteRoute = route;
        return;
      }
      if (mode === 'rejected') return publicError(route, 409, ErrorCodes.CONFLICT_STATE.code);
      const receipt = hardware ? persistHardware(command) : persistCancellation(command);
      return route.fulfill({
        status: hardware ? 201 : 200,
        json:
          mode === 'foreign'
            ? { ...receipt, savingOrderId: otherSavingChangeOrder }
            : mode === 'malformed'
              ? {
                  ...receipt,
                  ...(hardware ? { adjustmentInvoiceId: 'invalid' } : { status: 'expired' }),
                }
              : receipt,
      });
    }
  );
  return { state, persistHardware, persistCancellation, nextPendingUpgrade };
}
