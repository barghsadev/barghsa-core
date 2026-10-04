import { ErrorCodes } from '@barghsa/shared/errors';
import { sameFormData, uuidReference } from './form-receipt.js';

export type SavingChangeDraft = { hardwareProductId: string; installationAddressId: string };
export interface SavingChangeSource {
  orderId: string;
  profileId: string;
  planId: string;
  currentHardwareId: string;
  currentAddressId: string;
  currentVersionId: string;
  invoiceId: string;
  billIdentifier: string;
  agreementVersionId: string;
}
export interface SavingChangeHardware {
  id: string;
  title: { fa: string; en: string };
  status: string;
  price: string | null;
  stock_tracking: boolean;
  available_count: number;
}
export interface SavingChangeAddress {
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
}
export interface SavingChangeQuote {
  plan: { id: string; title: { fa: string; en: string } };
  hardware: { id: string; title: { fa: string; en: string } };
  billIdentifier: string;
  address: {
    id: string;
    province_id: string;
    city_id: string;
    full_address: string;
    postal_code: string;
  };
  agreement: { versionId: string; title: string; body: string };
  lines: Array<{
    type: 'plan_price' | 'hardware_price';
    productId: string;
    title: { fa: string; en: string };
    amountIrR: string;
    discountIrR: string;
    netIrR: string;
    vatRateBps: number;
    vatIrR: string;
  }>;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
  giftCodeId: string | null;
  baseVersionId: string;
  reviewDigest: string;
}
const maxIrr = 9_223_372_036_854_775_807n;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const savingChangeUuid = (value: unknown): value is string => {
  try {
    uuidReference(value);
    return true;
  } catch {
    return false;
  }
};
const title = (value: unknown): value is { fa: string; en: string } =>
  record(value) && typeof value.fa === 'string' && typeof value.en === 'string';
const amount = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= maxIrr;
export function savingChangeOptions(
  plans: unknown,
  addresses: unknown,
  planId: string,
  profileId: string
) {
  if (
    !record(plans) ||
    !Array.isArray(plans.plans) ||
    !record(addresses) ||
    !Array.isArray(addresses.addresses)
  )
    return null;
  const plan = plans.plans.find((value) => record(value) && value.id === planId);
  if (
    !record(plan) ||
    plan.status !== 'active' ||
    !amount(plan.price) ||
    BigInt(plan.price) <= 0n ||
    !Array.isArray(plan.hardware)
  )
    return null;
  const hardware: SavingChangeHardware[] = [];
  for (const item of plan.hardware) {
    if (
      !record(item) ||
      !savingChangeUuid(item.id) ||
      !title(item.title) ||
      typeof item.status !== 'string' ||
      (item.price !== null && !amount(item.price)) ||
      typeof item.stock_tracking !== 'boolean' ||
      !Number.isInteger(item.available_count)
    )
      return null;
    hardware.push({
      id: item.id,
      title: item.title,
      status: item.status,
      price: item.price,
      stock_tracking: item.stock_tracking,
      available_count: item.available_count as number,
    });
  }
  const rows: SavingChangeAddress[] = [];
  for (const item of addresses.addresses) {
    if (
      !record(item) ||
      item.profileId !== profileId ||
      !savingChangeUuid(item.id) ||
      !savingChangeUuid(item.provinceId) ||
      !savingChangeUuid(item.cityId) ||
      typeof item.fullAddress !== 'string' ||
      !item.fullAddress.trim() ||
      typeof item.postalCode !== 'string' ||
      !/^\d{10}$/.test(item.postalCode)
    )
      return null;
    rows.push({
      id: item.id,
      provinceId: item.provinceId,
      cityId: item.cityId,
      fullAddress: item.fullAddress,
      postalCode: item.postalCode,
    });
  }
  if (
    new Set(hardware.map((row) => row.id)).size !== hardware.length ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    return null;
  return { hardware, addresses: rows };
}
export const availableSavingHardware = (item: SavingChangeHardware, currentId: string) =>
  item.status === 'active' &&
  item.price !== null &&
  BigInt(item.price) > 0n &&
  (item.id === currentId || !item.stock_tracking || item.available_count > 0);
export function parseSavingChangeQuote(value: unknown): SavingChangeQuote | null {
  if (
    !record(value) ||
    !record(value.plan) ||
    !record(value.hardware) ||
    !savingChangeUuid(value.plan.id) ||
    !savingChangeUuid(value.hardware.id) ||
    !title(value.plan.title) ||
    !title(value.hardware.title) ||
    typeof value.billIdentifier !== 'string' ||
    !/^\d{6,13}$/.test(value.billIdentifier) ||
    !record(value.address) ||
    !savingChangeUuid(value.address.id) ||
    !savingChangeUuid(value.address.province_id) ||
    !savingChangeUuid(value.address.city_id) ||
    typeof value.address.full_address !== 'string' ||
    !value.address.full_address.trim() ||
    typeof value.address.postal_code !== 'string' ||
    !/^\d{10}$/.test(value.address.postal_code) ||
    !record(value.agreement) ||
    !savingChangeUuid(value.agreement.versionId) ||
    typeof value.agreement.title !== 'string' ||
    typeof value.agreement.body !== 'string' ||
    !savingChangeUuid(value.baseVersionId) ||
    (value.giftCodeId !== null && !savingChangeUuid(value.giftCodeId)) ||
    typeof value.reviewDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.reviewDigest) ||
    !Array.isArray(value.lines) ||
    value.lines.length !== 2 ||
    !['subtotalIrR', 'discountIrR', 'vatIrR', 'totalIrR'].every((name) => amount(value[name]))
  )
    return null;
  const lines: SavingChangeQuote['lines'] = [];
  for (const [index, item] of value.lines.entries()) {
    const product = index === 0 ? value.plan : value.hardware;
    if (
      !record(item) ||
      item.type !== (index === 0 ? 'plan_price' : 'hardware_price') ||
      item.productId !== product.id ||
      !title(item.title) ||
      !sameFormData(item.title, product.title) ||
      !['amountIrR', 'discountIrR', 'netIrR', 'vatIrR'].every((name) => amount(item[name])) ||
      !Number.isInteger(item.vatRateBps) ||
      typeof item.vatRateBps !== 'number' ||
      item.vatRateBps < 0 ||
      item.vatRateBps > 10000
    )
      return null;
    lines.push({
      type: item.type as 'plan_price' | 'hardware_price',
      productId: product.id as string,
      title: item.title,
      amountIrR: item.amountIrR as string,
      discountIrR: item.discountIrR as string,
      netIrR: item.netIrR as string,
      vatRateBps: item.vatRateBps,
      vatIrR: item.vatIrR as string,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.amountIrR), 0n);
  const discount = BigInt(value.discountIrR as string);
  const allocations = lines.map((line) => (BigInt(line.amountIrR) * discount) / (subtotal || 1n));
  if (
    subtotal !== BigInt(value.subtotalIrR as string) ||
    subtotal > maxIrr ||
    discount > subtotal ||
    lines.some((line) => BigInt(line.amountIrR) <= 0n)
  )
    return null;
  if (discount > allocations[0]! + allocations[1]!) {
    const remainder = lines.map((line) => (BigInt(line.amountIrR) * discount) % subtotal);
    allocations[remainder[0]! >= remainder[1]! ? 0 : 1]! += 1n;
  }
  if (
    lines.some(
      (line, index) =>
        BigInt(line.discountIrR) !== allocations[index] ||
        BigInt(line.netIrR) !== BigInt(line.amountIrR) - allocations[index]! ||
        BigInt(line.vatIrR) !== (BigInt(line.netIrR) * BigInt(line.vatRateBps) + 5000n) / 10000n
    )
  )
    return null;
  const vat = lines.reduce((sum, line) => sum + BigInt(line.vatIrR), 0n);
  const total = subtotal - discount + vat;
  if (
    vat !== BigInt(value.vatIrR as string) ||
    total !== BigInt(value.totalIrR as string) ||
    total <= 0n ||
    total > maxIrr
  )
    return null;
  return {
    plan: { id: value.plan.id, title: value.plan.title },
    hardware: { id: value.hardware.id, title: value.hardware.title },
    billIdentifier: value.billIdentifier,
    address: {
      id: value.address.id,
      province_id: value.address.province_id,
      city_id: value.address.city_id,
      full_address: value.address.full_address,
      postal_code: value.address.postal_code,
    },
    agreement: {
      versionId: value.agreement.versionId,
      title: value.agreement.title,
      body: value.agreement.body,
    },
    lines,
    subtotalIrR: value.subtotalIrR as string,
    discountIrR: value.discountIrR as string,
    vatIrR: value.vatIrR as string,
    totalIrR: value.totalIrR as string,
    giftCodeId: value.giftCodeId,
    baseVersionId: value.baseVersionId,
    reviewDigest: value.reviewDigest,
  };
}
export function bindSavingChangeQuote(
  value: unknown,
  source: SavingChangeSource,
  draft: SavingChangeDraft,
  address: SavingChangeAddress
) {
  const quote = parseSavingChangeQuote(value);
  return quote &&
    quote.plan.id === source.planId &&
    quote.hardware.id === draft.hardwareProductId &&
    quote.billIdentifier === source.billIdentifier &&
    quote.agreement.versionId === source.agreementVersionId &&
    quote.baseVersionId === source.currentVersionId &&
    sameFormData(quote.address, {
      id: address.id,
      province_id: address.provinceId,
      city_id: address.cityId,
      full_address: address.fullAddress,
      postal_code: address.postalCode,
    }) &&
    quote.address.id === draft.installationAddressId
    ? quote
    : null;
}
export function matchedSavingChangeReceipt(
  value: unknown,
  source: SavingChangeSource,
  quote: SavingChangeQuote
) {
  if (
    !record(value) ||
    value.savingOrderId !== source.orderId ||
    value.invoiceId !== source.invoiceId ||
    !savingChangeUuid(value.contractVersionId) ||
    value.contractVersionId === source.currentVersionId
  )
    return null;
  const saved = parseSavingChangeQuote(value);
  return saved &&
    sameFormData({ ...saved, lines: undefined }, { ...quote, lines: undefined }) &&
    saved.lines.every((line, index) => sameFormData(line, quote.lines[index]))
    ? saved
    : null;
}
export function savingChangePublicError(value: unknown) {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  return typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    savingChangeUuid(error.correlationId)
    ? error
    : null;
}
export function definitiveSavingChangeRejection(value: unknown) {
  const error = savingChangePublicError(value);
  return error &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => code === error.code)
    ? error
    : null;
}
