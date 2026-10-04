import { z } from 'zod/mini';
import { savingHardwareUuid, type SavingHardwareDraft } from './saving-hardware-form.js';
export const inactiveSavingHardwareSchema = z.custom<SavingHardwareDraft>();
export function savingHardwareSchema(
  previousId: string,
  offeredIds: string[],
  cancellation: boolean,
  messages: Record<keyof SavingHardwareDraft, string>
) {
  return z.custom<SavingHardwareDraft>().check((ctx) => {
    const values = ctx.value;
    const invalid = (name: keyof SavingHardwareDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[name],
        path: [name],
        message: messages[name],
      });
    if (
      !cancellation &&
      (!savingHardwareUuid(values?.hardwareProductId) ||
        values.hardwareProductId === previousId ||
        !offeredIds.includes(values.hardwareProductId))
    )
      invalid('hardwareProductId');
    if (
      typeof values?.reason !== 'string' ||
      !values.reason.trim() ||
      values.reason.trim().length > 1000
    )
      invalid('reason');
  });
}
