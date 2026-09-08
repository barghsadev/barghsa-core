import { useId, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { useLocale } from '../hooks/useLocale.js';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyLoadError } from './GeographyLoadError.js';
import { TeamActionDialog } from './TeamActionDialog.js';

type PlaceName = { nameFa: string; nameEn: string };
export interface EditableCrmAddress {
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  provinceName: PlaceName | null;
  cityName: PlaceName | null;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}
type AddressFields = Pick<
  EditableCrmAddress,
  'provinceId' | 'cityId' | 'fullAddress' | 'postalCode'
>;
function placeName(value: unknown): value is PlaceName {
  if (!value || typeof value !== 'object') return false;
  const name = value as Partial<PlaceName>;
  return typeof name.nameFa === 'string' && typeof name.nameEn === 'string';
}

export function CrmAddressEditor({
  profileId,
  address,
  onCancel,
  onSaved,
}: {
  profileId: string;
  address: EditableCrmAddress;
  onCancel: () => void;
  onSaved: (address: EditableCrmAddress, profileUpdatedAt: string) => void;
}) {
  const locale = useLocale();
  const fieldId = useId();
  const [fields, setFields] = useState<AddressFields>({
    provinceId: address.provinceId,
    cityId: address.cityId,
    fullAddress: address.fullAddress,
    postalCode: address.postalCode,
  });
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<AddressFields | null>(null);
  const provinces = useGeographyOptions('/api/geography/provinces');
  const cities = useGeographyOptions(
    fields.provinceId ? '/api/geography/provinces/' + fields.provinceId + '/cities' : null,
    fields.provinceId || undefined
  );
  const unchangedLocation =
    fields.provinceId === address.provinceId && fields.cityId === address.cityId;
  const errors = {
    location:
      !unchangedLocation &&
      (!provinces.ready ||
        !cities.ready ||
        !provinces.options.some((p) => p.id === fields.provinceId) ||
        !cities.options.some((c) => c.id === fields.cityId)),
    fullAddress: !fields.fullAddress.trim() || fields.fullAddress.trim().length > 500,
    postalCode: !/^[1-9][0-9]{9}$/.test(fields.postalCode.trim()),
  };
  const changed = (Object.keys(fields) as (keyof AddressFields)[]).some(
    (key) => fields[key].trim() !== address[key]
  );
  const label = (name: PlaceName | null) =>
    (locale === 'fa' ? name?.nameFa : name?.nameEn) || t('crm.records.unknown', locale);
  function review(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!changed || Object.values(errors).some(Boolean)) return;
    setPending({
      ...fields,
      fullAddress: fields.fullAddress.trim(),
      postalCode: fields.postalCode.trim(),
    });
  }
  async function saved(value: unknown) {
    const result = value as {
      updated?: unknown;
      profile?: { id?: unknown; updatedAt?: unknown };
      address?: EditableCrmAddress;
    } | null;
    const current = result?.address;
    if (
      !pending ||
      !result ||
      result.updated !== true ||
      result.profile?.id !== profileId ||
      typeof result.profile.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(result.profile.updatedAt)) ||
      !current ||
      current.id !== address.id ||
      current.mainAddress !== address.mainAddress ||
      typeof current.updatedAt !== 'string' ||
      !/\.\d{6}Z$/.test(current.updatedAt) ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      typeof current.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(current.createdAt)) ||
      !placeName(current.provinceName) ||
      !placeName(current.cityName) ||
      (Object.keys(pending) as (keyof AddressFields)[]).some((key) => current[key] !== pending[key])
    )
      throw new Error('Invalid CRM address acknowledgement');
    onSaved(current, result.profile.updatedAt);
  }
  return (
    <>
      <form
        onSubmit={review}
        noValidate
        className="space-y-4"
        aria-label={t('crm.address.edit', locale)}
      >
        <fieldset disabled={pending !== null} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={fieldId + '-province'}>
                {t('crm.profile.field.province', locale)}
              </Label>
              <select
                id={fieldId + '-province'}
                value={fields.provinceId}
                disabled={!provinces.ready}
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    provinceId: event.target.value,
                    cityId: '',
                  }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                aria-invalid={attempted && errors.location}
                aria-describedby={
                  attempted && errors.location ? fieldId + '-location-error' : undefined
                }
              >
                <option value="">{t('crm.address.chooseProvince', locale)}</option>
                {!provinces.options.some((p) => p.id === address.provinceId) && (
                  <option value={address.provinceId}>{label(address.provinceName)}</option>
                )}
                {provinces.options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {label(p)}
                  </option>
                ))}
              </select>
              <GeographyLoadError
                {...provinces}
                message={t('crm.address.provinceError', locale)}
                locale={locale}
                testId="crm-address-province-retry"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId + '-city'}>{t('crm.profile.field.city', locale)}</Label>
              <select
                id={fieldId + '-city'}
                value={fields.cityId}
                disabled={!cities.ready}
                onChange={(event) =>
                  setFields((current) => ({ ...current, cityId: event.target.value }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                aria-invalid={attempted && errors.location}
                aria-describedby={
                  attempted && errors.location ? fieldId + '-location-error' : undefined
                }
              >
                <option value="">{t('crm.address.chooseCity', locale)}</option>
                {fields.provinceId === address.provinceId &&
                  !cities.options.some((c) => c.id === address.cityId) && (
                    <option value={address.cityId}>{label(address.cityName)}</option>
                  )}
                {cities.options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c)}
                  </option>
                ))}
              </select>
              <GeographyLoadError
                {...cities}
                message={t('crm.address.cityError', locale)}
                locale={locale}
                testId="crm-address-city-retry"
              />
            </div>
          </div>
          {attempted && errors.location && (
            <p id={fieldId + '-location-error'} role="alert" className="text-sm text-destructive">
              {t('crm.address.locationInvalid', locale)}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor={fieldId + '-full'}>{t('crm.address.fullAddress', locale)}</Label>
            <textarea
              id={fieldId + '-full'}
              required
              maxLength={500}
              rows={3}
              value={fields.fullAddress}
              onChange={(event) =>
                setFields((current) => ({ ...current, fullAddress: event.target.value }))
              }
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
              aria-invalid={attempted && errors.fullAddress}
              aria-describedby={
                attempted && errors.fullAddress ? fieldId + '-full-error' : undefined
              }
            />
            {attempted && errors.fullAddress && (
              <p id={fieldId + '-full-error'} role="alert" className="text-sm text-destructive">
                {t('crm.address.fullInvalid', locale)}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={fieldId + '-postal'}>{t('crm.profile.field.postalCode', locale)}</Label>
            <Input
              id={fieldId + '-postal'}
              required
              inputMode="numeric"
              maxLength={10}
              dir="ltr"
              value={fields.postalCode}
              onChange={(event) =>
                setFields((current) => ({ ...current, postalCode: event.target.value }))
              }
              aria-invalid={attempted && errors.postalCode}
              aria-describedby={
                attempted && errors.postalCode ? fieldId + '-postal-error' : undefined
              }
            />
            {attempted && errors.postalCode && (
              <p id={fieldId + '-postal-error'} role="alert" className="text-sm text-destructive">
                {t('crm.address.postalInvalid', locale)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!changed}>
              {t('crm.profile.edit.save', locale)}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('crm.profile.edit.cancel', locale)}
            </Button>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              {t('crm.address.reload', locale)}
            </Button>
          </div>
        </fieldset>
      </form>
      {pending && (
        <TeamActionDialog
          action={{
            title: t('crm.address.confirm', locale),
            description: [
              profileId,
              address.fullAddress,
              '→',
              pending.fullAddress,
              pending.postalCode,
              label(
                provinces.options.find((p) => p.id === pending.provinceId) ?? address.provinceName
              ),
              label(cities.options.find((c) => c.id === pending.cityId) ?? address.cityName),
            ].join(' · '),
            path: '/api/crm/profiles/' + profileId,
            method: 'PUT',
            body: { address: { id: address.id, expectedUpdatedAt: address.updatedAt, ...pending } },
            forbiddenMessage: t('crm.profile.error.accessDenied', locale),
            conflictMessage: t('crm.profile.conflict', locale),
          }}
          onClose={() => setPending(null)}
          onSuccess={saved}
        />
      )}
    </>
  );
}
