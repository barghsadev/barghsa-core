import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { boundedCatalogueInteger, record } from './catalogue-form.js';
export const electricityModes = ['simpleOrder', 'advancedOrder'] as const;
export interface GreenDraft {
  simpleEnabled: boolean;
  simpleThreshold: string;
  simpleShare: number;
  advancedEnabled: boolean;
  advancedThreshold: string;
  advancedShare: number;
}
export const greenDefaults: GreenDraft = {
  simpleEnabled: true,
  simpleThreshold: '1000',
  simpleShare: 4,
  advancedEnabled: false,
  advancedThreshold: '1000',
  advancedShare: 4,
};
export interface GreenSafety {
  simpleOrder: { blocked: boolean; reasons: string[] };
  advancedOrder: { blocked: boolean; reasons: string[] };
}
export function validGreenConfig(value: unknown): value is GreenElectricityConfig {
  return (
    record(value) &&
    electricityModes.every((mode) => {
      const row = value[mode];
      return (
        record(row) &&
        typeof row.mandatoryGreenEnabled === 'boolean' &&
        Number.isSafeInteger(row.averagePowerThresholdKw) &&
        Number(row.averagePowerThresholdKw) >= 0 &&
        typeof row.mandatoryGreenSharePercent === 'number' &&
        Number.isFinite(row.mandatoryGreenSharePercent) &&
        row.mandatoryGreenSharePercent >= 0 &&
        row.mandatoryGreenSharePercent <= 100
      );
    })
  );
}
export function validGreenSafety(value: unknown): value is GreenSafety {
  return (
    record(value) &&
    electricityModes.every((mode) => {
      const row = value[mode];
      return (
        record(row) &&
        typeof row.blocked === 'boolean' &&
        Array.isArray(row.reasons) &&
        row.reasons.every((reason) =>
          ['missing', 'inactive', 'archived', 'unpriced', 'limits_incompatible'].includes(reason)
        ) &&
        (!row.blocked || row.reasons.length > 0)
      );
    })
  );
}
export function greenValues(value: GreenElectricityConfig): GreenDraft {
  return {
    simpleEnabled: value.simpleOrder.mandatoryGreenEnabled,
    simpleThreshold: String(value.simpleOrder.averagePowerThresholdKw),
    simpleShare: value.simpleOrder.mandatoryGreenSharePercent,
    advancedEnabled: value.advancedOrder.mandatoryGreenEnabled,
    advancedThreshold: String(value.advancedOrder.averagePowerThresholdKw),
    advancedShare: value.advancedOrder.mandatoryGreenSharePercent,
  };
}
export function greenBody(value: GreenDraft): GreenElectricityConfig {
  return {
    simpleOrder: {
      mandatoryGreenEnabled: value.simpleEnabled,
      averagePowerThresholdKw: boundedCatalogueInteger(
        value.simpleThreshold,
        0,
        Number.MAX_SAFE_INTEGER
      )!,
      mandatoryGreenSharePercent: value.simpleShare,
    },
    advancedOrder: {
      mandatoryGreenEnabled: value.advancedEnabled,
      averagePowerThresholdKw: boundedCatalogueInteger(
        value.advancedThreshold,
        0,
        Number.MAX_SAFE_INTEGER
      )!,
      mandatoryGreenSharePercent: value.advancedShare,
    },
  };
}
export const greenBasis = (value: GreenElectricityConfig) => JSON.stringify(greenValues(value));
export function greenSafetyBasis(value: GreenSafety | null) {
  return JSON.stringify(
    value
      ? electricityModes.map((mode) => ({
          mode,
          blocked: value[mode].blocked,
          reasons: [...value[mode].reasons].sort(),
        }))
      : null
  );
}
export function matchesGreenReceipt(value: unknown, body: unknown) {
  return (
    validGreenConfig(value) && validGreenConfig(body) && greenBasis(value) === greenBasis(body)
  );
}
export interface RetentionSetting {
  days: number;
}
export interface RetentionDraft {
  days: string;
}
export const retentionDefaults: RetentionDraft = { days: '7' };
export const validRetention = (value: unknown): value is RetentionSetting =>
  record(value) &&
  Number.isInteger(value.days) &&
  Number(value.days) >= 1 &&
  Number(value.days) <= 365;
export const retentionValues = (value: RetentionSetting): RetentionDraft => ({
  days: String(value.days),
});
export const retentionBasis = (value: RetentionSetting) => String(value.days);
export const validVersionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
export interface TemplateSetting {
  selectedVersionId: string | null;
  options: {
    id: string;
    name: string;
    versionNumber: number;
    active: boolean;
    supported: boolean;
  }[];
}
export interface TemplateDraft {
  versionId: string | null;
}
export const templateDefaults: TemplateDraft = { versionId: null };
export function validTemplateSetting(value: unknown): value is TemplateSetting {
  return (
    record(value) &&
    (value.selectedVersionId === null || validVersionId(value.selectedVersionId)) &&
    Array.isArray(value.options) &&
    value.options.every(
      (option) =>
        record(option) &&
        validVersionId(option.id) &&
        typeof option.name === 'string' &&
        Number.isSafeInteger(option.versionNumber) &&
        Number(option.versionNumber) > 0 &&
        typeof option.active === 'boolean' &&
        typeof option.supported === 'boolean'
    ) &&
    new Set(value.options.map((option) => option.id)).size === value.options.length &&
    (value.selectedVersionId === null ||
      value.options.some((option) => option.id === value.selectedVersionId))
  );
}
export const templateValues = (value: TemplateSetting): TemplateDraft => ({
  versionId: value.selectedVersionId,
});
export const templateBasis = (value: TemplateSetting) =>
  JSON.stringify({
    selected: value.selectedVersionId,
    options: [...value.options]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((option) => ({
        id: option.id,
        name: option.name,
        versionNumber: option.versionNumber,
        active: option.active,
        supported: option.supported,
      })),
  });
export function matchesTemplateReceipt(value: unknown, body: unknown) {
  return (
    validTemplateSetting(value) &&
    record(body) &&
    value.selectedVersionId === body.versionId &&
    (value.selectedVersionId === null ||
      value.options.some(
        (option) => option.id === value.selectedVersionId && option.active && option.supported
      ))
  );
}
