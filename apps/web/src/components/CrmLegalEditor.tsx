import { useId, useRef, useState, type RefObject } from 'react';
import { z } from 'zod';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { Button, Input, Label, NativeSelect, Textarea } from '@barghsa/ui';
import { tCrmForm as t } from '@barghsa/i18n/crm-forms';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation';
import { useLocale } from '../hooks/useLocale.js';
import { useGeographyOptions } from '../hooks/useGeographyOptions.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { GeographyLoadError } from './GeographyLoadError.js';
import { GeographyPicker } from './GeographyPicker.js';
import { TeamActionDialog } from './TeamActionDialog.js';
import type { LegalInfo } from '../pages/CrmProfileDetail.js';
import { RecordEditorSection, recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from './StickyRecordEditorActions.js';

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
const sections = [
  [
    'crm.legal.registrationDetails',
    ['registrationNumber', 'companyTypeId', 'registrationDate', 'economicCode'],
  ],
  [
    'crm.legal.companyContact',
    [
      'officialPhone',
      'officialEmail',
      'officialProvinceId',
      'officialCityId',
      'officialFullAddress',
      'officialPostalCode',
    ],
  ],
  [
    'crm.legal.representativeDetails',
    [
      'representativeHonorific',
      'representativeFirstName',
      'representativeLastName',
      'representativeNationalId',
      'representativeTitle',
      'representativeRelationship',
    ],
  ],
  [
    'crm.legal.representativeAddress',
    [
      'representativeProvinceId',
      'representativeCityId',
      'representativeFullAddress',
      'representativePostalCode',
    ],
  ],
] as const satisfies readonly (readonly [string, readonly Field[]])[];
const fields: Field[] = sections.flatMap(([, fields]) => [...fields]);
const sectionId = (heading: (typeof sections)[number][0]) =>
  heading.replace('crm.legal.', 'crm-legal-');
const labelKey = (field: Field) =>
  field === 'companyTypeId' ? 'companyType' : field.replace(/(Province|City)Id$/, '$1');

export function CrmLegalEditor({
  profileId,
  legalInfo,
  onCancel,
  onSaved,
  returnFocus,
  onDenied,
  onPendingChange,
}: {
  returnFocus: RefObject<HTMLButtonElement | null>;
  profileId: string;
  legalInfo: LegalInfo;
  onCancel: () => void;
  onSaved: (legalInfo: LegalInfo, updatedAt: string) => void;
  onDenied?: () => void;
  onPendingChange?: (value: boolean) => void;
}) {
  const locale = useLocale(),
    id = useId(),
    saveButton = useRef<HTMLButtonElement>(null);
  const label = (field: Field) => t('crm.profile.field.' + labelKey(field), locale);
  const messages = Object.fromEntries(
    fields.map((field) => [field, t('crm.legal.invalid', locale).replace('{field}', label(field))])
  ) as Record<Field, string>;
  const draft = useDraftForm<Record<Field, string>>(
    z.record(z.enum(fields), z.string()).superRefine((values, context) => {
      for (const field of inspect(values).invalid)
        context.addIssue({ code: 'custom', path: [field], message: messages[field] });
    }),
    () =>
      Object.fromEntries(fields.map((key) => [key, legalInfo[key] ?? ''])) as Record<Field, string>
  );
  const values = draft.values;
  const errors = draft.errors;
  const onValidationError = useActionFieldErrors(
    draft.form,
    messages,
    t('crm.profile.error.generic', locale)
  );
  const [pending, setPending] = useState<Changes | null>(null);
  const disabled = pending !== null || draft.form.formState.isSubmitting;
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
    if (values[field] === value) return;
    draft.field(field)[1](value);
    if (field === 'officialProvinceId') draft.field('officialCityId')[1]('');
    if (field === 'representativeProvinceId') draft.field('representativeCityId')[1]('');
  }
  function inspect(values: Record<Field, string>) {
    const changes: Changes = {},
      invalid: Field[] = [];
    for (const field of fields) {
      if (values[field] === (legalInfo[field] ?? '')) continue;
      const [max, kind, nullable] = specs[field];
      let text = values[field].trim();
      if (kind === 'national' || kind === 'postal') text = normalizeProfileDigits(text);
      if (kind === 'email') text = text.toLowerCase();
      const value = nullable && !text ? null : text;
      if (value === (legalInfo[field] ?? null) || (!text && legalInfo[field] === null)) continue;
      changes[field] = value;
      const list = options[field as keyof typeof options];
      if (
        (!nullable && !text) ||
        text.length > max ||
        (text && kind === 'email' && !z.email().safeParse(text).success) ||
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
    return { changes, invalid };
  }
  const review = draft.form.handleSubmit((values) => {
    if (pending) return;
    const { changes } = inspect(values);
    if (Object.keys(changes).length) setPending(changes);
  });
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
  function renderField(field: Field) {
    const [max, kind] = specs[field],
      fieldId = id + '-' + field,
      invalid = !!errors[field];
    const list = options[field as keyof typeof options];
    const binding = draft.bind(field);
    const help =
      kind === 'national' ? 'nationalIdHelp' : kind === 'postal' ? 'postalCodeHelp' : null;
    const currentName = display(field, legalInfo[field]);
    const inputProps = {
      ...binding,
      id: fieldId,
      value: values[field],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
      ) => change(field, event.target.value),
    };
    const dependencyField =
      field === 'officialCityId'
        ? 'officialProvinceId'
        : field === 'representativeCityId'
          ? 'representativeProvinceId'
          : null;
    return (
      <div
        key={field}
        className={kind === 'textarea' ? 'min-w-0 space-y-1 sm:col-span-2' : recordEditorField}
      >
        <Label htmlFor={fieldId}>{label(field)}</Label>
        {list ? (
          <>
            {field === 'companyTypeId' ? (
              <NativeSelect {...inputProps} disabled={!list.ready} className="w-full">
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
              </NativeSelect>
            ) : (
              <GeographyPicker
                key={dependencyField ? values[dependencyField] : field}
                kind={dependencyField ? 'city' : 'province'}
                locale={locale}
                id={fieldId}
                inputRef={binding.ref}
                onBlur={binding.onBlur}
                aria-invalid={binding['aria-invalid']}
                aria-describedby={binding['aria-describedby']}
                options={list.options}
                selected={values[field]}
                hasProvince={!dependencyField || !!values[dependencyField]}
                savedLabel={
                  values[field] &&
                  values[field] === legalInfo[field] &&
                  (!dependencyField || values[dependencyField] === legalInfo[dependencyField])
                    ? currentName
                    : undefined
                }
                loading={list.loading}
                disabled={disabled || !list.ready}
                onChange={(value) => change(field, value)}
              />
            )}
            <GeographyLoadError
              {...list}
              locale={locale}
              message={t('crm.legal.optionsError', locale)}
              testId={'crm-legal-' + field + '-retry'}
            />
          </>
        ) : kind === 'textarea' ? (
          <Textarea
            {...inputProps}
            maxLength={max}
            dir="auto"
            rows={2}
            placeholder={t('crm.address.fullExample', locale)}
            className="max-h-48 min-h-14 resize-y placeholder-shown:[direction:inherit]"
          />
        ) : (
          <Input
            {...inputProps}
            aria-describedby={
              [help && fieldId + '-help', binding['aria-describedby']].filter(Boolean).join(' ') ||
              undefined
            }
            maxLength={max}
            dir={
              kind === 'date' ||
              kind === 'email' ||
              kind === 'tel' ||
              kind === 'postal' ||
              kind === 'national'
                ? 'ltr'
                : undefined
            }
            inputMode={kind === 'postal' || kind === 'national' ? 'numeric' : undefined}
            autoComplete="off"
            type={kind === 'date' || kind === 'email' || kind === 'tel' ? kind : 'text'}
            className={help ? 'max-w-xs' : undefined}
          />
        )}
        {help && (
          <p id={fieldId + '-help'} className="text-xs text-muted-foreground">
            {tSettingsForms(help, locale)}
          </p>
        )}
        {invalid && (
          <p id={draft.errorId(field)} role="alert" className="text-sm text-destructive">
            {errors[field]?.message}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <form
        onSubmit={review}
        noValidate
        aria-label={t('crm.legal.edit', locale)}
        className={recordEditorFormSurface}
        onFocus={keepRecordFieldVisible}
      >
        <nav
          aria-label={t('crm.legal.formSections', locale)}
          className="grid grid-cols-2 gap-1.5 border-b p-3 sm:flex sm:flex-wrap sm:px-6"
        >
          {sections.map(([heading]) => (
            <a
              key={heading}
              href={`#${sectionId(heading)}`}
              className="inline-flex min-h-10 items-center rounded-md bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-offset-2"
            >
              {t(heading, locale)}
            </a>
          ))}
        </nav>
        <fieldset disabled={disabled}>
          {sections.map(([heading, sectionFields], index) => (
            <RecordEditorSection
              key={heading}
              anchorId={sectionId(heading)}
              title={t(heading, locale)}
              {...(index === 0 ? { description: t('crm.legal.description', locale) } : {})}
            >
              <div className={recordEditorGrid}>{sectionFields.map(renderField)}</div>
            </RecordEditorSection>
          ))}
          <StickyRecordEditorActions>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('crm.profile.edit.cancel', locale)}
            </Button>
            <Button ref={saveButton} type="submit">
              {t('crm.profile.edit.save', locale)}
            </Button>
          </StickyRecordEditorActions>
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
          onValidationError={onValidationError}
          {...(onDenied ? { onDenied } : {})}
          {...(onPendingChange ? { onPendingChange } : {})}
        />
      )}
    </>
  );
}
