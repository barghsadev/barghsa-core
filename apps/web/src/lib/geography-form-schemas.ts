import { z } from 'zod/mini';
import { parseCityRows, validGeographyName, type GeographyDraft } from './geography-form-values.js';

export function geographySchema(messages: Record<keyof GeographyDraft | 'nameLength', string>) {
  return z.custom<GeographyDraft>().check((ctx) => {
    const value = ctx.value;
    for (const field of ['nameFa', 'nameEn'] as const) {
      if (!validGeographyName(value[field], field))
        ctx.issues.push({
          code: 'custom',
          input: value[field],
          path: [field],
          message: value[field].trim().length > 100 ? messages.nameLength : messages[field],
        });
    }
    if (!['active', 'inactive'].includes(value.status))
      ctx.issues.push({
        code: 'custom',
        input: value.status,
        path: ['status'],
        message: messages.status,
      });
  });
}

export function cityImportSchema(message: string) {
  return z.custom<{ rows: string }>().check((ctx) => {
    if (!parseCityRows(ctx.value.rows))
      ctx.issues.push({ code: 'custom', input: ctx.value.rows, path: ['rows'], message });
  });
}
