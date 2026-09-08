import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/crm';
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation';
import { useLocale } from '../hooks/useLocale.js';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { GeographyLoadError } from './GeographyLoadError.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import type { LegalInfo } from '../pages/CrmProfileDetail.js';

const specs = {
  registrationNumber: [50, 'text', false],
  companyTypeId: [100, 'select', false],
  registrationDate: [10, 'date', true],
  economicCode: [50, 'text', true],
  officialPhone: [30, 'tel', true],
  officialEmail: [254, 'email', true],
  officialProvinceId: [36, 'select', false],
  officialCityId: [36, 'select', false],
  officialFullAddress: [500, 'textarea', false],
  officialPostalCode: [10, 'postal', false],
  representativeHonorific: [50, 'text', true],
  representativeFirstName: [100, 'text', false],
  representativeLastName: [100, 'text', false],
  representativeNationalId: [10, 'national', false],
  representativeTitle: [100, 'text', false],
  representativeRelationship: [100, 'text', false],
  representativeProvinceId: [36, 'select', false],
  representativeCityId: [36, 'select', false],
  representativeFullAddress: [500, 'textarea', false],
  representativePostalCode: [10, 'postal', false],
} as const;
type Field = keyof typeof specs;
type Changes = Partial<Record<Field, string | null>>;
const fields = Object.keys(specs) as Field[];
const labelKey = (field: Field) =>
  field === 'companyTypeId' ? 'companyType' : field.replace(/(Province|City)Id$/, '$1');

export function CrmLegalEditor({
  profileId,
  legalInfo,
  onCancel,
  onSaved,
  returnFocus,
}: {
  returnFocus: RefObject<HTMLButtonElement | null>;
  profileId: string;
  legalInfo: LegalInfo;
  onCancel: () => void;
  onSaved: (legalInfo: LegalInfo, updatedAt: string) => void;
}) {
  const locale = useLocale(),
    id = useId(),
    saveButton = useRef<HTMLButtonElement>(null);
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(fields.map((key) => [key, legalInfo[key] ?? ''])) as Record<Field, string>
  );
  const [errors, setErrors] = useState<Field[]>([]);
  const [pending, setPending] = useState<Changes | null>(null);
  const provinces = useGeographyOptions('/api/geography/provinces');
  const companies = useGeographyOptions('/api/geography/company-types');
  const officialCities = useGeographyOptions(
    values.officialProvinceId
      ? '/api/geography/provinces/' + values.officialProvinceId + '/cities'
      : null,
    values.officialProvinceId || undefined
  );
  const representativeCities = useGeographyOptions(
    values.representativeProvinceId
      ? '/api/geography/provinces/' + values.representativeProvinceId + '/cities'
      : null,
    values.representativeProvinceId || undefined
  );
  const options = {
    companyTypeId: companies,
    officialProvinceId: provinces,
    officialCityId: officialCities,
    representativeProvinceId: provinces,
    representativeCityId: representativeCities,
  };
  const label = (field: Field) => t('crm.profile.field.' + labelKey(field), locale);
  function display(field: Field, value: string | null) {
    const list = options[field as keyof typeof options];
    if (!list || !value) return value || '—';
    const name =
      list.options.find((row) => row.id === value) ??
      (value === legalInfo[field]
        ? legalInfo[(labelKey(field) + 'Name') as keyof LegalInfo]
        : null);
    return name && typeof name === 'object'
      ? locale === 'fa'
        ? name.nameFa
        : name.nameEn
      : t('crm.records.unknown', locale);
  }
  function change(field: Field, value: string) {
    setValues((old) => ({
      ...old,
      [field]: value,
      ...(field === 'officialProvinceId' ? { officialCityId: '' } : {}),
      ...(field === 'representativeProvinceId' ? { representativeCityId: '' } : {}),
    }));
    setErrors((old) => old.filter((key) => key !== field));
  }
  function review(event: FormEvent) {
    event.preventDefault();
    const changes: Changes = {},
      invalid: Field[] = [];
    for (const field of fields) {
      if (values[field] === (legalInfo[field] ?? '')) continue;
      const [max, kind, nullable] = specs[field];
      const text =
        field === 'officialEmail' ? values[field].trim().toLowerCase() : values[field].trim();
      const value = nullable && !text ? null : text;
      if (value === (legalInfo[field] ?? null) || (!text && legalInfo[field] === null)) continue;
      changes[field] = value;
      const list = options[field as keyof typeof options];
      if (
        (!nullable && !text) ||
        text.length > max ||
        (text && kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) ||
        (text &&
          kind === 'date' &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(text) ||
            !Number.isFinite(Date.parse(text)) ||
            new Date(text).toISOString().slice(0, 10) !== text)) ||
        (kind === 'postal' && !validatePostalCode(text)) ||
        (kind === 'national' && !validateNationalId(text)) ||
        (list && (!list.ready || !list.options.some((row) => row.id === text)))
      )
        invalid.push(field);
    }
    setErrors(invalid);
    if (!invalid.length && Object.keys(changes).length) setPending(changes);
  }
  async function saved(value: unknown) {
    const result = value as {
      updated?: unknown;
      profile?: { id?: unknown; updatedAt?: unknown };
      legalInfo?: LegalInfo;
    } | null;
    const current = result?.legalInfo;
    if (
      !pending ||
      result?.updated !== true ||
      result.profile?.id !== profileId ||
      typeof result.profile.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(result.profile.updatedAt)) ||
      !current ||
      current.legalName !== legalInfo.legalName ||
      current.nationalIdentifier !== legalInfo.nationalIdentifier ||
      typeof current.updatedAt !== 'string' ||
      !/\.\d{6}Z$/.test(current.updatedAt) ||
      !Number.isFinite(Date.parse(current.updatedAt)) ||
      fields.some((key) => current[key] !== (key in pending ? pending[key] : legalInfo[key])) ||
      [
        'companyTypeName',
        'officialProvinceName',
        'officialCityName',
        'representativeProvinceName',
        'representativeCityName',
      ].some((key) => {
        const name = current[key as keyof LegalInfo];
        return (
          name !== null &&
          (!name ||
            typeof name !== 'object' ||
            typeof name.nameFa !== 'string' ||
            typeof name.nameEn !== 'string')
        );
      })
    )
      throw new Error('Invalid CRM legal acknowledgement');
    onSaved(current, result.profile.updatedAt);
  }
  return (
    <>
      <form
        onSubmit={review}
        noValidate
        aria-label={t('crm.legal.edit', locale)}
        className="col-span-full space-y-4 rounded border bg-card text-card-foreground p-4 [color-scheme:light] dark:[color-scheme:dark]"
      >
        <p className="text-sm text-muted-foreground">{t('crm.legal.description', locale)}</p>
        <fieldset disabled={pending !== null} className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const [max, kind] = specs[field],
              fieldId = id + '-' + field,
              invalid = errors.includes(field);
            const list = options[field as keyof typeof options];
            const name = legalInfo[(labelKey(field) + 'Name') as keyof LegalInfo];
            const currentName =
              name && typeof name === 'object'
                ? locale === 'fa'
                  ? name.nameFa
                  : name.nameEn
                : t('crm.records.unknown', locale);
            const inputProps = {
              id: fieldId,
              value: values[field],
              onChange: (
                event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
              ) => change(field, event.target.value),
              'aria-invalid': invalid,
              'aria-describedby': invalid ? fieldId + '-error' : undefined,
            };
            return (
              <div key={field} className="space-y-1 min-w-0">
                <Label htmlFor={fieldId}>{label(field)}</Label>
                {list ? (
                  <>
                    <select
                      {...inputProps}
                      disabled={!list.ready}
                      className="w-full rounded border bg-background text-foreground p-2"
                    >
                      <option value="">{label(field)}</option>
                      {values[field] === legalInfo[field] &&
                        values[field] &&
                        !list.options.some((row) => row.id === values[field]) && (
                          <option value={values[field]}>{currentName}</option>
                        )}
                      {list.options.map((row) => (
                        <option key={row.id} value={row.id}>
                          {locale === 'fa' ? row.nameFa : row.nameEn}
                        </option>
                      ))}
                    </select>
                    <GeographyLoadError
                      {...list}
                      locale={locale}
                      message={t('crm.legal.optionsError', locale)}
                      testId={'crm-legal-' + field + '-retry'}
                    />
                  </>
                ) : kind === 'textarea' ? (
                  <textarea
                    {...inputProps}
                    maxLength={max}
                    className="w-full rounded border bg-background text-foreground p-2"
                  />
                ) : (
                  <Input
                    {...inputProps}
                    maxLength={max}
                    type={kind === 'date' || kind === 'email' || kind === 'tel' ? kind : 'text'}
                  />
                )}
                {invalid && (
                  <p
                    id={fieldId + '-error'}
                    role="alert"
                    className="text-sm text-red-700 dark:text-red-300"
                  >
                    {t('crm.legal.invalid', locale).replace('{field}', label(field))}
                  </p>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button ref={saveButton} type="submit">
              {t('crm.profile.edit.save', locale)}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('crm.profile.edit.cancel', locale)}
            </Button>
          </div>
        </fieldset>
      </form>
      {pending && (
        <TeamActionDialog
          action={{
            title: t('crm.legal.confirm', locale),
            description: Object.entries(pending)
              .map(([key, value]) => {
                const field = key as Field;
                return (
                  label(field) +
                  ': ' +
                  display(field, legalInfo[field]) +
                  ' → ' +
                  display(field, value)
                );
              })
              .join(' · '),
            path: '/api/crm/profiles/' + profileId,
            method: 'PUT',
            body: { legal: { expectedUpdatedAt: legalInfo.updatedAt, changes: pending } },
            conflictMessage: t('crm.legal.conflict', locale),
          }}
          finalFocus={() => saveButton.current ?? returnFocus.current}
          onClose={() => setPending(null)}
          onSuccess={saved}
        />
      )}
    </>
  );
}
