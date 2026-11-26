import { useId, useRef, useState } from 'react';
import { z } from 'zod';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { Button, Input, Label, Textarea } from '@barghsa/ui';
import { tCrmForm as t } from '@barghsa/i18n/crm-forms';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { normalizeProfileDigits, stripDigitSeparators } from '../lib/profile-digits.js';
import { useLocale } from '../hooks/useLocale.js';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyLoadError } from './GeographyLoadError.js';
import { GeographyPicker } from './GeographyPicker.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import { RecordEditorSection, recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from './StickyRecordEditorActions.js';

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
type AddressReview = {
  current: EditableCrmAddress;
  fields: AddressFields;
  provinceName: PlaceName | null;
  cityName: PlaceName | null;
};
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
  onDenied,
  onPendingChange,
}: {
  profileId: string;
  address: EditableCrmAddress;
  onCancel: () => void;
  onSaved: (address: EditableCrmAddress, profileUpdatedAt: string) => void;
  onDenied?: () => void;
  onPendingChange?: (value: boolean) => void;
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
        if (!/^[1-9][0-9]{9}$/.test(normalizeProfileDigits(values.postalCode.trim())))
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
  const [pending, setPending] = useState<AddressReview | null>(null);
  const provinces = useGeographyOptions('/api/geography/provinces');
  const cities = useGeographyOptions(
    fields.provinceId ? '/api/geography/provinces/' + fields.provinceId + '/cities' : null,
    fields.provinceId || undefined
  );
  const provinceField = draft.bind('provinceId');
  const cityField = draft.bind('cityId');
  const postalField = draft.bind('postalCode');
  const postalCode = normalizeProfileDigits(fields.postalCode.trim());
  const disabled = pending !== null || draft.form.formState.isSubmitting;
  const changed = (Object.keys(fields) as (keyof AddressFields)[]).some((key) =>
    key === 'postalCode'
      ? postalCode !== normalizeProfileDigits(address.postalCode.trim())
      : fields[key].trim() !== address[key]
  );
  const label = (name: PlaceName | null) =>
    (locale === 'fa' ? name?.nameFa : name?.nameEn) || t('crm.records.unknown', locale);
  const review = draft.form.handleSubmit((values) => {
    if (!changed || pending) return;
    setPending({
      current: address,
      fields: {
        ...values,
        fullAddress: values.fullAddress.trim(),
        postalCode: normalizeProfileDigits(values.postalCode.trim()),
      },
      provinceName:
        provinces.options.find((option) => option.id === values.provinceId) ??
        (values.provinceId === address.provinceId ? address.provinceName : null),
      cityName:
        cities.options.find((option) => option.id === values.cityId) ??
        (values.cityId === address.cityId ? address.cityName : null),
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
      current.id !== pending.current.id ||
      current.mainAddress !== pending.current.mainAddress ||
      typeof current.updatedAt !== 'string' ||
      !/\.\d{6}Z$/.test(current.updatedAt) ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      typeof current.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(current.createdAt)) ||
      !placeName(current.provinceName) ||
      !placeName(current.cityName) ||
      (Object.keys(pending.fields) as (keyof AddressFields)[]).some(
        (key) => current[key] !== pending.fields[key]
      )
    )
      throw new Error('Invalid CRM address acknowledgement');
    onSaved(current, result.profile.updatedAt);
  }
  return (
    <>
      <form
        onSubmit={review}
        noValidate
        className={recordEditorFormSurface}
        onFocus={keepRecordFieldVisible}
        aria-label={t('crm.address.edit', locale)}
      >
        <fieldset disabled={disabled}>
          <RecordEditorSection title={t('crm.address.locationDetails', locale)}>
            <div className={recordEditorGrid}>
              <div className={recordEditorField}>
                <Label htmlFor={fieldId + '-province'}>
                  {t('crm.profile.field.province', locale)}
                </Label>
                <GeographyPicker
                  kind="province"
                  locale={locale}
                  id={fieldId + '-province'}
                  inputRef={provinceField.ref}
                  onBlur={provinceField.onBlur}
                  aria-invalid={provinceField['aria-invalid']}
                  aria-describedby={provinceField['aria-describedby']}
                  options={provinces.options}
                  selected={fields.provinceId}
                  savedLabel={
                    fields.provinceId === address.provinceId
                      ? label(address.provinceName)
                      : undefined
                  }
                  loading={provinces.loading}
                  disabled={disabled || !provinces.ready}
                  onChange={(id) => {
                    if (id === fields.provinceId) return;
                    draft.field('provinceId')[1](id);
                    draft.field('cityId')[1]('');
                  }}
                />
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
              <div className={recordEditorField}>
                <Label htmlFor={fieldId + '-city'}>{t('crm.profile.field.city', locale)}</Label>
                <GeographyPicker
                  key={fields.provinceId}
                  kind="city"
                  locale={locale}
                  id={fieldId + '-city'}
                  inputRef={cityField.ref}
                  onBlur={cityField.onBlur}
                  aria-invalid={cityField['aria-invalid']}
                  aria-describedby={cityField['aria-describedby']}
                  options={cities.options}
                  selected={fields.cityId}
                  hasProvince={!!fields.provinceId}
                  savedLabel={
                    fields.provinceId === address.provinceId && fields.cityId === address.cityId
                      ? label(address.cityName)
                      : undefined
                  }
                  loading={cities.loading}
                  disabled={disabled || !cities.ready}
                  onChange={draft.field('cityId')[1]}
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
          </RecordEditorSection>
          <RecordEditorSection title={t('crm.address.postalDetails', locale)}>
            <div className={recordEditorField}>
              <Label htmlFor={fieldId + '-full'}>{t('crm.address.fullAddress', locale)}</Label>
              <Textarea
                {...draft.bind('fullAddress')}
                id={fieldId + '-full'}
                required
                aria-required="true"
                maxLength={500}
                dir="auto"
                rows={2}
                placeholder={t('crm.address.fullExample', locale)}
                value={fields.fullAddress}
                onChange={(event) => draft.field('fullAddress')[1](event.target.value)}
                className="max-h-48 min-h-14 resize-y placeholder-shown:[direction:inherit]"
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
            <div className={recordEditorField}>
              <Label htmlFor={fieldId + '-postal'}>
                {t('crm.profile.field.postalCode', locale)}
              </Label>
              <Input
                {...postalField}
                id={fieldId + '-postal'}
                required
                aria-required="true"
                aria-describedby={[fieldId + '-postal-help', postalField['aria-describedby']]
                  .filter(Boolean)
                  .join(' ')}
                inputMode="numeric"
                className="max-w-xs"
                dir="ltr"
                value={fields.postalCode}
                onChange={(event) =>
                  draft.field('postalCode')[1](stripDigitSeparators(event.target.value))
                }
              />
              <p id={fieldId + '-postal-help'} className="text-xs text-muted-foreground">
                {tSettingsForms('postalCodeHelp', locale)}
              </p>
              {errors.postalCode && (
                <p
                  id={draft.errorId('postalCode')}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {errors.postalCode.message}
                </p>
              )}
            </div>
          </RecordEditorSection>
          <StickyRecordEditorActions>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('crm.profile.edit.cancel', locale)}
            </Button>
            <Button ref={saveButton} type="submit" disabled={!changed}>
              {t('crm.profile.edit.save', locale)}
            </Button>
          </StickyRecordEditorActions>
        </fieldset>
      </form>
      <Button
        type="button"
        variant="link"
        disabled={pending !== null || draft.form.formState.isSubmitting}
        className="min-h-11 px-1 text-start text-xs text-muted-foreground"
        onClick={() => window.location.reload()}
      >
        {t('crm.address.reload', locale)}
      </Button>
      {pending && (
        <TeamActionDialog
          focusSummary
          action={{
            title: t('crm.address.confirm', locale),
            description: t('crm.address.reviewHelp', locale),
            path: '/api/crm/profiles/' + profileId,
            method: 'PUT',
            body: {
              address: {
                id: pending.current.id,
                expectedUpdatedAt: pending.current.updatedAt,
                ...pending.fields,
              },
            },
            forbiddenMessage: t('crm.profile.error.accessDenied', locale),
            conflictMessage: t('crm.profile.conflict', locale),
          }}
          summary={
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: 'currentAddress', value: pending.current },
                {
                  key: 'updatedAddress',
                  value: {
                    ...pending.fields,
                    provinceName: pending.provinceName,
                    cityName: pending.cityName,
                  },
                },
              ].map(({ key, value }) => {
                const heading = t(`crm.address.${key}`, locale);
                return (
                  <section
                    key={key}
                    aria-label={heading}
                    className={`min-w-0 space-y-2 rounded-lg border p-3 [overflow-wrap:anywhere] ${key === 'updatedAddress' ? 'border-primary/25 bg-primary/5' : 'bg-muted/25'}`}
                  >
                    <h3 className="text-sm font-semibold">{heading}</h3>
                    <p dir="auto" className="whitespace-pre-wrap text-sm">
                      {value.fullAddress}
                    </p>
                    <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-3 border-t pt-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">
                          {t('crm.address.locationDetails', locale)}
                        </dt>
                        <dd>
                          <bdi>{label(value.provinceName)}</bdi>
                          {' · '}
                          <bdi>{label(value.cityName)}</bdi>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          {t('crm.profile.field.postalCode', locale)}
                        </dt>
                        <dd>
                          <bdi dir="ltr">{value.postalCode}</bdi>
                        </dd>
                      </div>
                    </dl>
                  </section>
                );
              })}
            </div>
          }
          onClose={() => setPending(null)}
          onSuccess={saved}
          onValidationError={onValidationError}
          finalFocus={saveButton}
          {...(onDenied ? { onDenied } : {})}
          {...(onPendingChange ? { onPendingChange } : {})}
        />
      )}
    </>
  );
}
