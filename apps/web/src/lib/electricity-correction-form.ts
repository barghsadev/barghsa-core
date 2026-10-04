export const electricitySystems = ['thermal', 'green', 'free_market', 'energy_saving'] as const;
export type ElectricitySystem = (typeof electricitySystems)[number];
export type CorrectionOwner = 'address' | 'revision';
export interface ElectricityCorrectionLock {
  owner: CorrectionOwner | null;
  acquire: (owner: CorrectionOwner) => boolean;
  release: (owner: CorrectionOwner) => void;
}
export interface ElectricityAddressDraft {
  fullAddress: string;
  postalCode: string;
  responseNote: string;
}
export interface ElectricityRevisionDraft extends ElectricityAddressDraft {
  period: string;
  totalKwh: string;
  startAt: string;
  endAt: string;
  thermal: string;
  green: string;
  freeMarket: string;
  energySaving: string;
  giftCode: string;
  provinceId: string;
  cityId: string;
}
export interface ElectricityRevisionQuote {
  reviewDigest: string;
  periodStart: string;
  periodEnd: string;
  durationHours: string;
  averagePowerKw: string;
  greenRuleApplies: boolean;
  totalKwh: string;
  subtotalIrR: string;
  discountIrR: string;
  vatIrR: string;
  totalIrR: string;
  lines: Array<{
    productId: string;
    systemKey: ElectricitySystem;
    quantityKwh: string;
    unitPriceIrR: string;
    subtotalIrR: string;
    discountIrR: string;
    vatRateBasisPoints: number;
    vatIrR: string;
    totalIrR: string;
  }>;
}
export const correctionRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const correctionUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digits = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,40}$/.test(value);
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
export function definitiveElectricityRejection(value: unknown) {
  return (
    correctionRecord(value) &&
    correctionRecord(value.error) &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => value.error && correctionRecord(value.error) && value.error.code === code) &&
    typeof value.error.message === 'string' &&
    correctionUuid(value.error.correlationId)
  );
}
export function electricityRevisionQuote(value: unknown): value is ElectricityRevisionQuote {
  if (
    !correctionRecord(value) ||
    typeof value.reviewDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.reviewDigest) ||
    !instant(value.periodStart) ||
    !instant(value.periodEnd) ||
    Date.parse(value.periodEnd) <= Date.parse(value.periodStart) ||
    typeof value.durationHours !== 'string' ||
    !/^\d+(\.\d+)?$/.test(value.durationHours) ||
    !Number.isFinite(Number(value.durationHours)) ||
    Number(value.durationHours) <= 0 ||
    typeof value.averagePowerKw !== 'string' ||
    !/^\d+(\.\d+)?$/.test(value.averagePowerKw) ||
    typeof value.greenRuleApplies !== 'boolean' ||
    !digits(value.totalKwh) ||
    BigInt(value.totalKwh) <= 0n ||
    !['subtotalIrR', 'discountIrR', 'vatIrR', 'totalIrR'].every((name) => digits(value[name])) ||
    !Array.isArray(value.lines) ||
    !value.lines.length ||
    value.lines.length > electricitySystems.length
  )
    return false;
  const seen = new Set<string>();
  const sums = { quantityKwh: 0n, subtotalIrR: 0n, discountIrR: 0n, vatIrR: 0n, totalIrR: 0n };
  for (const line of value.lines) {
    if (
      !correctionRecord(line) ||
      !correctionUuid(line.productId) ||
      !electricitySystems.some((key) => key === line.systemKey) ||
      seen.has(String(line.systemKey)) ||
      !['quantityKwh', 'unitPriceIrR', 'subtotalIrR', 'discountIrR', 'vatIrR', 'totalIrR'].every(
        (name) => digits(line[name])
      ) ||
      !Number.isInteger(line.vatRateBasisPoints) ||
      Number(line.vatRateBasisPoints) < 0 ||
      Number(line.vatRateBasisPoints) > 10000
    )
      return false;
    seen.add(String(line.systemKey));
    if (
      BigInt(line.discountIrR as string) > BigInt(line.subtotalIrR as string) ||
      BigInt(line.totalIrR as string) !==
        BigInt(line.subtotalIrR as string) -
          BigInt(line.discountIrR as string) +
          BigInt(line.vatIrR as string)
    )
      return false;
    for (const name of Object.keys(sums) as Array<keyof typeof sums>)
      sums[name] += BigInt(line[name] as string);
  }
  return (
    sums.quantityKwh === BigInt(value.totalKwh) &&
    ['subtotalIrR', 'discountIrR', 'vatIrR', 'totalIrR'].every(
      (name) => sums[name as keyof typeof sums] === BigInt(value[name] as string)
    )
  );
}
export function electricityCorrectionReceipt(
  value: unknown,
  captured: { orderId: string; contractId: string; versionId: string; invoiceId?: string },
  review?: ElectricityRevisionQuote
): boolean {
  if (
    !correctionRecord(value) ||
    value.orderId !== captured.orderId ||
    value.contractId !== captured.contractId ||
    !correctionUuid(value.versionId) ||
    value.versionId === captured.versionId ||
    value.status !== 'awaiting_staff_review'
  )
    return false;
  return (
    !review ||
    (correctionUuid(value.invoiceId) &&
      value.invoiceId !== captured.invoiceId &&
      electricityRevisionQuote(value) &&
      Object.keys(review).every(
        (name) => name === 'lines' || value[name] === review[name as keyof ElectricityRevisionQuote]
      ) &&
      value.lines.length === review.lines.length &&
      review.lines.every((line, index) =>
        Object.keys(line).every(
          (name) =>
            value.lines[index]?.[name as keyof typeof line] === line[name as keyof typeof line]
        )
      ))
  );
}
import { ErrorCodes } from '@barghsa/shared/errors';
