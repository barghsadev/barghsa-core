import { GeographyPicker } from '../../../components/GeographyPicker.js';
import { useOnboardingForm } from '../../../hooks/useOnboardingForm.js';
import {
  OnboardingWizard,
  OnboardingProfileHeader,
  OnboardingReview,
  OnboardingSubmissionNotice,
} from '../../../components/OnboardingWizard.js';
import { useOnboardingDraft } from '../../../hooks/useOnboardingDraft.js';
import { useOnboardingSubmission } from '../../../hooks/useOnboardingSubmission.js';
import { useProfileContextRevision } from '../../../lib/profile-context.js';
import { wizardStepSearch } from '../../../lib/wizard-step.js';
import { useGeographyOptions } from '../../../hooks/useGeographyOptions.js';
import { GeographyLoadError } from '../../../components/GeographyLoadError.js';
import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { useLocale } from '../../../hooks/useLocale.js';
import { normalizeProfileDigits } from '../../../lib/profile-digits.js';
import { useCallback } from 'react';
import { createFileRoute, useRouter, useParams } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { validateNationalId, validatePostalCode } from '@barghsa/shared/validation';
import { Input, Label, Textarea } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/individual/$profileId')({
  // Presentation-only input is bounded when the wizard component loads.
  validateSearch: (search): { step?: unknown } => ({ step: search.step }),
  component: IndividualProfileFormPage,
});

function IndividualProfileFormPage() {
  const { profileId } = useParams({ from: '/onboarding/individual/$profileId' });
  const { onboardingUserId } = Route.useRouteContext();
  const revision = useProfileContextRevision();
  return (
    <IndividualProfileForm
      key={JSON.stringify([onboardingUserId, profileId, revision])}
      profileId={profileId}
    />
  );
}

function IndividualProfileForm({ profileId }: { profileId: string }) {
  const router = useRouter();
  const { step = 1 } = wizardStepSearch(Route.useSearch(), 3);
  const changeStep = (step: number) =>
    router.navigate({
      to: '/onboarding/individual/$profileId',
      params: { profileId },
      search: { step },
    });
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  const fields = useOnboardingForm(
    {
      title: '',
      firstName: '',
      lastName: '',
      nationalId: '',
      provinceId: '',
      cityId: '',
      fullAddress: '',
      postalCode: '',
    },
    (name, value) => validateField(name, value)
  );
  const { form, errors, touched } = fields;
  const [title, setTitle] = fields.field('title');
  const [firstName, setFirstName] = fields.field('firstName');
  const [lastName, setLastName] = fields.field('lastName');
  const [nationalId, setNationalId] = fields.field('nationalId');
  const [selectedProvinceId, setSelectedProvinceId] = fields.field('provinceId');
  const [selectedCityId, setSelectedCityId] = fields.field('cityId');
  const [fullAddress, setFullAddress] = fields.field('fullAddress');
  const [postalCode, setPostalCode] = fields.field('postalCode');

  const provinceOptions = useGeographyOptions('/api/geography/provinces');
  const cityOptions = useGeographyOptions(
    selectedProvinceId
      ? `/api/geography/provinces/${encodeURIComponent(selectedProvinceId)}/cities`
      : null,
    selectedProvinceId || undefined
  );
  const provinces = provinceOptions.options;
  const cities = cityOptions.options;
  const geographyUnavailable =
    provinceOptions.loading || provinceOptions.error || cityOptions.loading || cityOptions.error;

  const restoreDraft = useCallback(
    (data: Record<string, string>) => {
      if (Object.values(data).every((value) => !value))
        void router
          .navigate({
            to: '/onboarding/individual/$profileId',
            params: { profileId },
            search: { step: 1 },
            replace: true,
          })
          .catch(() => {});
      form.reset({
        title: data.title ?? '',
        firstName: data.firstName ?? '',
        lastName: data.lastName ?? '',
        nationalId: normalizeProfileDigits(data.nationalId ?? ''),
        provinceId: data.provinceId ?? '',
        cityId: data.cityId ?? '',
        fullAddress: data.fullAddress ?? '',
        postalCode: normalizeProfileDigits(data.postalCode ?? ''),
      });
    },
    [router, profileId, form.reset]
  );
  const values = {
    title,
    firstName,
    lastName,
    nationalId,
    provinceId: selectedProvinceId,
    cityId: selectedCityId,
    fullAddress,
    postalCode,
  };
  const draft = useOnboardingDraft(profileId, values, restoreDraft);

  // Field-level validation
  const validateField = useCallback(
    (field: string, value: string): string | undefined => {
      switch (field) {
        case 'title':
          if (value.length > 50)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(50)
            );
          return undefined;
        case 'firstName':
          if (!value.trim()) return t('onboarding.individual.error.required', locale);
          if (value.length > 100)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(100)
            );
          return undefined;
        case 'lastName':
          if (!value.trim()) return t('onboarding.individual.error.required', locale);
          if (value.length > 100)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(100)
            );
          return undefined;
        case 'nationalId':
          if (!value.trim()) return t('onboarding.individual.error.required', locale);
          if (!validateNationalId(value.trim()))
            return t('onboarding.individual.error.invalidNationalId', locale);
          return undefined;
        case 'provinceId':
          if (!value || !provinces.some((row) => row.id === value))
            return t('onboarding.individual.error.required', locale);
          return undefined;
        case 'cityId':
          if (!value || !cities.some((row) => row.id === value))
            return t('onboarding.individual.error.required', locale);
          return undefined;
        case 'fullAddress':
          if (!value.trim()) return t('onboarding.individual.error.required', locale);
          if (value.length > 500)
            return t('onboarding.individual.error.maxChars', locale).replace(
              '{count}',
              numbers.number(500)
            );
          return undefined;
        case 'postalCode':
          if (!value.trim()) return t('onboarding.individual.error.required', locale);
          if (!validatePostalCode(value.trim()))
            return t('onboarding.individual.error.invalidPostalCode', locale);
          return undefined;
        default:
          return undefined;
      }
    },
    [locale, numbers, provinces, cities]
  );

  const handleBlur = fields.blur;

  const submission = useOnboardingSubmission(profileId, 'INDIVIDUAL', draft);
  const { submitting } = submission;
  const locked = submitting || submission.unconfirmed;
  async function handleSubmit() {
    if (geographyUnavailable) return;
    await submission.submit({
      title: title.trim() || undefined,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nationalId: nationalId.trim(),
      provinceId: selectedProvinceId,
      cityId: selectedCityId,
      fullAddress: fullAddress.trim(),
      postalCode: postalCode.trim(),
    });
  }

  return (
    <div
      className="container mx-auto flex min-h-dvh items-start justify-center px-4 py-4 sm:py-8"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="w-full min-w-0 max-w-2xl">
        <OnboardingProfileHeader
          title={t('onboarding.individual.title', locale)}
          description={t('onboarding.individual.subtitle', locale)}
        />

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
          draft={draft}
          submitting={submitting}
          disabled={submission.unconfirmed}
          onSubmit={handleSubmit}
          steps={[
            {
              label: t('onboarding.wizard.identity', locale),
              fields: ['firstName', 'lastName', 'nationalId', 'title'],
              content: (
                <>
                  {' '}
                  {/* Two-column layout for desktop */}
                  <div className="grid min-w-0 gap-x-4 gap-y-3 min-[380px]:grid-cols-2">
                    {/* First Name */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="firstName">
                        {t('onboarding.individual.firstName', locale)}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <Input
                        id="firstName"
                        autoComplete="given-name"
                        ref={form.register('firstName').ref}
                        type="text"
                        required
                        aria-required="true"
                        maxLength={100}
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        onBlur={() => handleBlur('firstName')}
                        disabled={locked}
                        placeholder={t('onboarding.individual.firstName.placeholder', locale)}
                        aria-invalid={touched.firstName && !!errors.firstName}
                        aria-describedby={
                          touched.firstName && errors.firstName ? 'firstName-error' : undefined
                        }
                      />
                      {touched.firstName && errors.firstName && (
                        <p id="firstName-error" className="text-sm text-destructive" role="alert">
                          {errors.firstName}
                        </p>
                      )}
                    </div>

                    {/* Last Name */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="lastName">
                        {t('onboarding.individual.lastName', locale)}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <Input
                        id="lastName"
                        autoComplete="family-name"
                        ref={form.register('lastName').ref}
                        type="text"
                        required
                        aria-required="true"
                        maxLength={100}
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        onBlur={() => handleBlur('lastName')}
                        disabled={locked}
                        placeholder={t('onboarding.individual.lastName.placeholder', locale)}
                        aria-invalid={touched.lastName && !!errors.lastName}
                        aria-describedby={
                          touched.lastName && errors.lastName ? 'lastName-error' : undefined
                        }
                      />
                      {touched.lastName && errors.lastName && (
                        <p id="lastName-error" className="text-sm text-destructive" role="alert">
                          {errors.lastName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="grid min-w-0 gap-x-4 gap-y-3 min-[380px]:grid-cols-2">
                    {/* National ID */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="nationalId">
                        {t('onboarding.individual.nationalId', locale)}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <Input
                        id="nationalId"
                        dir="ltr"
                        ref={form.register('nationalId').ref}
                        type="text"
                        inputMode="numeric"
                        required
                        aria-required="true"
                        maxLength={10}
                        value={nationalId}
                        onChange={(e) => {
                          const val = normalizeProfileDigits(e.target.value)
                            .replace(/\D/g, '')
                            .slice(0, 10);
                          setNationalId(val);
                        }}
                        onBlur={() => handleBlur('nationalId')}
                        disabled={locked}
                        placeholder={t('onboarding.individual.nationalId.placeholder', locale)}
                        aria-invalid={touched.nationalId && !!errors.nationalId}
                        aria-describedby={
                          touched.nationalId && errors.nationalId ? 'nationalId-error' : undefined
                        }
                      />
                      {touched.nationalId && errors.nationalId && (
                        <p id="nationalId-error" className="text-sm text-destructive" role="alert">
                          {errors.nationalId}
                        </p>
                      )}
                    </div>
                    {/* Title (optional) */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="title">
                        {t('onboarding.individual.title.label', locale)}
                      </Label>
                      <Input
                        id="title"
                        autoComplete="honorific-prefix"
                        ref={form.register('title').ref}
                        type="text"
                        maxLength={50}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onBlur={() => handleBlur('title')}
                        disabled={locked}
                        placeholder={t('onboarding.individual.title.placeholder', locale)}
                        aria-invalid={touched.title && !!errors.title}
                        aria-describedby={touched.title && errors.title ? 'title-error' : undefined}
                      />
                      {touched.title && errors.title && (
                        <p id="title-error" className="text-sm text-destructive" role="alert">
                          {errors.title}
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.address', locale),
              fields: ['provinceId', 'cityId', 'fullAddress', 'postalCode'],
              content: (
                <>
                  {' '}
                  {/* Province / City */}
                  <div className="grid min-w-0 gap-x-4 gap-y-3 min-[380px]:grid-cols-2">
                    {/* Province */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="provinceId">
                        {t('onboarding.individual.province', locale)}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <GeographyPicker
                        kind="province"
                        locale={locale}
                        id="provinceId"
                        inputRef={form.register('provinceId').ref}
                        selected={selectedProvinceId}
                        options={provinces}
                        onChange={(id) => {
                          if (id === selectedProvinceId) return;
                          setSelectedProvinceId(id);
                          setSelectedCityId('');
                        }}
                        onBlur={() => handleBlur('provinceId')}
                        disabled={locked || !provinceOptions.ready}
                        loading={provinceOptions.loading}
                        aria-invalid={touched.provinceId && !!errors.provinceId}
                        aria-describedby={
                          touched.provinceId && errors.provinceId ? 'provinceId-error' : undefined
                        }
                      />
                      {touched.provinceId && errors.provinceId && (
                        <p id="provinceId-error" className="text-sm text-destructive" role="alert">
                          {errors.provinceId}
                        </p>
                      )}
                    </div>

                    {/* City */}
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="cityId">
                        {t('onboarding.individual.city', locale)}
                        <span aria-hidden="true" className="text-destructive ms-0.5">
                          *
                        </span>
                      </Label>
                      <GeographyPicker
                        key={selectedProvinceId}
                        kind="city"
                        locale={locale}
                        id="cityId"
                        inputRef={form.register('cityId').ref}
                        selected={selectedCityId}
                        options={cities}
                        disabled={locked || !cityOptions.ready}
                        loading={cityOptions.loading}
                        hasProvince={!!selectedProvinceId}
                        onChange={setSelectedCityId}
                        onBlur={() => handleBlur('cityId')}
                        aria-invalid={touched.cityId && !!errors.cityId}
                        aria-describedby={
                          touched.cityId && errors.cityId ? 'cityId-error' : undefined
                        }
                      />
                      <GeographyLoadError
                        {...cityOptions}
                        message={t('onboarding.individual.error.loadCities', locale)}
                        locale={locale}
                        testId="onboarding-cities-retry"
                      />
                      {touched.cityId && errors.cityId && (
                        <p id="cityId-error" className="text-sm text-destructive" role="alert">
                          {errors.cityId}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Full Address */}
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="fullAddress">
                      {t('onboarding.individual.address', locale)}
                      <span aria-hidden="true" className="text-destructive ms-0.5">
                        *
                      </span>
                    </Label>
                    <Textarea
                      id="fullAddress"
                      ref={form.register('fullAddress').ref}
                      required
                      aria-required="true"
                      maxLength={500}
                      rows={2}
                      value={fullAddress}
                      onChange={(e) => setFullAddress(e.target.value)}
                      onBlur={() => handleBlur('fullAddress')}
                      disabled={locked}
                      placeholder={t('onboarding.individual.address.placeholder', locale)}
                      className="min-h-14"
                      aria-invalid={touched.fullAddress && !!errors.fullAddress}
                      aria-describedby={
                        touched.fullAddress && errors.fullAddress ? 'fullAddress-error' : undefined
                      }
                    />
                    <p className="text-end text-xs text-muted-foreground">
                      {numbers.number(fullAddress.length)}/{numbers.number(500)}
                    </p>
                    {touched.fullAddress && errors.fullAddress && (
                      <p id="fullAddress-error" className="text-sm text-destructive" role="alert">
                        {errors.fullAddress}
                      </p>
                    )}
                  </div>
                  {/* Postal Code */}
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="postalCode">
                      {t('onboarding.individual.postalCode', locale)}
                      <span aria-hidden="true" className="text-destructive ms-0.5">
                        *
                      </span>
                    </Label>
                    <Input
                      id="postalCode"
                      dir="ltr"
                      autoComplete="postal-code"
                      className="max-w-[16rem]"
                      ref={form.register('postalCode').ref}
                      type="text"
                      inputMode="numeric"
                      required
                      aria-required="true"
                      maxLength={10}
                      value={postalCode}
                      onChange={(e) => {
                        const val = normalizeProfileDigits(e.target.value)
                          .replace(/\D/g, '')
                          .slice(0, 10);
                        setPostalCode(val);
                      }}
                      onBlur={() => handleBlur('postalCode')}
                      disabled={locked}
                      placeholder={t('onboarding.individual.postalCode.placeholder', locale)}
                      aria-invalid={touched.postalCode && !!errors.postalCode}
                      aria-describedby={
                        touched.postalCode && errors.postalCode ? 'postalCode-error' : undefined
                      }
                    />
                    {touched.postalCode && errors.postalCode && (
                      <p id="postalCode-error" className="text-sm text-destructive" role="alert">
                        {errors.postalCode}
                      </p>
                    )}
                  </div>
                </>
              ),
            },
            {
              label: t('onboarding.wizard.review', locale),
              content: ({ onEdit, disabled }) => (
                <OnboardingReview
                  onEdit={onEdit}
                  disabled={disabled}
                  sectionTitles={['identity', 'address'].map((key) =>
                    t(`onboarding.wizard.${key}`, locale)
                  )}
                  rows={[
                    {
                      step: 1,
                      label: t('onboarding.individual.title.label', locale),
                      value: title,
                    },
                    {
                      step: 1,
                      label: t('onboarding.individual.firstName', locale),
                      value: firstName,
                    },
                    {
                      step: 1,
                      label: t('onboarding.individual.lastName', locale),
                      value: lastName,
                    },
                    {
                      step: 1,
                      label: t('onboarding.individual.nationalId', locale),
                      value: nationalId,
                    },
                    {
                      step: 2,
                      label: t('onboarding.individual.province', locale),
                      value:
                        (isRtl
                          ? provinces.find((p) => p.id === selectedProvinceId)?.nameFa
                          : provinces.find((p) => p.id === selectedProvinceId)?.nameEn) ?? '',
                    },
                    {
                      step: 2,
                      label: t('onboarding.individual.city', locale),
                      value:
                        (isRtl
                          ? cities.find((p) => p.id === selectedCityId)?.nameFa
                          : cities.find((p) => p.id === selectedCityId)?.nameEn) ?? '',
                    },
                    {
                      step: 2,
                      label: t('onboarding.individual.address', locale),
                      value: fullAddress,
                      fullWidth: true,
                    },
                    {
                      step: 2,
                      label: t('onboarding.individual.postalCode', locale),
                      value: postalCode,
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
