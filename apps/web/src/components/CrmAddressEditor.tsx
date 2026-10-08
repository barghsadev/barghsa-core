import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { Button, Input, Label, DependentSelect } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-crm';
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
  const saveButton = useRef<HTMLButtonElement>(null);
  const messages = {
    provinceId: t('crm.address.locationInvalid', locale),
    cityId: t('crm.address.locationInvalid', locale),
    fullAddress: t('crm.address.fullInvalid', locale),
    postalCode: t('crm.address.postalInvalid', locale),
  };
  const draft = useDraftForm<AddressFields>(
    z
      .object({
        provinceId: z.string(),
        cityId: z.string(),
        fullAddress: z.string(),
        postalCode: z.string(),
      })
      .superRefine((values, context) => {
        const unchanged =
          values.provinceId === address.provinceId && values.cityId === address.cityId;
        if (!unchanged) {
          if (!provinces.ready || !provinces.options.some((p) => p.id === values.provinceId))
            context.addIssue({
              code: 'custom',
              path: ['provinceId'],
              message: messages.provinceId,
            });
          if (!cities.ready || !cities.options.some((c) => c.id === values.cityId))
            context.addIssue({ code: 'custom', path: ['cityId'], message: messages.cityId });
        }
        if (!values.fullAddress.trim() || values.fullAddress.trim().length > 500)
          context.addIssue({
            code: 'custom',
            path: ['fullAddress'],
            message: messages.fullAddress,
          });
        if (!/^[1-9][0-9]{9}$/.test(values.postalCode.trim()))
          context.addIssue({ code: 'custom', path: ['postalCode'], message: messages.postalCode });
      }),
    {
      provinceId: address.provinceId,
      cityId: address.cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    }
  );
  const fields = draft.values;
  const errors = draft.errors;
  const onValidationError = useActionFieldErrors(
    draft.form,
    messages,
    t('crm.profile.error.generic', locale)
  );
  const [pending, setPending] = useState<AddressFields | null>(null);
  const provinces = useGeographyOptions('/api/geography/provinces');
  const cities = useGeographyOptions(
    fields.provinceId ? '/api/geography/provinces/' + fields.provinceId + '/cities' : null,
    fields.provinceId || undefined
  );
  const changed = (Object.keys(fields) as (keyof AddressFields)[]).some(
    (key) => fields[key].trim() !== address[key]
  );
  const label = (name: PlaceName | null) =>
    (locale === 'fa' ? name?.nameFa : name?.nameEn) || t('crm.records.unknown', locale);
  const review = draft.form.handleSubmit((values) => {
    if (!changed || pending) return;
    setPending({
      ...values,
      fullAddress: values.fullAddress.trim(),
      postalCode: values.postalCode.trim(),
    });
  });
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
        <fieldset
          disabled={pending !== null || draft.form.formState.isSubmitting}
          className="space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={fieldId + '-province'}>
                {t('crm.profile.field.province', locale)}
              </Label>
              <select
                {...draft.bind('provinceId')}
                id={fieldId + '-province'}
                value={fields.provinceId}
                disabled={!provinces.ready}
                onChange={(event) => {
                  draft.field('provinceId')[1](event.target.value);
                  draft.field('cityId')[1]('');
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
              {errors.provinceId && (
                <p
                  id={draft.errorId('provinceId')}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {errors.provinceId.message}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={fieldId + '-city'}>{t('crm.profile.field.city', locale)}</Label>
              <DependentSelect
                {...draft.bind('cityId')}
                id={fieldId + '-city'}
                dependencyValue={fields.provinceId}
                value={fields.cityId}
                ready={cities.ready}
                loading={cities.loading}
                placeholder={t('crm.address.chooseCity', locale)}
                options={cities.options.map((city) => ({
                  value: city.id,
                  label: label(city),
                  dependencyValue: city.provinceId ?? '',
                }))}
                savedOption={{
                  value: address.cityId,
                  label: label(address.cityName),
                  dependencyValue: address.provinceId,
                }}
                onChange={(event) => draft.field('cityId')[1](event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
              <GeographyLoadError
                {...cities}
                message={t('crm.address.cityError', locale)}
                locale={locale}
                testId="crm-address-city-retry"
              />
              {errors.cityId && (
                <p id={draft.errorId('cityId')} role="alert" className="text-sm text-destructive">
                  {errors.cityId.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={fieldId + '-full'}>{t('crm.address.fullAddress', locale)}</Label>
            <textarea
              {...draft.bind('fullAddress')}
              id={fieldId + '-full'}
              required
              maxLength={500}
              rows={3}
              value={fields.fullAddress}
              onChange={(event) => draft.field('fullAddress')[1](event.target.value)}
              className="w-full rounded-md border border-input bg-background p-3 text-sm"
            />
            {errors.fullAddress && (
              <p
                id={draft.errorId('fullAddress')}
                role="alert"
                className="text-sm text-destructive"
              >
                {errors.fullAddress.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={fieldId + '-postal'}>{t('crm.profile.field.postalCode', locale)}</Label>
            <Input
              {...draft.bind('postalCode')}
              id={fieldId + '-postal'}
              required
              inputMode="numeric"
              maxLength={10}
              dir="ltr"
              value={fields.postalCode}
              onChange={(event) => draft.field('postalCode')[1](event.target.value)}
            />
            {errors.postalCode && (
              <p id={draft.errorId('postalCode')} role="alert" className="text-sm text-destructive">
                {errors.postalCode.message}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button ref={saveButton} type="submit" disabled={!changed}>
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
          onValidationError={onValidationError}
          finalFocus={saveButton}
        />
      )}
    </>
  );
}
