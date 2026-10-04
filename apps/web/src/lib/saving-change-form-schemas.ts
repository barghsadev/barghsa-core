import { z } from 'zod/mini';
import {
  availableSavingHardware,
  type SavingChangeDraft,
  type SavingChangeHardware,
  type SavingChangeAddress,
} from './saving-change-form.js';
export const inactiveSavingChangeSchema = z.custom<SavingChangeDraft>();
export function savingChangeSchema(
  hardware: SavingChangeHardware[],
  addresses: SavingChangeAddress[],
  current: SavingChangeDraft,
  messages: { hardwareProductId: string; installationAddressId: string; unchanged: string }
) {
  return z.custom<SavingChangeDraft>().check((ctx) => {
    const values = ctx.value;
    const invalid = (name: keyof SavingChangeDraft, message: string) =>
      ctx.issues.push({ code: 'custom', input: values?.[name], path: [name], message });
    const product = hardware.find((item) => item.id === values?.hardwareProductId);
    if (!product || !availableSavingHardware(product, current.hardwareProductId))
      invalid('hardwareProductId', messages.hardwareProductId);
    if (!addresses.some((item) => item.id === values?.installationAddressId))
      invalid('installationAddressId', messages.installationAddressId);
    if (
      values?.hardwareProductId === current.hardwareProductId &&
      values?.installationAddressId === current.installationAddressId
    )
      invalid('hardwareProductId', messages.unchanged);
  });
}
