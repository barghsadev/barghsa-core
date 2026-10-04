import { z } from 'zod/mini';
import {
  validIncreaseQuantity,
  type ElectricityIncreaseDraft,
} from './electricity-increase-form.js';

export const inactiveIncreaseSchema = z.custom<ElectricityIncreaseDraft>();
export function electricityIncreaseSchema(
  messages: { format: string; range: string },
  original: string,
  maximum: string
) {
  return z.custom<ElectricityIncreaseDraft>().check((ctx) => {
    const raw = ctx.value?.requestedKwh;
    if (typeof raw !== 'string' || !/^[1-9]\d{0,18}$/.test(raw.trim()))
      ctx.issues.push({
        code: 'custom',
        path: ['requestedKwh'],
        input: raw,
        message: messages.format,
      });
    else if (!validIncreaseQuantity(raw, original, maximum))
      ctx.issues.push({
        code: 'custom',
        path: ['requestedKwh'],
        input: raw,
        message: messages.range,
      });
  });
}
