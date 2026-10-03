import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { boundedCatalogueInteger, record } from './catalogue-form.js';
import { normalizeIrrAmountDigits } from './invoice-bank-receipt-upload.js';

export const contractLimitFields = [
  { key: 'maxQuantityIncreasePercent', wire: 'max_quantity_increase_percent', min: 0, max: 1000 },
  { key: 'maxContractDuration', wire: 'max_contract_duration_months', min: 1, max: 1200 },
  { key: 'leadTimeDays', wire: 'lead_time_days', min: 0, max: 36500 },
] as const;
export type ContractLimitDraft = Record<keyof ContractElectricityLimits, string>;
export const contractLimitDefaults: ContractLimitDraft = {
  maxQuantityIncreasePercent: '',
  maxContractDuration: '',
  leadTimeDays: '',
};
export function validContractLimits(value: unknown): value is ContractElectricityLimits {
  return (
    record(value) &&
    contractLimitFields.every(
      ({ key, min, max }) =>
        Number.isSafeInteger(value[key]) && Number(value[key]) >= min && Number(value[key]) <= max
    )
  );
}
export const contractLimitBasis = (value: ContractElectricityLimits) =>
  JSON.stringify(contractLimitFields.map(({ key }) => value[key]));
export const contractLimitValues = (value: ContractElectricityLimits): ContractLimitDraft => ({
  maxQuantityIncreasePercent: String(value.maxQuantityIncreasePercent),
  maxContractDuration: String(value.maxContractDuration),
  leadTimeDays: String(value.leadTimeDays),
});
export function contractLimitBody(draft: ContractLimitDraft) {
  return {
    max_quantity_increase_percent: boundedCatalogueInteger(
      draft.maxQuantityIncreasePercent,
      0,
      1000
    ),
    max_contract_duration_months: boundedCatalogueInteger(draft.maxContractDuration, 1, 1200),
    lead_time_days: boundedCatalogueInteger(draft.leadTimeDays, 0, 36500),
  };
}
export function matchesContractLimitReceipt(value: unknown, body: unknown) {
  return (
    validContractLimits(value) &&
    record(body) &&
    value.maxQuantityIncreasePercent === body.max_quantity_increase_percent &&
    value.maxContractDuration === body.max_contract_duration_months &&
    value.leadTimeDays === body.lead_time_days
  );
}
export const limitAmount = (raw: string, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  boundedCatalogueInteger(normalizeIrrAmountDigits(raw), min, max);
export interface WalletLimitSetting {
  limitIrR: number;
  version: number;
}
export type WalletLimitDraft = { limitIrR: string };
export const walletLimitDefaults: WalletLimitDraft = { limitIrR: '' };
export const walletLimitFields = [
  { key: 'limitIrR', min: 0, max: Number.MAX_SAFE_INTEGER },
] as const;
export const validWalletLimit = (value: unknown): value is WalletLimitSetting =>
  record(value) &&
  Number.isSafeInteger(value.limitIrR) &&
  Number(value.limitIrR) >= 0 &&
  Number.isSafeInteger(value.version) &&
  Number(value.version) >= 0;
export const walletLimitValues = (value: WalletLimitSetting): WalletLimitDraft => ({
  limitIrR: String(value.limitIrR),
});
export const walletLimitBasis = (value: WalletLimitSetting) =>
  JSON.stringify([value.limitIrR, value.version]);
export const matchesWalletLimitReceipt = (value: unknown, body: unknown) =>
  validWalletLimit(value) &&
  record(body) &&
  value.limitIrR === body.limit_irr &&
  typeof body.expected_version === 'number' &&
  value.version === body.expected_version + 1;
export interface ThresholdSetting {
  thresholdIrR: number;
}
export type ThresholdDraft = { thresholdIrR: string };
export const thresholdDefaults: ThresholdDraft = { thresholdIrR: '' };
export const thresholdFields = [
  { key: 'thresholdIrR', min: 0, max: Number.MAX_SAFE_INTEGER },
] as const;
export const validThreshold = (value: unknown): value is ThresholdSetting =>
  record(value) && Number.isSafeInteger(value.thresholdIrR) && Number(value.thresholdIrR) >= 0;
export const thresholdValues = (value: ThresholdSetting): ThresholdDraft => ({
  thresholdIrR: String(value.thresholdIrR),
});
export const thresholdBasis = (value: ThresholdSetting) => String(value.thresholdIrR);
export const matchesThresholdReceipt = (value: unknown, body: unknown) =>
  validThreshold(value) && record(body) && value.thresholdIrR === body.threshold_irr;
