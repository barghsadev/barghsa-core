import { catalogueInteger, record } from './catalogue-form.js';

export interface AgreementDraft {
  title: string;
  body: string;
}
export const agreementDefaults: AgreementDraft = { title: '', body: '' };
export interface Agreement extends AgreementDraft {
  id: string;
  plan_id: string;
  status: 'draft' | 'active' | 'superseded';
  effective_from: string | null;
}
export interface AgreementConfig {
  planId: string;
  agreements: Agreement[];
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export function validAgreement(value: unknown): value is Agreement {
  return (
    record(value) &&
    uuid(value.id) &&
    uuid(value.plan_id) &&
    typeof value.title === 'string' &&
    !!value.title.trim() &&
    value.title.length <= 300 &&
    typeof value.body === 'string' &&
    !!value.body.trim() &&
    value.body.length <= 50_000 &&
    ['draft', 'active', 'superseded'].includes(String(value.status)) &&
    (value.status === 'draft'
      ? value.effective_from === null
      : typeof value.effective_from === 'string' &&
        Number.isFinite(Date.parse(value.effective_from)))
  );
}
export function validAgreementConfig(value: unknown): value is AgreementConfig {
  if (!record(value) || !uuid(value.planId) || !Array.isArray(value.agreements)) return false;
  const rows = value.agreements;
  return (
    rows.every((row) => validAgreement(row) && row.plan_id === value.planId) &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    rows.filter((row) => row.status === 'draft').length <= 1 &&
    rows.filter((row) => row.status === 'active').length <= 1
  );
}
export function agreementValues(config: AgreementConfig): AgreementDraft {
  const row =
    config.agreements.find((row) => row.status === 'draft') ??
    config.agreements.find((row) => row.status === 'active');
  return row ? { title: row.title, body: row.body } : agreementDefaults;
}
export function agreementBasis(config: AgreementConfig) {
  return JSON.stringify({
    planId: config.planId,
    agreements: [...config.agreements]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, plan_id, title, body, status, effective_from }) => ({
        id,
        plan_id,
        title,
        body,
        status,
        effective_from,
      })),
  });
}
export function matchesAgreementReceipt(
  value: unknown,
  planId: string,
  draft: AgreementDraft,
  activationId?: string
): value is Agreement {
  return (
    validAgreement(value) &&
    value.plan_id === planId &&
    value.title === draft.title &&
    value.body === draft.body &&
    (activationId
      ? value.id === activationId && value.status === 'active'
      : value.status === 'draft')
  );
}
export interface Inventory {
  hardwareId: string;
  stockTracking: boolean;
  stockCount: number;
  reservedCount: number;
  reservationMinutes: number;
}
export interface InventoryDraft {
  stockTracking: boolean;
  stockCount: string;
  reservationMinutes: string;
}
export const inventoryDefaults: InventoryDraft = {
  stockTracking: false,
  stockCount: '0',
  reservationMinutes: '1440',
};
export function inventoryInteger(raw: string, min: number, max: number): number | null {
  const value = catalogueInteger(raw);
  if (value === null || BigInt(value) < BigInt(min) || BigInt(value) > BigInt(max)) return null;
  return Number(value);
}
export function validInventory(value: unknown): value is Inventory {
  return (
    record(value) &&
    uuid(value.hardwareId) &&
    typeof value.stockTracking === 'boolean' &&
    Number.isInteger(value.stockCount) &&
    Number(value.stockCount) >= 0 &&
    Number(value.stockCount) <= 1_000_000 &&
    Number.isInteger(value.reservedCount) &&
    Number(value.reservedCount) >= 0 &&
    Number(value.reservedCount) <= Number(value.stockCount) &&
    (value.stockTracking || value.reservedCount === 0) &&
    Number.isInteger(value.reservationMinutes) &&
    Number(value.reservationMinutes) >= 5 &&
    Number(value.reservationMinutes) <= 10080
  );
}
export function inventoryValues(value: Inventory): InventoryDraft {
  return {
    stockTracking: value.stockTracking,
    stockCount: String(value.stockCount),
    reservationMinutes: String(value.reservationMinutes),
  };
}
export function inventoryBasis(value: Inventory) {
  return JSON.stringify({
    hardwareId: value.hardwareId,
    ...inventoryValues(value),
    reservedCount: value.reservedCount,
  });
}
export function matchesInventoryReceipt(
  value: unknown,
  hardwareId: string,
  draft: InventoryDraft
): value is Inventory {
  return (
    validInventory(value) &&
    value.hardwareId === hardwareId &&
    value.stockTracking === draft.stockTracking &&
    value.stockCount === inventoryInteger(draft.stockCount, 0, 1_000_000) &&
    value.reservationMinutes === inventoryInteger(draft.reservationMinutes, 5, 10080)
  );
}
