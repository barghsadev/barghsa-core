import { z } from 'zod/mini';
import {
  validateNationalId,
  validateLegalNationalIdentifier,
  validatePostalCode,
} from '@barghsa/shared/validation';
import type {
  ProfileFormValues,
  AddressFormValues,
  SettingsProfile,
  SavedAddress,
  SettingsPatch,
} from './settings-form.js';
type Copy = (key: string) => string;
const issue = (path: string, message: string, input: unknown) => ({
  code: 'custom' as const,
  path: [path],
  message,
  input,
});
const uuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fields = ['provinceId', 'cityId', 'fullAddress', 'postalCode'] as const;
const strings = (v: unknown, keys: readonly string[]): v is Record<string, string> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  keys.every((key) => typeof (v as Record<string, unknown>)[key] === 'string');
function addressIssues(
  raw: AddressFormValues,
  add: (field: string, value: unknown) => void,
  province: (id: string) => boolean,
  city: (id: string, province: string) => boolean
) {
  if (!uuid(raw.provinceId.trim()) || !province(raw.provinceId.trim()))
    add('provinceId', raw.provinceId);
  if (!uuid(raw.cityId.trim()) || !city(raw.cityId.trim(), raw.provinceId.trim()))
    add('cityId', raw.cityId);
  if (!raw.fullAddress.trim() || raw.fullAddress.trim().length > 500)
    add('fullAddress', raw.fullAddress);
  if (!validatePostalCode(raw.postalCode.trim())) add('postalCode', raw.postalCode);
}
export const settingsInactiveSchema = z.custom<never>().check((ctx) => {
  ctx.issues.push(issue('root', '', ctx.value));
});
export function profileSettingsSchema(
  copy: Copy,
  source: () => SettingsProfile | null,
  patch: (raw: ProfileFormValues, source: SettingsProfile) => SettingsPatch,
  province: (id: string) => boolean,
  city: (id: string, province: string) => boolean
) {
  return z.custom<ProfileFormValues>().check((ctx) => {
    const raw = ctx.value,
      base = source();
    const keys = [
      'title',
      'firstName',
      'lastName',
      'nationalId',
      'legalName',
      'nationalIdentifier',
      ...fields,
    ];
    if (!strings(raw, keys) || !base) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), raw));
      return;
    }
    const changed = patch(raw, base);
    const add = (field: string, value: unknown) =>
      ctx.issues.push(issue(field, copy(field + 'Invalid'), value));
    if (changed.title !== undefined && changed.title.length > 50) add('title', raw.title);
    for (const key of ['firstName', 'lastName'] as const)
      if (changed[key] !== undefined && (!changed[key] || changed[key].length > 100))
        add(key, raw[key]);
    if (changed.nationalId !== undefined && !validateNationalId(changed.nationalId))
      add('nationalId', raw.nationalId);
    if (changed.legalName !== undefined && (!changed.legalName || changed.legalName.length > 200))
      add('legalName', raw.legalName);
    if (
      changed.nationalIdentifier !== undefined &&
      !validateLegalNationalIdentifier(changed.nationalIdentifier)
    )
      add('nationalIdentifier', raw.nationalIdentifier);
    if (fields.some((key) => changed[key] !== undefined)) addressIssues(raw, add, province, city);
  });
}
export function savedAddressSchema(
  copy: Copy,
  source: () => SavedAddress | null,
  province: (id: string) => boolean,
  city: (id: string, province: string) => boolean
) {
  return z.custom<AddressFormValues>().check((ctx) => {
    const raw = ctx.value;
    if (!strings(raw, fields)) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), raw));
      return;
    }
    const base = source(),
      unchangedPair = !!base && raw.provinceId === base.provinceId && raw.cityId === base.cityId;
    const add = (field: string, value: unknown) =>
      ctx.issues.push(issue(field, copy(field + 'Invalid'), value));
    addressIssues(
      raw,
      add,
      (id) => unchangedPair || province(id),
      (id, parent) => unchangedPair || city(id, parent)
    );
  });
}
