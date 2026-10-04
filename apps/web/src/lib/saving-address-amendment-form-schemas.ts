import { z } from 'zod/mini';
import { savingAddressUuid, type SavingAddressDraft } from './saving-address-amendment-form.js';
export const inactiveSavingAddressSchema = z.custom<SavingAddressDraft>();
export function savingAddressSchema(
  previousId: string,
  offeredIds: string[],
  messages: Record<keyof SavingAddressDraft, string>
) {
  return z.custom<SavingAddressDraft>().check((ctx) => {
    const values = ctx.value;
    const invalid = (name: keyof SavingAddressDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[name],
        path: [name],
        message: messages[name],
      });
    if (
      !savingAddressUuid(values?.addressId) ||
      values.addressId === previousId ||
      !offeredIds.includes(values.addressId)
    )
      invalid('addressId');
    if (
      typeof values?.reason !== 'string' ||
      !values.reason.trim() ||
      values.reason.trim().length > 1000
    )
      invalid('reason');
  });
}
