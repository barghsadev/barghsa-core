import { useGeographyOptions } from '../../../hooks/useGeographyOptions.js';
import { GeographyLoadError } from '../../../components/GeographyLoadError.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { uploadLegalProfileDocument } from '../../../lib/invoice-bank-receipt-upload.js';
import { useOnboardingDraft } from '../../../hooks/useOnboardingDraft.js';
import { t } from '@barghsa/i18n';
import { withCsrf } from '../../../lib/csrf.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute, useRouter, useParams, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useLocale } from '../../../hooks/useLocale.js';
import {
  validateLegalNationalIdentifier,
  validatePostalCode,
  validateNationalId,
} from '@barghsa/shared/validation';
import { ErrorCodes } from '@barghsa/shared/errors';
import { Loader2Icon, ChevronRightIcon, UploadIcon } from 'lucide-react';
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/legal/$profileId')({
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

function LegalProfileFormPage() {
  const { profileId } = useParams({ from: '/onboarding/legal/$profileId' });
  const router = useRouter();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  // ── Form state ──────────────────────────────────────────
  // Representative section
  const [representativeTitle, setRepresentativeTitle] = useState('');
  const [representativeRelationship, setRepresentativeRelationship] = useState('');
  // Legal entity section
  const [representative, setRepresentative] = useState({
    representativeHonorific: '',
    representativeFirstName: '',
    representativeLastName: '',
    representativeNationalId: '',
    representativeProvinceId: '',
    representativeCityId: '',
    representativeFullAddress: '',
    representativePostalCode: '',
  });
  const [legalName, setLegalName] = useState('');
  const [nationalIdentifier, setNationalIdentifier] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [companyTypeId, setCompanyTypeId] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
  const [economicCode, setEconomicCode] = useState('');
  const [officialPhone, setOfficialPhone] = useState('');
  const [officialEmail, setOfficialEmail] = useState('');
  // Official address section
  const [officialProvinceId, setOfficialProvinceId] = useState('');
  const [officialCityId, setOfficialCityId] = useState('');
  const [officialFullAddress, setOfficialFullAddress] = useState('');
  const [officialPostalCode, setOfficialPostalCode] = useState('');

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

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
  const loadingCities = cityOptions.loading;
  const loadingRepresentativeCities = representativeCityOptions.loading;
  const loadingCompanyTypes = companyTypeOptions.loading;
  const companyTypesError = companyTypeOptions.error;
  const fetchCompanyTypes = companyTypeOptions.retry;
  const geographyUnavailable = [
    provinceOptions,
    companyTypeOptions,
    cityOptions,
    representativeCityOptions,
  ].some((options) => options.loading || options.error);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [documents, setDocuments] = useState<Array<{ key: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const uploadInFlight = useRef(false);
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);
  const [uploadError, setUploadError] = useState(false);
  const restoreDraft = useCallback((data: Record<string, string>) => {
    try {
      const parsed: unknown = JSON.parse(data.documentKeys || '[]');
      setDocuments(
        Array.isArray(parsed)
          ? parsed
              .filter(
                (item): item is { key: string; name: string } =>
                  !!item && typeof item.key === 'string' && typeof item.name === 'string'
              )
              .slice(0, 5)
          : []
      );
    } catch {
      setDocuments([]);
    }

    setLegalName(data.legalName ?? '');
    setNationalIdentifier(data.nationalIdentifier ?? '');
    setRegistrationNumber(data.registrationNumber ?? '');
    setCompanyTypeId(data.companyTypeId ?? '');
    setRegistrationDate(data.registrationDate ?? '');
    setEconomicCode(data.economicCode ?? '');
    setOfficialPhone(data.officialPhone ?? '');
    setOfficialEmail(data.officialEmail ?? '');
    setOfficialProvinceId(data.officialProvinceId ?? '');
    setOfficialCityId(data.officialCityId ?? '');
    setOfficialFullAddress(data.officialFullAddress ?? '');
    setOfficialPostalCode(data.officialPostalCode ?? '');
    setRepresentativeTitle(data.representativeTitle ?? '');
    setRepresentativeRelationship(data.representativeRelationship ?? '');
    setRepresentative({
      representativeHonorific: data.representativeHonorific ?? '',
      representativeFirstName: data.representativeFirstName ?? '',
      representativeLastName: data.representativeLastName ?? '',
      representativeNationalId: data.representativeNationalId ?? '',
      representativeProvinceId: data.representativeProvinceId ?? '',
      representativeCityId: data.representativeCityId ?? '',
      representativeFullAddress: data.representativeFullAddress ?? '',
      representativePostalCode: data.representativePostalCode ?? '',
    });
  }, []);
  const draft = useOnboardingDraft(
    profileId,
    {
      ...representative,
      documentKeys: JSON.stringify(documents),
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

  const handleBlur = useCallback(
    (field: string) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      const values: Record<string, string> = {
        ...representative,
        legalName,
        nationalIdentifier,
        registrationNumber,
        companyTypeId,
        registrationDate,
        economicCode,
        officialPhone,
        officialEmail,
        officialProvinceId: officialProvinceId,
        officialCityId: officialCityId,
        officialFullAddress,
        officialPostalCode,
        representativeTitle,
        representativeRelationship,
      };
      const value = values[field] ?? '';
      const error = validateField(field, value);
      setErrors((prev) => ({ ...prev, [field]: error }));
    },
    [
      representative,
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
      validateField,
    ]
  );

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {
      ...Object.fromEntries(
        Object.entries(representative).map(([key, value]) => [key, validateField(key, value)])
      ),
      legalName: validateField('legalName', legalName),
      nationalIdentifier: validateField('nationalIdentifier', nationalIdentifier),
      registrationNumber: validateField('registrationNumber', registrationNumber),
      companyTypeId: validateField('companyTypeId', companyTypeId),
      officialPostalCode: validateField('officialPostalCode', officialPostalCode),
      officialProvinceId: validateField('officialProvinceId', officialProvinceId),
      officialCityId: validateField('officialCityId', officialCityId),
      officialFullAddress: validateField('officialFullAddress', officialFullAddress),
      officialEmail: validateField('officialEmail', officialEmail),
      representativeTitle: validateField('representativeTitle', representativeTitle),
      representativeRelationship: validateField(
        'representativeRelationship',
        representativeRelationship
      ),
    };
    setErrors(newErrors);
    setTouched({
      ...Object.fromEntries(Object.keys(representative).map((key) => [key, true])),
      legalName: true,
      nationalIdentifier: true,
      registrationNumber: true,
      companyTypeId: true,
      officialPostalCode: true,
      officialProvinceId: true,
      officialCityId: true,
      officialFullAddress: true,
      officialEmail: true,
      representativeTitle: true,
      representativeRelationship: true,
    });
    return !Object.values(newErrors).some(Boolean);
  }, [
    representative,
    legalName,
    nationalIdentifier,
    registrationNumber,
    companyTypeId,
    officialPostalCode,
    officialProvinceId,
    officialCityId,
    officialFullAddress,
    officialEmail,
    representativeTitle,
    representativeRelationship,
    validateField,
  ]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (geographyUnavailable) return;
      setSubmitError(null);

      if (!draft.ready || uploading || !validateForm()) return;

      setSubmitting(true);

      try {
        const draftVersion = await draft.flush();
        if (draftVersion === undefined) return;
        const response = await fetch(`/api/onboarding/legal/${profileId}`, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            draftVersion,
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
          }),
        });

        const body: Record<string, unknown> = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errorCode =
            typeof body?.error === 'string'
              ? body.error
              : ((body?.error as Record<string, unknown>)?.code as string | undefined);

          if (errorCode === ErrorCodes.CONFLICT_VERSION.code) {
            draft.markConflict();
            setSubmitError(t('onboarding.draft.conflict', locale));
          } else if (errorCode === ErrorCodes.CONFLICT_DUPLICATE.code) {
            setSubmitError(
              isRtl
                ? 'این شناسه ملی قبلاً ثبت شده است'
                : 'This national identifier is already registered'
            );
          } else {
            setSubmitError(
              isRtl
                ? 'ذخیره‌سازی با خطا مواجه شد. لطفاً دوباره تلاش کنید'
                : 'Failed to save. Please try again'
            );
          }
          return;
        }

        toast.success(
          isRtl ? 'پروفایل حقوقی با موفقیت ذخیره شد' : 'Legal profile saved successfully'
        );
        router.navigate({
          to: '/onboarding/complete',
          search: { profileId },
          replace: true,
        });
      } catch {
        setSubmitError(
          isRtl
            ? 'ذخیره‌سازی با خطا مواجه شد. لطفاً دوباره تلاش کنید'
            : 'Failed to save. Please try again'
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      profileId,
      documents,
      uploading,
      draft.ready,
      draft.flush,
      draft.markConflict,
      locale,
      representative,
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
      validateForm,
      geographyUnavailable,
      isRtl,
      router,
    ]
  );

  async function uploadDocuments(files: File[]) {
    if (uploadInFlight.current || submitting || !draft.ready || !files.length) return;
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
          {options?.required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
        {field === 'representativeFullAddress' ? (
          <textarea
            id={field}
            required
            rows={3}
            maxLength={500}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => handleBlur(field)}
            disabled={submitting}
            aria-invalid={isTouched && !!error}
            aria-describedby={error ? `${field}-error` : undefined}
            className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        ) : (
          <Input
            id={field}
            type={options?.type ?? 'text'}
            inputMode={options?.inputMode}
            required={options?.required}
            maxLength={options?.maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => handleBlur(field)}
            disabled={submitting}
            placeholder={options?.placeholder}
            aria-invalid={isTouched && !!error}
            aria-describedby={error ? `${field}-error` : undefined}
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
          onClick={async (event) => {
            event.preventDefault();
            if (uploading) return;
            if (!draft.ready || (await draft.flush()) !== undefined)
              await router.navigate({ to: '/onboarding' });
          }}
          className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-primary"
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

        <div className="mb-4" role="status">
          <span>{t(`onboarding.draft.${draft.status}`, locale)}</span>
          {(draft.status === 'error' || draft.status === 'conflict') && (
            <Button
              type="button"
              variant="outline"
              className="ms-2"
              onClick={() => {
                if (draft.status === 'conflict' || !draft.ready) draft.reload();
                else void draft.flush();
              }}
            >
              {t(
                draft.status === 'conflict' || !draft.ready
                  ? 'onboarding.draft.reload'
                  : 'onboarding.draft.retry',
                locale
              )}
            </Button>
          )}
        </div>
        {/* Submit error alert */}
        {submitError && (
          <Alert variant="destructive" className="mb-6" role="alert">
            <AlertTitle className="sr-only">Error</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <form
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              void draft.flush();
          }}
          onSubmit={handleSubmit}
          className="space-y-8"
          noValidate
        >
          {/* ── Section 1: Authorized Representative ────────── */}
          <GeographyLoadError
            {...provinceOptions}
            message={t('onboarding.individual.error.loadProvinces', locale)}
            locale={locale}
            testId="onboarding-provinces-retry"
          />
          <fieldset
            disabled={!draft.ready || submitting}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                void draft.flush();
            }}
          >
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
                    (value) => setRepresentative((prev) => ({ ...prev, [field]: value })),
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
              {(['representativeProvinceId', 'representativeCityId'] as const).map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={field}>{t(`onboarding.legal.${field}`, locale)}</Label>
                  <select
                    id={field}
                    required
                    value={representative[field]}
                    disabled={
                      submitting ||
                      (field === 'representativeProvinceId'
                        ? loadingProvinces
                        : !representative.representativeProvinceId || loadingRepresentativeCities)
                    }
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
                    aria-describedby={errors[field] ? `${field}-error` : undefined}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t(`onboarding.legal.${field}`, locale)}</option>
                    {(field === 'representativeProvinceId' ? provinces : representativeCities).map(
                      (item) => (
                        <option key={item.id} value={item.id}>
                          {isRtl ? item.nameFa : item.nameEn}
                        </option>
                      )
                    )}
                  </select>
                  {field === 'representativeCityId' && (
                    <GeographyLoadError
                      {...representativeCityOptions}
                      message={t('onboarding.individual.error.loadCities', locale)}
                      locale={locale}
                      testId="onboarding-representative-cities-retry"
                    />
                  )}
                  {touched[field] && errors[field] && (
                    <p id={`${field}-error`} role="alert" className="text-sm text-destructive">
                      {errors[field]}
                    </p>
                  )}
                </div>
              ))}
              {renderField(
                'representativeTitle',
                isRtl ? 'عنوان/سمت نماینده' : 'Representative Title',
                representativeTitle,
                setRepresentativeTitle,
                {
                  required: true,
                  maxLength: 100,
                  placeholder: isRtl ? 'مدیرعامل، رئیس هیئت مدیره، ...' : 'CEO, Board Chair, ...',
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

          {/* ── Section 2: Legal Entity ─────────────────────── */}
          <fieldset
            disabled={!draft.ready || submitting}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                void draft.flush();
            }}
          >
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
                  (v) => setNationalIdentifier(v.replace(/\D/g, '').slice(0, 11)),
                  {
                    required: true,
                    inputMode: 'numeric',
                    maxLength: 11,
                    placeholder: isRtl ? 'شناسه ملی ۱۱ رقمی' : '11-digit national identifier',
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
                    <span className="text-destructive ml-0.5">*</span>
                  </Label>
                  {loadingCompanyTypes ? (
                    <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
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
                      value={companyTypeId}
                      onChange={(e) => setCompanyTypeId(e.target.value)}
                      onBlur={() => handleBlur('companyTypeId')}
                      disabled={submitting}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-invalid={touched.companyTypeId && !!errors.companyTypeId}
                      aria-describedby={errors.companyTypeId ? 'companyTypeId-error' : undefined}
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
                    <p id="companyTypeId-error" className="text-sm text-destructive" role="alert">
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
                    placeholder: isRtl ? 'کد اقتصادی (اختیاری)' : 'Economic code (optional)',
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
                    placeholder: isRtl ? 'تلفن رسمی (اختیاری)' : 'Official phone (optional)',
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

          {/* ── Section 3: Official Address ────────────────── */}
          <fieldset
            disabled={!draft.ready || submitting}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                void draft.flush();
            }}
          >
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'آدرس رسمی' : 'Official Address'}
            </legend>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Province */}
              <div className="space-y-2">
                <Label htmlFor="officialProvinceId">{isRtl ? 'استان' : 'Province'}</Label>
                {loadingProvinces ? (
                  <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                  </div>
                ) : (
                  <select
                    id="officialProvinceId"
                    required
                    value={officialProvinceId}
                    onChange={(e) => {
                      setOfficialProvinceId(e.target.value);
                      setOfficialCityId('');
                    }}
                    onBlur={() => handleBlur('officialProvinceId')}
                    disabled={submitting}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{isRtl ? 'استان را انتخاب کنید' : 'Select province'}</option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.id}>
                        {isRtl ? p.nameFa : p.nameEn}
                      </option>
                    ))}
                  </select>
                )}
                {touched.officialProvinceId && errors.officialProvinceId && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.officialProvinceId}
                  </p>
                )}
              </div>

              {/* City */}
              <div className="space-y-2">
                <Label htmlFor="officialCityId">{isRtl ? 'شهر' : 'City'}</Label>
                {loadingCities ? (
                  <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                    {isRtl ? 'در حال بارگذاری...' : 'Loading...'}
                  </div>
                ) : (
                  <select
                    id="officialCityId"
                    required
                    value={officialCityId}
                    onChange={(e) => setOfficialCityId(e.target.value)}
                    onBlur={() => handleBlur('officialCityId')}
                    disabled={submitting || !officialProvinceId}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">{isRtl ? 'شهر را انتخاب کنید' : 'Select city'}</option>
                    {cities.map((c) => (
                      <option key={c.id} value={c.id}>
                        {isRtl ? c.nameFa : c.nameEn}
                      </option>
                    ))}
                  </select>
                )}
                <GeographyLoadError
                  {...cityOptions}
                  message={t('onboarding.individual.error.loadCities', locale)}
                  locale={locale}
                  testId="onboarding-official-cities-retry"
                />
                {touched.officialCityId && errors.officialCityId && (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.officialCityId}
                  </p>
                )}
              </div>
            </div>

            {/* Full Address */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="officialFullAddress">{isRtl ? 'آدرس کامل' : 'Full Address'}</Label>
              <textarea
                id="officialFullAddress"
                required
                maxLength={500}
                rows={3}
                value={officialFullAddress}
                onChange={(e) => setOfficialFullAddress(e.target.value)}
                onBlur={() => handleBlur('officialFullAddress')}
                disabled={submitting}
                placeholder={isRtl ? 'آدرس کامل محل شرکت' : 'Full company address'}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                aria-invalid={touched.officialFullAddress && !!errors.officialFullAddress}
                aria-describedby={
                  errors.officialFullAddress ? 'officialFullAddress-error' : undefined
                }
              />
              <p className="text-xs text-muted-foreground">
                {numbers.number(officialFullAddress.length)}/{numbers.number(500)}
              </p>
              {touched.officialFullAddress && errors.officialFullAddress && (
                <p id="officialFullAddress-error" className="text-sm text-destructive" role="alert">
                  {errors.officialFullAddress}
                </p>
              )}
            </div>

            {/* Postal Code */}
            <div className="mt-4 space-y-2">
              <Label htmlFor="officialPostalCode">{isRtl ? 'کد پستی' : 'Postal Code'}</Label>
              <Input
                id="officialPostalCode"
                type="text"
                inputMode="numeric"
                maxLength={10}
                value={officialPostalCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setOfficialPostalCode(val);
                }}
                onBlur={() => handleBlur('officialPostalCode')}
                disabled={submitting}
                placeholder={isRtl ? 'کد پستی ۱۰ رقمی' : '10-digit postal code'}
                aria-invalid={touched.officialPostalCode && !!errors.officialPostalCode}
                aria-describedby={
                  errors.officialPostalCode ? 'officialPostalCode-error' : undefined
                }
              />
              {touched.officialPostalCode && errors.officialPostalCode && (
                <p id="officialPostalCode-error" className="text-sm text-destructive" role="alert">
                  {errors.officialPostalCode}
                </p>
              )}
            </div>
          </fieldset>

          {/* ── Section 4: Document Upload ─────────────────── */}
          <fieldset
            disabled={!draft.ready || submitting}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                void draft.flush();
            }}
          >
            <legend className="mb-4 text-lg font-semibold border-b pb-2 w-full">
              {isRtl ? 'بارگذاری مدارک' : 'Document Upload'}
            </legend>
            <p className="mb-3 text-sm text-muted-foreground">
              {isRtl
                ? 'روزنامه رسمی یا مدارک ثبت شرکت (اختیاری)'
                : 'Official gazette or registration documents (optional)'}
            </p>

            {uploading && <p role="status">{t('onboarding.documents.uploading', locale)}</p>}
            {uploadError && (
              <p role="alert" className="text-destructive">
                {t('onboarding.documents.error', locale)}
              </p>
            )}
            <p className="mb-2 text-sm text-muted-foreground">
              {t('onboarding.documents.limit', locale)}
            </p>
            <div className="flex items-center justify-center w-full">
              <label
                htmlFor="document-upload"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void uploadDocuments(Array.from(event.dataTransfer.files));
                }}
                className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-background hover:bg-muted/50 transition-colors"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <UploadIcon className="w-8 h-8 mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {isRtl
                      ? 'برای آپلود کلیک کنید یا فایل را بکشید و رها کنید'
                      : 'Click or drag and drop to upload'}
                  </p>
                </div>
                <input
                  id="document-upload"
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={submitting || uploading}
                />
              </label>
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
                      disabled={submitting || uploading}
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

          {/* ── Submit ──────────────────────────────────────── */}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || uploading || !draft.ready || geographyUnavailable}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                {isRtl ? 'در حال ذخیره...' : 'Saving...'}
              </>
            ) : isRtl ? (
              'ذخیره و ادامه'
            ) : (
              'Save & Continue'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
