import { Skeleton } from '@barghsa/ui';
import { useOnboardingForm } from '../../../hooks/useOnboardingForm.js';
import {
  OnboardingWizard,
  OnboardingReview,
  OnboardingSubmissionNotice,
} from '../../../components/OnboardingWizard.js';
import { useOnboardingSubmission } from '../../../hooks/useOnboardingSubmission.js';
import { useProfileContextRevision } from '../../../lib/profile-context.js';
import { wizardStepSearch } from '../../../lib/wizard-step.js';
import { useGeographyOptions } from '../../../hooks/useGeographyOptions.js';
import { GeographyLoadError } from '../../../components/GeographyLoadError.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { uploadLegalProfileDocument } from '../../../lib/invoice-bank-receipt-upload.js';
import { useOnboardingDraft } from '../../../hooks/useOnboardingDraft.js';
import { t } from '@barghsa/i18n/app';
import { normalizeProfileDigits } from '../../../lib/profile-digits.js';
import { useState, useCallback, useRef, useMemo } from 'react';
import { createFileRoute, useRouter, useParams, Link } from '@tanstack/react-router';
import { useLocale } from '../../../hooks/useLocale.js';
import {
  validateLegalNationalIdentifier,
  validatePostalCode,
  validateNationalId,
} from '@barghsa/shared/validation';
import { ChevronRightIcon, UploadIcon } from 'lucide-react';
import { Input, Label, DependentSelect, DatePicker, datePickerCalendarDate } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/legal/$profileId')({
  // Presentation-only input is bounded when the wizard component loads.
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  component: LegalProfileFormPage,
});

interface FormErrors {
  representativeHonorific?: string | undefined;
  representativeFirstName?: string | undefined;
  representativeLastName?: string | undefined;
  representativeNationalId?: string | undefined;
  representativeProvinceId?: string | undefined;
  representativeCityId?: string | undefined;
  representativeFullAddress?: string | undefined;
  representativePostalCode?: string | undefined;

  legalName?: string | undefined;
  nationalIdentifier?: string | undefined;
  registrationNumber?: string | undefined;
  companyTypeId?: string | undefined;
  registrationDate?: string | undefined;
  economicCode?: string | undefined;
  officialPhone?: string | undefined;
  officialEmail?: string | undefined;
  officialProvinceId?: string | undefined;
  officialCityId?: string | undefined;
  officialFullAddress?: string | undefined;
  officialPostalCode?: string | undefined;
  representativeTitle?: string | undefined;
  representativeRelationship?: string | undefined;
}

function documentList(value: string): Array<{ key: string; name: string }> {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is { key: string; name: string } =>
              !!item && typeof item.key === 'string' && typeof item.name === 'string'
          )
          .slice(0, 5)
      : [];
  } catch {
    return [];
  }
}

function LegalProfileFormPage() {
  const { profileId } = useParams({ from: '/onboarding/legal/$profileId' });
  const { onboardingUserId } = Route.useRouteContext();
  const revision = useProfileContextRevision();
  return (
    <LegalProfileForm
      key={JSON.stringify([onboardingUserId, profileId, revision])}
      profileId={profileId}
    />
  );
}

function LegalProfileForm({ profileId }: { profileId: string }) {
  const router = useRouter();
  const { step = 1 } = wizardStepSearch(Route.useSearch(), 5);
  const changeStep = (step: number) =>
    router.navigate({
      to: '/onboarding/legal/$profileId',
      params: { profileId },
      search: { step },
    });
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  const fields = useOnboardingForm(
    {
      documentKeys: '[]',
      representativeHonorific: '',
      representativeFirstName: '',
      representativeLastName: '',
      representativeNationalId: '',
      representativeProvinceId: '',
      representativeCityId: '',
      representativeFullAddress: '',
      representativePostalCode: '',
      representativeTitle: '',
      representativeRelationship: '',
      legalName: '',
      nationalIdentifier: '',
      registrationNumber: '',
      companyTypeId: '',
      registrationDate: '',
      economicCode: '',
      officialPhone: '',
      officialEmail: '',
      officialProvinceId: '',
      officialCityId: '',
      officialFullAddress: '',
      officialPostalCode: '',
    },
    (name, value) => validateField(name, value)
  );
  const { form, errors, touched } = fields;
  const representative = {
    representativeHonorific: fields.values.representativeHonorific ?? '',
    representativeFirstName: fields.values.representativeFirstName ?? '',
    representativeLastName: fields.values.representativeLastName ?? '',
    representativeNationalId: fields.values.representativeNationalId ?? '',
    representativeProvinceId: fields.values.representativeProvinceId ?? '',
    representativeCityId: fields.values.representativeCityId ?? '',
    representativeFullAddress: fields.values.representativeFullAddress ?? '',
    representativePostalCode: fields.values.representativePostalCode ?? '',
  };
  const setRepresentative = (
    update: typeof representative | ((previous: typeof representative) => typeof representative)
  ) => {
    const previous = {
      representativeHonorific: form.getValues('representativeHonorific') ?? '',
      representativeFirstName: form.getValues('representativeFirstName') ?? '',
      representativeLastName: form.getValues('representativeLastName') ?? '',
      representativeNationalId: form.getValues('representativeNationalId') ?? '',
      representativeProvinceId: form.getValues('representativeProvinceId') ?? '',
      representativeCityId: form.getValues('representativeCityId') ?? '',
      representativeFullAddress: form.getValues('representativeFullAddress') ?? '',
      representativePostalCode: form.getValues('representativePostalCode') ?? '',
    };
    const next = typeof update === 'function' ? update(previous) : update;
    for (const [name, value] of Object.entries(next)) fields.setField(name, value);
  };
  const [representativeTitle, setRepresentativeTitle] = fields.field('representativeTitle');
  const [representativeRelationship, setRepresentativeRelationship] = fields.field(
    'representativeRelationship'
  );
  const [legalName, setLegalName] = fields.field('legalName');
  const [nationalIdentifier, setNationalIdentifier] = fields.field('nationalIdentifier');
  const [registrationNumber, setRegistrationNumber] = fields.field('registrationNumber');
  const [companyTypeId, setCompanyTypeId] = fields.field('companyTypeId');
  const [registrationDate, setRegistrationDate] = fields.field('registrationDate');
  const [economicCode, setEconomicCode] = fields.field('economicCode');
  const [officialPhone, setOfficialPhone] = fields.field('officialPhone');
  const [officialEmail, setOfficialEmail] = fields.field('officialEmail');
  const [officialProvinceId, setOfficialProvinceId] = fields.field('officialProvinceId');
  const [officialCityId, setOfficialCityId] = fields.field('officialCityId');
  const [officialFullAddress, setOfficialFullAddress] = fields.field('officialFullAddress');
  const [officialPostalCode, setOfficialPostalCode] = fields.field('officialPostalCode');

  const provinceOptions = useGeographyOptions('/api/geography/provinces');
  const companyTypeOptions = useGeographyOptions('/api/geography/company-types');
  const cityOptions = useGeographyOptions(
    officialProvinceId
      ? `/api/geography/provinces/${encodeURIComponent(officialProvinceId)}/cities`
      : null,
    officialProvinceId || undefined
  );
  const representativeCityOptions = useGeographyOptions(
    representative.representativeProvinceId
      ? `/api/geography/provinces/${encodeURIComponent(representative.representativeProvinceId)}/cities`
      : null,
    representative.representativeProvinceId || undefined
  );
  const provinces = provinceOptions.options;
  const cities = cityOptions.options;
  const representativeCities = representativeCityOptions.options;
  const companyTypes = companyTypeOptions.options;
  const loadingProvinces = provinceOptions.loading;
  const loadingCompanyTypes = companyTypeOptions.loading;
  const companyTypesError = companyTypeOptions.error;
  const fetchCompanyTypes = companyTypeOptions.retry;
  const geographyUnavailable = [
    provinceOptions,
    companyTypeOptions,
    cityOptions,
    representativeCityOptions,
  ].some((options) => options.loading || options.error);

  const [documentKeys] = fields.field('documentKeys');
  const documents = useMemo(() => documentList(documentKeys), [documentKeys]);
  const setDocuments = (
    update: typeof documents | ((previous: typeof documents) => typeof documents)
  ) => {
    const previous = documentList(form.getValues('documentKeys') ?? '[]');
    const next = typeof update === 'function' ? update(previous) : update;
    fields.setField('documentKeys', JSON.stringify(next));
  };
  const [uploading, setUploading] = useState(false);
  const documentInput = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const [uploadError, setUploadError] = useState(false);
  const restoreDraft = useCallback(
    (data: Record<string, string>) => {
      if (
        Object.entries(data).every(
          ([key, value]) => !value || (key === 'documentKeys' && value === '[]')
        )
      )
        void router
          .navigate({
            to: '/onboarding/legal/$profileId',
            params: { profileId },
            search: { step: 1 },
            replace: true,
          })
          .catch(() => {});
      form.reset({
        documentKeys: JSON.stringify(documentList(data.documentKeys || '[]')),
        representativeHonorific: data.representativeHonorific ?? '',
        representativeFirstName: data.representativeFirstName ?? '',
        representativeLastName: data.representativeLastName ?? '',
        representativeNationalId: normalizeProfileDigits(data.representativeNationalId ?? ''),
        representativeProvinceId: data.representativeProvinceId ?? '',
        representativeCityId: data.representativeCityId ?? '',
        representativeFullAddress: data.representativeFullAddress ?? '',
        representativePostalCode: normalizeProfileDigits(data.representativePostalCode ?? ''),
        representativeTitle: data.representativeTitle ?? '',
        representativeRelationship: data.representativeRelationship ?? '',
        legalName: data.legalName ?? '',
        nationalIdentifier: normalizeProfileDigits(data.nationalIdentifier ?? ''),
        registrationNumber: data.registrationNumber ?? '',
        companyTypeId: data.companyTypeId ?? '',
        registrationDate: data.registrationDate ?? '',
        economicCode: data.economicCode ?? '',
        officialPhone: data.officialPhone ?? '',
        officialEmail: data.officialEmail ?? '',
        officialProvinceId: data.officialProvinceId ?? '',
        officialCityId: data.officialCityId ?? '',
        officialFullAddress: data.officialFullAddress ?? '',
        officialPostalCode: normalizeProfileDigits(data.officialPostalCode ?? ''),
      });
    },
    [router, profileId, form.reset]
  );
  const draft = useOnboardingDraft(
    profileId,
    {
      ...representative,
      documentKeys,
      legalName,
      nationalIdentifier,
      registrationNumber,
      companyTypeId,
      registrationDate,
      economicCode,
      officialPhone,
      officialEmail,
      officialProvinceId,
      officialCityId,
      officialFullAddress,
      officialPostalCode,
      representativeTitle,
      representativeRelationship,
    },
    restoreDraft
  );

  // ── Field-level validation ──────────────────────────────
  const validateField = useCallback(
    (field: string, value: string): string | undefined => {
      if (
        [
          'representativeHonorific',
          'representativeFirstName',
          'representativeLastName',
          'representativeNationalId',
          'representativeProvinceId',
          'representativeCityId',
          'representativeFullAddress',
          'representativePostalCode',
        ].includes(field)
      ) {
        if (field === 'representativeHonorific')
          return value.length > 50
            ? t('onboarding.individual.error.maxChars', locale).replace(
                '{count}',
                numbers.number(50)
              )
            : undefined;
        if (!value.trim()) return t('onboarding.individual.error.required', locale);
        if (field === 'representativeProvinceId' && !provinces.some((row) => row.id === value))
          return t('onboarding.individual.error.required', locale);
        if (
          field === 'representativeCityId' &&
          !representativeCities.some((row) => row.id === value)
        )
          return t('onboarding.individual.error.required', locale);
        if (field === 'representativeNationalId' && !validateNationalId(value.trim()))
          return t('onboarding.individual.error.invalidNationalId', locale);
        if (field === 'representativePostalCode' && !validatePostalCode(value.trim()))
          return t('onboarding.individual.error.invalidPostalCode', locale);
        const max = field === 'representativeFullAddress' ? 500 : 100;
        return value.length > max
          ? t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(max)
            )
          : undefined;
      }
      switch (field) {
        case 'legalName':
          if (!value.trim()) return isRtl ? 'نام شخص حقوقی الزامی است' : 'Legal name is required';
          if (value.length > 200)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(200)
            );
          return undefined;
        case 'nationalIdentifier':
          if (!value.trim())
            return isRtl ? 'شناسه ملی الزامی است' : 'National identifier is required';
          if (!validateLegalNationalIdentifier(value.trim()))
            return isRtl
              ? 'شناسه ملی معتبر نیست (۱۱ رقم)'
              : 'Invalid national identifier (11 digits)';
          return undefined;
        case 'registrationNumber':
          if (!value.trim())
            return isRtl ? 'شماره ثبت الزامی است' : 'Registration number is required';
          if (value.length > 50)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(50)
            );
          return undefined;
        case 'companyTypeId':
          if (!value || !companyTypes.some((row) => row.id === value))
            return isRtl ? 'نوع شرکت الزامی است' : 'Company type is required';
          return undefined;
        case 'registrationDate':
          return undefined; // optional
        case 'economicCode':
          return undefined; // optional
        case 'officialPhone':
          return undefined; // optional
        case 'officialEmail':
          if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
            return isRtl ? 'ایمیل معتبر نیست' : 'Invalid email format';
          return undefined;
        case 'officialProvinceId':
          return value && provinces.some((row) => row.id === value)
            ? undefined
            : t('onboarding.legal.required.province', locale);
        case 'officialCityId':
          return value && cities.some((row) => row.id === value)
            ? undefined
            : t('onboarding.legal.required.city', locale);
        case 'officialFullAddress':
          if (!value.trim()) return t('onboarding.legal.required.fullAddress', locale);
          if (value && value.length > 500)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(500)
            );
          return undefined;
        case 'officialPostalCode':
          if (!value.trim()) return t('onboarding.legal.required.postalCode', locale);
          if (!validatePostalCode(value.trim()))
            return isRtl ? 'کد پستی معتبر نیست' : 'Invalid postal code';
          return undefined;
        case 'representativeTitle':
          if (!value.trim())
            return isRtl ? 'عنوان نماینده الزامی است' : 'Representative title is required';
          if (value.length > 100)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(100)
            );
          return undefined;
        case 'representativeRelationship':
          if (!value.trim())
            return isRtl ? 'نسبت نماینده الزامی است' : 'Representative relationship is required';
          if (value.length > 100)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(100)
            );
          return undefined;
        default:
          return undefined;
      }
    },
    [isRtl, locale, numbers, provinces, cities, representativeCities, companyTypes]
  );

  const handleBlur = fields.blur;
  const values = fields.values;

  const submission = useOnboardingSubmission(profileId, 'LEGAL', draft);
  const { submitting } = submission;
  const locked = submitting || submission.unconfirmed;
  async function handleSubmit() {
    if (geographyUnavailable || uploadInFlight.current) return;
    await submission.submit({
      documents: documents.map((document) => document.key),
      ...Object.fromEntries(
        Object.entries(representative).map(([key, value]) => [key, value.trim()])
      ),
      legalName: legalName.trim(),
      nationalIdentifier: nationalIdentifier.trim(),
      registrationNumber: registrationNumber.trim(),
      companyTypeId: companyTypeId || undefined,
      registrationDate: registrationDate || undefined,
      economicCode: economicCode.trim() || undefined,
      officialPhone: officialPhone.trim() || undefined,
      officialEmail: officialEmail.trim() || undefined,
      officialProvinceId: officialProvinceId || undefined,
      officialCityId: officialCityId || undefined,
      officialFullAddress: officialFullAddress.trim() || undefined,
      officialPostalCode: officialPostalCode.trim() || undefined,
      representativeTitle: representativeTitle.trim(),
      representativeRelationship: representativeRelationship.trim(),
    });
  }

  async function uploadDocuments(files: File[]) {
    if (uploadInFlight.current || locked || !draft.ready || !files.length) return;
    if (documents.length + files.length > 5) {
      setUploadError(true);
      return;
    }
    uploadInFlight.current = true;
    setUploading(true);
    setUploadError(false);
    try {
      for (const file of files) {
        const key = await uploadLegalProfileDocument(file, profileId);
        if (!key) {
          setUploadError(true);
          continue;
        }
        setDocuments((previous) => [...previous, { key, name: file.name }]);
      }
    } catch {
      setUploadError(true);
    } finally {
      uploadInFlight.current = false;
      setUploading(false);
    }
  }
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void uploadDocuments(files);
  }
  function removeDocument(index: number) {
    setDocuments((previous) => previous.filter((_, i) => i !== index));
  }

  // ── Render helpers ──────────────────────────────────────
  function renderField(
    field: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    options?: {
      type?: string;
      required?: boolean;
      maxLength?: number;
      placeholder?: string;
      inputMode?: 'text' | 'numeric' | 'email' | 'tel';
    }
  ) {
    const isTouched = touched[field];
    const error = errors[field as keyof FormErrors];

    return (
      <div className="space-y-2">
        <Label htmlFor={field}>
          {label}
          {options?.required && (
            <span aria-hidden="true" className="text-destructive ms-0.5">
              *
            </span>
          )}
        </Label>
        {field === 'representativeFullAddress' ? (
          <>
            {' '}
            <textarea
              id={field}
              ref={form.register(field).ref}
              required
              aria-required="true"
              rows={3}
              maxLength={500}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onBlur={() => handleBlur(field)}
              disabled={locked}
              aria-invalid={isTouched && !!error}
              aria-describedby={isTouched && error ? `${field}-error` : undefined}
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground text-end">
              {numbers.number(value.length)}/{numbers.number(500)}
            </p>
          </>
        ) : field === 'registrationDate' ? (
          <DatePicker
            id={field}
            label={label}
            triggerProps={{
              ref: form.register(field).ref,
              'aria-invalid': isTouched && !!error,
              'aria-describedby': isTouched && error ? `${field}-error` : undefined,
            }}
            onBlur={() => handleBlur(field)}
            locale={locale}
            timezone="Asia/Tehran"
            numerals={numbers.number(1) === '1' ? 'latn' : 'arabext'}
            value={datePickerCalendarDate(value, 'Asia/Tehran')}
            disabled={locked}
            onChange={(date) =>
              onChange(
                date
                  ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
                  : ''
              )
            }
          />
        ) : (
          <Input
            id={field}
            ref={form.register(field).ref}
            type={options?.type ?? 'text'}
            inputMode={options?.inputMode}
            required={options?.required}
            aria-required={options?.required || undefined}
            maxLength={options?.maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => handleBlur(field)}
            disabled={locked}
            placeholder={options?.placeholder}
            aria-invalid={isTouched && !!error}
            aria-describedby={isTouched && error ? `${field}-error` : undefined}
          />
        )}
        {isTouched && error && (
          <p id={`${field}-error`} className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="container mx-auto flex min-h-screen items-start justify-center p-4 pt-12"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-3xl">
        {/* Back link */}
        <Link
          to="/onboarding"
          className="touch-action mb-4 inline-flex items-center text-sm pointer-coarse:min-h-[45px]! text-muted-foreground hover:text-primary"
        >
          <ChevronRightIcon className={`h-4 w-4 ${isRtl ? 'rotate-180' : ''}`} />
          {isRtl ? 'بازگشت' : 'Back'}
        </Link>

        <h1 className="mb-1 text-2xl font-bold">{isRtl ? 'پروفایل حقوقی' : 'Legal Profile'}</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {isRtl
            ? 'لطفاً اطلاعات شخص حقوقی را وارد کنید'
            : 'Please enter the legal entity information'}
        </p>

        <OnboardingSubmissionNotice {...submission} />

        <GeographyLoadError
          {...provinceOptions}
          message={t('onboarding.individual.error.loadProvinces', locale)}
          locale={locale}
          testId="onboarding-provinces-retry"
        />
        <OnboardingWizard
          form={form}
          step={step}
          onStepChange={changeStep}
          working={uploading}
          draft={draft}
          submitting={submitting}
          disabled={uploading || submission.unconfirmed}
          onSubmit={handleSubmit}
          steps={[
            {
              label: t('onboarding.wizard.representative', locale),
              fields: [
                ...Object.keys(representative),
                'representativeTitle',
                'representativeRelationship',
              ],
              content: (
                <>
                  {' '}
                  <fieldset disabled={!draft.ready || locked}>
                    <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
                      {isRtl ? 'اطلاعات نماینده' : 'Authorized Representative'}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(
                        [
                          'representativeHonorific',
                          'representativeFirstName',
                          'representativeLastName',
                          'representativeNationalId',
                          'representativeFullAddress',
                          'representativePostalCode',
                        ] as const
                      ).map((field) => (
                        <div key={field}>
                          {renderField(
                            field,
                            t(`onboarding.legal.${field}`, locale),
                            representative[field],
                            (value) =>
                              setRepresentative((prev) => ({
                                ...prev,
                                [field]:
                                  field === 'representativeNationalId' ||
                                  field === 'representativePostalCode'
                                    ? normalizeProfileDigits(value)
                                    : value,
                              })),
                            {
                              required: field !== 'representativeHonorific',
                              maxLength:
                                field === 'representativeFullAddress'
                                  ? 500
                                  : field === 'representativeHonorific'
                                    ? 50
                                    : field === 'representativeNationalId' ||
                                        field === 'representativePostalCode'
                                      ? 10
                                      : 100,
                            }
                          )}
                        </div>
                      ))}
                      {(['representativeProvinceId', 'representativeCityId'] as const).map(
                        (field) => (
                          <div key={field} className="space-y-2">
                            <Label htmlFor={field}>
                              {t(`onboarding.legal.${field}`, locale)}
                              <span aria-hidden="true" className="text-destructive ms-0.5">
                                *
                              </span>
                            </Label>
                            {field === 'representativeCityId' ? (
                              <DependentSelect
                                className="h-11 pointer-coarse:min-h-[45px]!"
                                id={field}
                                ref={form.register(field).ref}
                                required
                                aria-required="true"
                                dependencyValue={representative.representativeProvinceId}
                                value={representative[field]}
                                ready={representativeCityOptions.ready}
                                loading={representativeCityOptions.loading}
                                options={representativeCities.map((city) => ({
                                  value: city.id,
                                  label: isRtl ? city.nameFa : city.nameEn,
                                  dependencyValue: city.provinceId ?? '',
                                }))}
                                placeholder={t(`onboarding.legal.${field}`, locale)}
                                disabled={locked}
                                onChange={(event) =>
                                  setRepresentative((prev) => ({
                                    ...prev,
                                    representativeCityId: event.target.value,
                                  }))
                                }
                                onBlur={() => handleBlur(field)}
                                aria-invalid={touched[field] && !!errors[field]}
                                aria-describedby={
                                  touched[field] && errors[field] ? `${field}-error` : undefined
                                }
                              />
                            ) : (
                              <select
                                id={field}
                                ref={form.register(field).ref}
                                required
                                aria-required="true"
                                value={representative[field]}
                                disabled={locked || !provinceOptions.ready}
                                onChange={(event) =>
                                  setRepresentative((prev) => ({
                                    ...prev,
                                    [field]: event.target.value,
                                    ...(field === 'representativeProvinceId'
                                      ? { representativeCityId: '' }
                                      : {}),
                                  }))
                                }
                                onBlur={() => handleBlur(field)}
                                aria-invalid={touched[field] && !!errors[field]}
                                aria-describedby={
                                  touched[field] && errors[field] ? `${field}-error` : undefined
                                }
                                className="flex h-11 w-full pointer-coarse:min-h-[45px]! rounded-md border border-input bg-background px-3 py-2 text-sm"
                              >
                                <option value="">{t(`onboarding.legal.${field}`, locale)}</option>
                                {provinces.map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {isRtl ? item.nameFa : item.nameEn}
                                  </option>
                                ))}
                              </select>
                            )}
                            {field === 'representativeCityId' && (
                              <GeographyLoadError
                                {...representativeCityOptions}
                                message={t('onboarding.individual.error.loadCities', locale)}
                                locale={locale}
                                testId="onboarding-representative-cities-retry"
                              />
                            )}
                            {touched[field] && errors[field] && (
                              <p
                                id={`${field}-error`}
                                role="alert"
                                className="text-sm text-destructive"
                              >
                                {errors[field]}
                              </p>
                            )}
                          </div>
                        )
                      )}
                      {renderField(
                        'representativeTitle',
                        isRtl ? 'عنوان/سمت نماینده' : 'Representative Title',
                        representativeTitle,
                        setRepresentativeTitle,
                        {
                          required: true,
                          maxLength: 100,
                          placeholder: isRtl
                            ? 'مدیرعامل، رئیس هیئت مدیره، ...'
                            : 'CEO, Board Chair, ...',
                        }
                      )}
                      {renderField(
                        'representativeRelationship',
                        isRtl ? 'نسبت/ارتباط نماینده' : 'Representative Relationship',
                        representativeRelationship,
                        setRepresentativeRelationship,
                        {
                          required: true,
                          maxLength: 100,
                          placeholder: isRtl ? 'رابطه با شخص حقوقی' : 'Relationship to the entity',
                        }
                      )}
                    </div>
                  </fieldset>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.company', locale),
              fields: [
                'legalName',
                'nationalIdentifier',
                'registrationNumber',
                'companyTypeId',
                'registrationDate',
                'economicCode',
                'officialPhone',
                'officialEmail',
              ],
              content: (
                <>
                  {' '}
                  <fieldset disabled={!draft.ready || locked}>
                    <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
                      {isRtl ? 'اطلاعات شخص حقوقی' : 'Legal Entity'}
                    </legend>
                    <div className="space-y-4">
                      {renderField(
                        'legalName',
                        isRtl ? 'نام شخص حقوقی' : 'Legal Name',
                        legalName,
                        setLegalName,
                        {
                          required: true,
                          maxLength: 200,
                          placeholder: isRtl ? 'نام شرکت را وارد کنید' : 'Enter company name',
                        }
                      )}

                      <div className="grid gap-4 sm:grid-cols-2">
                        {renderField(
                          'nationalIdentifier',
                          isRtl ? 'شناسه ملی' : 'National Identifier',
                          nationalIdentifier,
                          (v) =>
                            setNationalIdentifier(
                              normalizeProfileDigits(v).replace(/\D/g, '').slice(0, 11)
                            ),
                          {
                            required: true,
                            inputMode: 'numeric',
                            maxLength: 11,
                            placeholder: isRtl
                              ? 'شناسه ملی ۱۱ رقمی'
                              : '11-digit national identifier',
                          }
                        )}
                        {renderField(
                          'registrationNumber',
                          isRtl ? 'شماره ثبت' : 'Registration Number',
                          registrationNumber,
                          setRegistrationNumber,
                          {
                            required: true,
                            maxLength: 50,
                            placeholder: isRtl ? 'شماره ثبت شرکت' : 'Company registration number',
                          }
                        )}
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        {/* Company type (select) */}
                        <div className="space-y-2">
                          <Label htmlFor="companyTypeId">
                            {isRtl ? 'نوع شرکت' : 'Company Type'}
                            <span aria-hidden="true" className="text-destructive ms-0.5">
                              *
                            </span>
                          </Label>
                          {loadingCompanyTypes ? (
                            <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                              <Skeleton className="h-6 w-20 shrink-0" />
                              {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                            </div>
                          ) : companyTypesError ? (
                            <div className="flex h-10 items-center gap-2 text-sm text-destructive">
                              <span>{isRtl ? 'خطا در بارگذاری' : 'Failed to load'}</span>
                              <button
                                type="button"
                                data-testid="onboarding-company-types-retry"
                                onClick={fetchCompanyTypes}
                                disabled={loadingCompanyTypes}
                                className="rounded border border-input px-2 py-1 text-xs hover:bg-muted"
                              >
                                {isRtl ? 'تلاش مجدد' : 'Retry'}
                              </button>
                            </div>
                          ) : (
                            <select
                              id="companyTypeId"
                              aria-required="true"
                              ref={form.register('companyTypeId').ref}
                              value={companyTypeId}
                              onChange={(e) => setCompanyTypeId(e.target.value)}
                              onBlur={() => handleBlur('companyTypeId')}
                              disabled={locked}
                              className="flex h-11 w-full pointer-coarse:min-h-[45px]! rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                              aria-invalid={touched.companyTypeId && !!errors.companyTypeId}
                              aria-describedby={
                                touched.companyTypeId && errors.companyTypeId
                                  ? 'companyTypeId-error'
                                  : undefined
                              }
                            >
                              <option value="">
                                {isRtl ? 'نوع شرکت را انتخاب کنید' : 'Select company type'}
                              </option>
                              {companyTypes.map((ct) => (
                                <option key={ct.id} value={ct.id}>
                                  {isRtl ? ct.nameFa : ct.nameEn}
                                </option>
                              ))}
                            </select>
                          )}
                          {touched.companyTypeId && errors.companyTypeId && (
                            <p
                              id="companyTypeId-error"
                              className="text-sm text-destructive"
                              role="alert"
                            >
                              {errors.companyTypeId}
                            </p>
                          )}
                        </div>

                        {renderField(
                          'registrationDate',
                          isRtl ? 'تاریخ ثبت' : 'Registration Date',
                          registrationDate,
                          setRegistrationDate,
                          {
                            type: 'date',
                            placeholder: isRtl ? 'تاریخ ثبت شرکت' : 'Registration date',
                          }
                        )}
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        {renderField(
                          'economicCode',
                          isRtl ? 'کد اقتصادی' : 'Economic Code',
                          economicCode,
                          setEconomicCode,
                          {
                            placeholder: isRtl
                              ? 'کد اقتصادی (اختیاری)'
                              : 'Economic code (optional)',
                          }
                        )}
                        {renderField(
                          'officialPhone',
                          isRtl ? 'تلفن رسمی' : 'Official Phone',
                          officialPhone,
                          setOfficialPhone,
                          {
                            type: 'tel',
                            inputMode: 'tel',
                            placeholder: isRtl
                              ? 'تلفن رسمی (اختیاری)'
                              : 'Official phone (optional)',
                          }
                        )}
                      </div>

                      {renderField(
                        'officialEmail',
                        isRtl ? 'ایمیل رسمی' : 'Official Email',
                        officialEmail,
                        setOfficialEmail,
                        {
                          type: 'email',
                          inputMode: 'email',
                          placeholder: isRtl ? 'ایمیل رسمی (اختیاری)' : 'Official email (optional)',
                        }
                      )}
                    </div>
                  </fieldset>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.address', locale),
              fields: [
                'officialProvinceId',
                'officialCityId',
                'officialFullAddress',
                'officialPostalCode',
              ],
              content: (
                <>
                  {' '}
                  <fieldset disabled={!draft.ready || locked}>
                    <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
                      {isRtl ? 'آدرس رسمی' : 'Official Address'}
                    </legend>

                    <div className="grid gap-4 sm:grid-cols-2">
                      {/* Province */}
                      <div className="space-y-2">
                        <Label htmlFor="officialProvinceId">
                          {isRtl ? 'استان' : 'Province'}
                          <span aria-hidden="true" className="text-destructive ms-0.5">
                            *
                          </span>
                        </Label>
                        {loadingProvinces ? (
                          <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                            <Skeleton className="h-6 w-20 shrink-0" />
                            {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                          </div>
                        ) : (
                          <select
                            id="officialProvinceId"
                            ref={form.register('officialProvinceId').ref}
                            required
                            aria-required="true"
                            value={officialProvinceId}
                            onChange={(e) => {
                              setOfficialProvinceId(e.target.value);
                              setOfficialCityId('');
                            }}
                            onBlur={() => handleBlur('officialProvinceId')}
                            aria-invalid={touched.officialProvinceId && !!errors.officialProvinceId}
                            aria-describedby={
                              touched.officialProvinceId && errors.officialProvinceId
                                ? 'officialProvinceId-error'
                                : undefined
                            }
                            disabled={locked || !provinceOptions.ready}
                            className="flex h-11 w-full pointer-coarse:min-h-[45px]! rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <option value="">
                              {isRtl ? 'استان را انتخاب کنید' : 'Select province'}
                            </option>
                            {provinces.map((p) => (
                              <option key={p.id} value={p.id}>
                                {isRtl ? p.nameFa : p.nameEn}
                              </option>
                            ))}
                          </select>
                        )}
                        {touched.officialProvinceId && errors.officialProvinceId && (
                          <p
                            id="officialProvinceId-error"
                            className="text-sm text-destructive"
                            role="alert"
                          >
                            {errors.officialProvinceId}
                          </p>
                        )}
                      </div>

                      {/* City */}
                      <div className="space-y-2">
                        <Label htmlFor="officialCityId">
                          {isRtl ? 'شهر' : 'City'}
                          <span aria-hidden="true" className="text-destructive ms-0.5">
                            *
                          </span>
                        </Label>
                        <DependentSelect
                          className="h-11 pointer-coarse:min-h-[45px]!"
                          id="officialCityId"
                          ref={form.register('officialCityId').ref}
                          required
                          aria-required="true"
                          dependencyValue={officialProvinceId}
                          value={officialCityId}
                          ready={cityOptions.ready}
                          loading={cityOptions.loading}
                          options={cities.map((city) => ({
                            value: city.id,
                            label: isRtl ? city.nameFa : city.nameEn,
                            dependencyValue: city.provinceId ?? '',
                          }))}
                          placeholder={t('onboarding.individual.city.placeholder', locale)}
                          onChange={(e) => setOfficialCityId(e.target.value)}
                          onBlur={() => handleBlur('officialCityId')}
                          disabled={locked}
                          aria-invalid={touched.officialCityId && !!errors.officialCityId}
                          aria-describedby={
                            touched.officialCityId && errors.officialCityId
                              ? 'officialCityId-error'
                              : undefined
                          }
                        />
                        <GeographyLoadError
                          {...cityOptions}
                          message={t('onboarding.individual.error.loadCities', locale)}
                          locale={locale}
                          testId="onboarding-official-cities-retry"
                        />
                        {touched.officialCityId && errors.officialCityId && (
                          <p
                            id="officialCityId-error"
                            className="text-sm text-destructive"
                            role="alert"
                          >
                            {errors.officialCityId}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Full Address */}
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="officialFullAddress">
                        {isRtl ? 'آدرس کامل' : 'Full Address'}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <textarea
                        id="officialFullAddress"
                        ref={form.register('officialFullAddress').ref}
                        required
                        aria-required="true"
                        maxLength={500}
                        rows={3}
                        value={officialFullAddress}
                        onChange={(e) => setOfficialFullAddress(e.target.value)}
                        onBlur={() => handleBlur('officialFullAddress')}
                        disabled={locked}
                        placeholder={isRtl ? 'آدرس کامل محل شرکت' : 'Full company address'}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-invalid={touched.officialFullAddress && !!errors.officialFullAddress}
                        aria-describedby={
                          touched.officialFullAddress && errors.officialFullAddress
                            ? 'officialFullAddress-error'
                            : undefined
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {numbers.number(officialFullAddress.length)}/{numbers.number(500)}
                      </p>
                      {touched.officialFullAddress && errors.officialFullAddress && (
                        <p
                          id="officialFullAddress-error"
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {errors.officialFullAddress}
                        </p>
                      )}
                    </div>

                    {/* Postal Code */}
                    <div className="mt-4 space-y-2">
                      <Label htmlFor="officialPostalCode">
                        {isRtl ? 'کد پستی' : 'Postal Code'}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <Input
                        id="officialPostalCode"
                        aria-required="true"
                        ref={form.register('officialPostalCode').ref}
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={officialPostalCode}
                        onChange={(e) => {
                          const val = normalizeProfileDigits(e.target.value)
                            .replace(/\D/g, '')
                            .slice(0, 10);
                          setOfficialPostalCode(val);
                        }}
                        onBlur={() => handleBlur('officialPostalCode')}
                        disabled={locked}
                        placeholder={isRtl ? 'کد پستی ۱۰ رقمی' : '10-digit postal code'}
                        aria-invalid={touched.officialPostalCode && !!errors.officialPostalCode}
                        aria-describedby={
                          touched.officialPostalCode && errors.officialPostalCode
                            ? 'officialPostalCode-error'
                            : undefined
                        }
                      />
                      <div className="min-h-10">
                        {touched.officialPostalCode && errors.officialPostalCode && (
                          <p
                            id="officialPostalCode-error"
                            className="text-sm text-destructive"
                            role="alert"
                          >
                            {errors.officialPostalCode}
                          </p>
                        )}
                      </div>
                    </div>
                  </fieldset>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.documents', locale),
              content: (
                <>
                  {' '}
                  <fieldset disabled={!draft.ready || locked}>
                    <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
                      {isRtl ? 'بارگذاری مدارک' : 'Document Upload'}
                    </legend>
                    <p className="mb-3 text-sm text-muted-foreground">
                      {isRtl
                        ? 'روزنامه رسمی یا مدارک ثبت شرکت (اختیاری)'
                        : 'Official gazette or registration documents (optional)'}
                    </p>

                    {uploading && (
                      <p role="status">{t('onboarding.documents.uploading', locale)}</p>
                    )}
                    {uploadError && (
                      <p id="document-upload-error" role="alert" className="text-destructive">
                        {t('onboarding.documents.error', locale)}
                      </p>
                    )}
                    <p id="document-upload-rules" className="mb-2 text-sm text-muted-foreground">
                      {t('onboarding.documents.limit', locale)}
                    </p>
                    <div className="flex items-center justify-center w-full">
                      <button
                        type="button"
                        onClick={() => documentInput.current?.click()}
                        disabled={locked || uploading}
                        aria-describedby={
                          uploadError
                            ? 'document-upload-rules document-upload-error'
                            : 'document-upload-rules'
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          void uploadDocuments(Array.from(event.dataTransfer.files));
                        }}
                        className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-background hover:bg-muted/50 transition-colors"
                      >
                        <UploadIcon
                          aria-hidden="true"
                          className="mb-2 size-8 text-muted-foreground"
                        />
                        <span className="text-sm text-muted-foreground">
                          {t('onboarding.documents.choose', locale)}
                        </span>
                      </button>
                      <input
                        ref={documentInput}
                        id="document-upload"
                        type="file"
                        hidden
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleFileChange}
                        disabled={locked || uploading}
                      />
                    </div>

                    {documents.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {documents.map((doc, idx) => (
                          <li
                            key={`${doc.name}-${idx}`}
                            className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
                          >
                            <span className="truncate">{doc.name}</span>
                            <button
                              type="button"
                              onClick={() => removeDocument(idx)}
                              disabled={locked || uploading}
                              className="text-destructive hover:text-destructive/80 text-xs ml-2"
                              aria-label={isRtl ? `حذف ${doc.name}` : `Remove ${doc.name}`}
                            >
                              {isRtl ? 'حذف' : 'Remove'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </fieldset>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.review', locale),
              content: ({ onEdit, disabled }) => (
                <OnboardingReview
                  onEdit={onEdit}
                  disabled={disabled}
                  sectionTitles={['representative', 'company', 'address', 'documents'].map((key) =>
                    t(`onboarding.wizard.${key}`, locale)
                  )}
                  rows={[
                    ...Object.entries(values)
                      .filter(([field]) => field !== 'documentKeys')
                      .map(([field, value]) => ({
                        step: /(?:ProvinceId|CityId|FullAddress|PostalCode)$/.test(field)
                          ? 3
                          : field.startsWith('representative')
                            ? 1
                            : 2,
                        label: t(`onboarding.legal.${field}`, locale),
                        value:
                          field === 'companyTypeId'
                            ? ((isRtl
                                ? companyTypes.find((p) => p.id === value)?.nameFa
                                : companyTypes.find((p) => p.id === value)?.nameEn) ?? '')
                            : field.endsWith('ProvinceId')
                              ? ((isRtl
                                  ? provinces.find((p) => p.id === value)?.nameFa
                                  : provinces.find((p) => p.id === value)?.nameEn) ?? '')
                              : field.endsWith('CityId')
                                ? ((isRtl
                                    ? [...cities, ...representativeCities].find(
                                        (p) => p.id === value
                                      )?.nameFa
                                    : [...cities, ...representativeCities].find(
                                        (p) => p.id === value
                                      )?.nameEn) ?? '')
                                : value,
                      })),
                    {
                      step: 4,
                      label: t('onboarding.wizard.documents', locale),
                      value: documents.map((document) => document.name).join('\n'),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
