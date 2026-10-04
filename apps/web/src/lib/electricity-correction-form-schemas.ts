import { z } from 'zod/mini';
import { validatePostalCode } from '@barghsa/shared/validation';
import { parseJalaliDateTime } from './jalali-date-time.js';
import type {
  ElectricityAddressDraft,
  ElectricityRevisionDraft,
} from './electricity-correction-form.js';

export const inactiveElectricityCorrectionSchema = z.custom<ElectricityAddressDraft>();
export function electricityAddressSchema(messages: Record<keyof ElectricityAddressDraft, string>) {
  return z.custom<ElectricityAddressDraft>().check((ctx) => {
    const add = (name: keyof ElectricityAddressDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.[name],
        path: [name],
        message: messages[name],
      });
    const value = ctx.value;
    if (
      typeof value?.fullAddress !== 'string' ||
      !value.fullAddress.trim() ||
      value.fullAddress.trim().length > 500
    )
      add('fullAddress');
    if (typeof value?.postalCode !== 'string' || !validatePostalCode(value.postalCode.trim()))
      add('postalCode');
    if (
      typeof value?.responseNote !== 'string' ||
      !value.responseNote.trim() ||
      value.responseNote.trim().length > 1000
    )
      add('responseNote');
  });
}
export function electricityRevisionSchema(
  messages: Record<keyof ElectricityRevisionDraft, string>,
  options: { advanced: boolean; mandatoryGreen: boolean; periods: string[]; locationValid: boolean }
) {
  return z.custom<ElectricityRevisionDraft>().check((ctx) => {
    const add = (name: keyof ElectricityRevisionDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.[name],
        path: [name],
        message: messages[name],
      });
    const value = ctx.value;
    const address = electricityAddressSchema(messages).safeParse(value);
    if (!address.success)
      for (const issue of address.error.issues)
        ctx.issues.push({
          code: 'custom',
          input: issue.input,
          path: issue.path,
          message: issue.message,
        });
    if (typeof value?.giftCode !== 'string' || value.giftCode.trim().length > 100) add('giftCode');
    if (!value?.provinceId || !options.locationValid) add('provinceId');
    if (!value?.cityId || !options.locationValid) add('cityId');
    if (!options.advanced) {
      if (!options.periods.includes(value?.period)) add('period');
      if (typeof value?.totalKwh !== 'string' || !/^[1-9]\d{0,18}$/.test(value.totalKwh.trim()))
        add('totalKwh');
      return;
    }
    const start = parseJalaliDateTime(value?.startAt ?? '');
    const end = parseJalaliDateTime(value?.endAt ?? '');
    if (!start) add('startAt');
    if (!end || (start && Date.parse(end) <= Date.parse(start))) add('endAt');
    const fields = ['thermal', 'green', 'freeMarket', 'energySaving'] as const;
    const active = fields.filter((name) => name !== 'green' || !options.mandatoryGreen);
    for (const name of active)
      if (typeof value?.[name] !== 'string' || !/^\d{1,19}$/.test(value[name].trim() || '0'))
        add(name);
    if (
      !active.some(
        (name) => /^\d{1,19}$/.test(value?.[name]?.trim() ?? '') && BigInt(value[name].trim()) > 0n
      )
    )
      add('thermal');
  });
}
