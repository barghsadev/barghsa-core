import type {
  GreenDraft,
  GreenSafety,
  RetentionDraft,
  TemplateDraft,
  TemplateSetting,
} from './electricity-settings-form.js';
import { custom } from 'zod/mini';
import type { ServiceDraft, ServiceField } from './service-settings-form.js';
import type { TeamDraft, RoutingDraft } from './staff-team-form.js';
import type { Draft, PriceDraft, ProductType } from './catalogue-form.js';
import type { AgreementDraft, InventoryDraft } from './saving-catalogue-form.js';

export function staffTeamSchema<Draft extends TeamDraft | RoutingDraft>(
  messages: Record<keyof Draft, string>,
  invalidFields: (draft: Draft) => (keyof Draft)[]
) {
  return custom<Draft>().check((ctx) => {
    for (const field of invalidFields(ctx.value))
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [String(field)],
        message: messages[field],
      });
  });
}

export function integerSettingsSchema<Draft extends Record<string, string>>(
  messages: Record<keyof Draft, string>,
  fields: readonly { key: keyof Draft; min: number; max: number }[],
  integer: (raw: string, min: number, max: number) => number | null
) {
  return custom<Draft>().check((ctx) => {
    for (const { key, min, max } of fields) {
      const raw = ctx.value[key];
      if (typeof raw !== 'string' || integer(raw, min, max) === null)
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          path: [String(key)],
          message: messages[key],
        });
    }
  });
}

export function agreementFormSchema(messages: Record<keyof AgreementDraft, string>) {
  return custom<AgreementDraft>().check((ctx) => {
    for (const field of ['title', 'body'] as const) {
      const value = ctx.value[field].trim();
      if (!value || value.length > (field === 'title' ? 300 : 50_000))
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          path: [field],
          message: messages[field],
        });
    }
  });
}
export function inventoryFormSchema(
  reserved: number,
  messages: Record<keyof InventoryDraft, string>,
  integer: (raw: string, min: number, max: number) => number | null
) {
  return custom<InventoryDraft>().check((ctx) => {
    const issue = (field: keyof InventoryDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    if (!ctx.value.stockTracking && reserved > 0) issue('stockTracking');
    if (integer(ctx.value.stockCount, reserved, 1_000_000) === null) issue('stockCount');
    if (integer(ctx.value.reservationMinutes, 5, 10080) === null) issue('reservationMinutes');
  });
}
export function productFormSchema(
  context: { type: ProductType; isNew: boolean; categories: string[]; hardwareIds: string[] },
  messages: Record<keyof Draft, string>,
  integer: (raw: string) => string | null
) {
  return custom<Draft>().check((ctx) => {
    const issue = (field: keyof Draft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    for (const field of ['titleFa', 'titleEn'] as const)
      if (!ctx.value[field].trim() || ctx.value[field].trim().length > 300) issue(field);
    for (const field of ['descriptionFa', 'descriptionEn'] as const)
      if (ctx.value[field].length > 4000) issue(field);
    if (context.isNew && ctx.value.price.trim() && integer(ctx.value.price) === null)
      issue('price');
    if (
      ctx.value.categories.length > 10 ||
      new Set(ctx.value.categories).size !== ctx.value.categories.length ||
      ctx.value.categories.some((value) => !context.categories.includes(value))
    )
      issue('categories');
    if (
      context.type === 'saving_plan' &&
      (!ctx.value.hardwareIds.length ||
        ctx.value.hardwareIds.length > 100 ||
        new Set(ctx.value.hardwareIds).size !== ctx.value.hardwareIds.length ||
        ctx.value.hardwareIds.some((value) => !context.hardwareIds.includes(value)))
    )
      issue('hardwareIds');
    if (context.type === 'electricity' && ctx.value.configureLimits) {
      const min = integer(ctx.value.minKwh),
        max = integer(ctx.value.maxKwh);
      if (min === null) issue('minKwh');
      if (max === null) issue('maxKwh');
      if (
        min !== null &&
        max !== null &&
        ((BigInt(min) === 0n && BigInt(max) === 0n) ||
          (BigInt(max) > 0n && BigInt(min) > BigInt(max)))
      ) {
        issue('minKwh');
        issue('maxKwh');
      }
    }
  });
}
export function priceFormSchema(
  messages: Record<keyof PriceDraft, string>,
  integer: (raw: string) => string | null,
  resolve: (draft: PriceDraft) => string | null
) {
  return custom<PriceDraft>().check((ctx) => {
    const issue = (field: keyof PriceDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    if (integer(ctx.value.price) === null) issue('price');
    if (ctx.value.scheduled) {
      if (!ctx.value.date || !Number.isFinite(ctx.value.date.getTime())) issue('date');
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(ctx.value.time)) issue('time');
      else if (ctx.value.date && !resolve(ctx.value)) issue('date');
    }
  });
}

export function greenSettingsSchema(
  messages: Record<keyof GreenDraft, string>,
  integer: (raw: string, min: number, max: number) => number | null,
  safety: GreenSafety | null
) {
  return custom<GreenDraft>().check((ctx) => {
    const issue = (field: keyof GreenDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: [field],
        message: messages[field],
      });
    for (const prefix of ['simple', 'advanced'] as const) {
      if (integer(ctx.value[`${prefix}Threshold`], 0, Number.MAX_SAFE_INTEGER) === null)
        issue(`${prefix}Threshold`);
      const share = ctx.value[`${prefix}Share`];
      if (!Number.isFinite(share) || share < 0 || share > 100) issue(`${prefix}Share`);
      const mode = prefix === 'simple' ? 'simpleOrder' : 'advancedOrder';
      if (ctx.value[`${prefix}Enabled`] && share > 0 && safety?.[mode].reasons.length)
        issue(`${prefix}Enabled`);
    }
  });
}
export function retentionSettingsSchema(
  messages: Record<keyof RetentionDraft, string>,
  integer: (raw: string, min: number, max: number) => number | null
) {
  return custom<RetentionDraft>().check((ctx) => {
    if (integer(ctx.value.days, 1, 365) === null)
      ctx.issues.push({ code: 'custom', input: ctx.value, path: ['days'], message: messages.days });
  });
}
export function templateSettingsSchema(
  messages: Record<keyof TemplateDraft, string>,
  options: TemplateSetting['options']
) {
  return custom<TemplateDraft>().check((ctx) => {
    if (
      ctx.value.versionId !== null &&
      !options.some(
        (option) => option.id === ctx.value.versionId && option.active && option.supported
      )
    )
      ctx.issues.push({
        code: 'custom',
        input: ctx.value,
        path: ['versionId'],
        message: messages.versionId,
      });
  });
}

export function serviceSettingsSchema(
  fields: readonly ServiceField[],
  messages: Record<keyof ServiceDraft, string>,
  integer: (raw: string, min: number, max: number) => number | null
) {
  return custom<ServiceDraft>().check((ctx) => {
    for (const field of fields) {
      if (ctx.value[field.enabled] && integer(ctx.value[field.hours], 1, 8760) === null)
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          path: [field.hours],
          message: messages[field.hours],
        });
    }
  });
}
