import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';

import { LegalProfileDocuments } from '../../../components/LegalProfileDocuments.js';
import { useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { t, type Locale } from '@barghsa/i18n/crm';
import {
  UserIcon,
  Building2Icon,
  MapPinIcon,
  LockIcon,
  AlertCircleIcon,
  SaveIcon,
  PencilIcon,
  Loader2Icon,
  BadgeCheckIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import {
  Button,
  DependentSelect,
  Input,
  Label,
  Alert,
  AlertTitle,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { Form, FormField, FormItem, FormControl, FormMessage } from '@barghsa/ui/form';
import { useProfileSettingsEditor } from '../../../hooks/useProfileSettingsEditor.js';
import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/settings/profile')({
  component: SettingsProfilePage,
});

// ─── Types ────────────────────────────────────────────────────────────

// ─── Helpers ──────────────────────────────────────────────────────────

function getStatusBadge(status: string, locale: Locale): { label: string; variant: string } {
  switch (status) {
    case 'VERIFIED':
      return {
        label: locale === 'fa' ? 'تأیید شده' : 'Verified',
        variant: 'bg-success-soft text-success dark:bg-green-900/30 dark:text-green-400',
      };
    case 'ACTIVE':
      return {
        label: locale === 'fa' ? 'فعال' : 'Active',
        variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      };
    case 'PENDING_VERIFICATION':
      return {
        label: t('crm.list.PENDING_VERIFICATION', locale),
        variant: 'bg-warning-soft text-warning dark:bg-yellow-900/30 dark:text-yellow-400',
      };
    case 'DRAFT':
      return {
        label: locale === 'fa' ? 'پیش‌نویس' : 'Draft',
        variant: 'bg-warning-soft text-warning dark:bg-yellow-900/30 dark:text-yellow-400',
      };
    case 'SUSPENDED':
      return {
        label: locale === 'fa' ? 'مسدود' : 'Suspended',
        variant: 'bg-danger-soft text-destructive dark:bg-red-900/30 dark:text-red-400',
      };
    default:
      return { label: status, variant: 'bg-muted text-foreground' };
  }
}

// ─── Page Component ────────────────────────────────────────────────────

function ProfileFieldHint({ locked = false, locale }: { locked?: boolean; locale: Locale }) {
  if (!locked)
    return <PencilIcon aria-hidden="true" className="ms-1 inline size-3 text-muted-foreground" />;
  const description = t('settings.profile.identityLocked', locale);
  // Native hover hint; the same explanation remains visible below the field.
  return (
    <button
      type="button"
      aria-label={description}
      title={description}
      className="ms-1 inline-flex rounded focus-visible:outline focus-visible:outline-2"
    >
      <LockIcon aria-hidden="true" className="size-3 text-muted-foreground" />
    </button>
  );
}

function SettingsProfilePage() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    editor = useProfileSettingsEditor(locale);
  const {
    profile,
    loading,
    error,
    denied,
    confirmOpen,
    defaultProfileId,
    availableProfiles,
    defaultError,
    form,
    feedback,
    command,
    locked,
    copy,
    provinceOptions,
    cityOptions,
    fetchProfile,
    documentsDenied,
    changeDefault,
    prepareSave,
    change,
    cancelConfirmation,
    resetCapture,
  } = editor;
  const {
    title,
    firstName,
    lastName,
    nationalId,
    provinceId,
    cityId,
    legalName,
    nationalIdentifier,
    fullAddress,
    postalCode,
  } = editor.values;
  const saving = command.busy || form.formState.isSubmitting;
  const saveButton = useRef<HTMLButtonElement>(null);
  const provinces = provinceOptions.options,
    cities = cityOptions.options,
    loadingProvinces = provinceOptions.loading,
    provinceError = provinceOptions.error,
    cityError = cityOptions.error;
  function recovery() {
    return (
      command.phase !== 'ready' && (
        <div role="alert" className="space-y-2">
          <p>
            {copy(command.error === 'confirmationMismatch' ? 'confirmationMismatch' : 'uncertain')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-settings-recovery
              disabled={command.busy}
              onClick={() =>
                void (command.phase === 'confirmation'
                  ? command.refreshConfirmation()
                  : command.send())
              }
            >
              {copy(command.phase === 'confirmation' ? 'refreshConfirmation' : 'retryOriginal')}
            </Button>
            <Button
              type="button"
              data-settings-recovery
              variant="outline"
              disabled={command.busy}
              onClick={resetCapture}
            >
              {copy('resetCapture')}
            </Button>
          </div>
        </div>
      )
    );
  }
  // ── Render ──────────────────────────────────────────────────────────

  const isIdentityLocked =
    profile?.profileType === 'LEGAL' ||
    (profile?.status === 'VERIFIED' && profile.canEditIdentity !== true);
  const isLegal = profile?.profileType === 'LEGAL';
  const savedMainAddress = profile?.addresses.find((address) => address.mainAddress);

  return (
    <div
      className="container mx-auto max-w-2xl py-8 px-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onClickCapture={(event) => {
        if (
          command.coordination.isLocked() &&
          !(
            event.target instanceof Element &&
            event.target.closest('[data-settings-recovery], [data-settings-confirm]')
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onAuxClickCapture={(event) => {
        if (command.coordination.isLocked()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onChangeCapture={(event) => {
        if (command.coordination.isLocked()) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {/* Title */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings.profile.title', locale)}</h1>
      </div>

      {availableProfiles.length > 0 && (
        <section aria-labelledby="default-profile-title" className="mb-6 rounded-lg border p-4">
          <h2 id="default-profile-title" className="mb-3 text-base font-semibold">
            <label htmlFor="settings-profile-switcher">
              {t('dashboard.profile.default.title', locale)}
            </label>
          </h2>
          <select
            id="settings-profile-switcher"
            value={defaultProfileId ?? ''}
            onChange={(event) => void changeDefault(event.target.value)}
            disabled={loading || locked}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          >
            {!defaultProfileId && (
              <option value="" disabled>
                {t('dashboard.profile.choose', locale)}
              </option>
            )}
            {availableProfiles.map((item) => (
              <option key={item.id} value={item.id}>
                {[item.title, item.firstName, item.lastName].filter(Boolean).join(' ') ||
                  t('dashboard.profile.unnamed', locale)}
              </option>
            ))}
          </select>
          {defaultError && <p role="alert">{defaultError}</p>}
          {command.locked === 'default' && recovery()}
        </section>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <UserIcon className="mx-auto h-6 w-6 animate-pulse mb-2" />
          <p className="text-sm">{t('settings.profile.loading', locale)}</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="h-4 w-4" />
          <AlertTitle>{t('settings.security.error.title', locale)}</AlertTitle>
          <AlertDescription>
            {error}
            {!denied && (
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => void fetchProfile(true)}
              >
                {copy('refreshProfile')}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Profile detail form */}
      {!loading && profile && (
        <Form {...form}>
          <form
            ref={feedback.element}
            data-slot="settings-profile-form"
            noValidate
            aria-label={t('settings.profile.save', locale)}
            onSubmit={(event) => void prepareSave(event)}
            className="space-y-8"
          >
            {/* Profile type and status header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isLegal ? (
                  <Building2Icon className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <UserIcon className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">
                  {isLegal
                    ? t('settings.profile.profileType.LEGAL', locale)
                    : t('settings.profile.profileType.INDIVIDUAL', locale)}
                </span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                  getStatusBadge(profile.status, locale).variant
                }`}
              >
                {profile.status === 'VERIFIED' && <BadgeCheckIcon className="h-3.5 w-3.5" />}
                {profile.status === 'SUSPENDED' && <ShieldAlertIcon className="h-3.5 w-3.5" />}
                {getStatusBadge(profile.status, locale).label}
              </span>
            </div>

            {/* Legal entity identity */}
            {isLegal && profile.legalInfo && (
              <div className="rounded-lg border p-4 space-y-3">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Building2Icon className="h-4 w-4" />
                  {t('settings.profile.legalName', locale)}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="profile-legalName" className="text-xs text-muted-foreground">
                      {t('settings.profile.legalName', locale)}
                    </Label>
                    <ProfileFieldHint locked={profile.status === 'VERIFIED'} locale={locale} />
                    <FormField
                      control={form.control}
                      name="legalName"
                      render={({ field }) => (
                        <FormItem id="profile-legalName">
                          <FormControl>
                            <Input
                              {...field}
                              id="profile-legalName"
                              value={legalName}
                              onChange={(event) => change('legalName', event.target.value)}
                              disabled={locked || profile.status === 'VERIFIED'}
                            />
                          </FormControl>
                          <FormMessage reserveSpace />
                        </FormItem>
                      )}
                    />
                    {profile.status === 'VERIFIED' && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.profile.identityLocked', locale)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label
                      htmlFor="profile-nationalIdentifier"
                      className="text-xs text-muted-foreground"
                    >
                      {t('settings.profile.nationalIdentifier', locale)}
                    </Label>
                    <ProfileFieldHint locked={profile.status === 'VERIFIED'} locale={locale} />
                    <FormField
                      control={form.control}
                      name="nationalIdentifier"
                      render={({ field }) => (
                        <FormItem id="profile-nationalIdentifier">
                          <FormControl>
                            <Input
                              {...field}
                              id="profile-nationalIdentifier"
                              value={nationalIdentifier}
                              onChange={(event) => change('nationalIdentifier', event.target.value)}
                              disabled={locked || profile.status === 'VERIFIED'}
                            />
                          </FormControl>
                          <FormMessage reserveSpace />
                        </FormItem>
                      )}
                    />
                    {profile.status === 'VERIFIED' && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.profile.identityLocked', locale)}
                      </p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">
                      {locale === 'fa' ? 'شماره ثبت' : 'Registration No.'}
                    </Label>
                    <p className="text-sm font-medium">{profile.legalInfo.registrationNumber}</p>
                  </div>
                </div>
              </div>
            )}

            {isLegal && profile.legalInfo && (
              <dl className="grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2">
                {(
                  [
                    'representativeFirstName',
                    'representativeLastName',
                    'representativeNationalId',
                    'representativeFullAddress',
                    'representativePostalCode',
                  ] as const
                ).map((field) => (
                  <div key={field}>
                    <dt className="text-xs text-muted-foreground">
                      {t(`onboarding.legal.${field}`, locale)}
                    </dt>
                    <dd>
                      {profile.legalInfo?.[field] || t('settings.profile.notProvided', locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {isLegal && (
              <LegalProfileDocuments
                profileId={profile.id}
                disabled={locked}
                canInteract={() => !command.coordination.isLocked()}
                onAccessDenied={() => documentsDenied(profile.id)}
              />
            )}

            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-title" className="text-xs">
                {t('settings.profile.title.label', locale)}
              </Label>
              <ProfileFieldHint locale={locale} />
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem id="profile-title">
                    <FormControl>
                      <Input
                        {...field}
                        id="profile-title"
                        disabled={locked}
                        placeholder={t('settings.profile.title.placeholder', locale)}
                        value={title}
                        onChange={(e) => change('title', e.target.value)}
                        className="text-sm"
                      />
                    </FormControl>
                    <FormMessage reserveSpace />
                  </FormItem>
                )}
              />
            </div>

            {/* Identity section */}
            {!isLegal && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <UserIcon className="h-4 w-4" />
                      {t('settings.profile.identitySection', locale)}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('settings.profile.identityDescription', locale)}
                    </p>
                  </div>
                  {isIdentityLocked && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                      <LockIcon className="h-3 w-3" />
                      {locale === 'fa' ? 'تأیید شده' : 'Verified'}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* First name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-first-name" className="text-xs">
                      {t('settings.profile.firstName', locale)}
                    </Label>
                    <ProfileFieldHint locked={isIdentityLocked} locale={locale} />
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem id="profile-first-name">
                          <FormControl>
                            <Input
                              {...field}
                              id="profile-first-name"
                              value={firstName}
                              onChange={(e) => change('firstName', e.target.value)}
                              disabled={locked || isIdentityLocked}
                              className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
                            />
                          </FormControl>
                          <FormMessage reserveSpace />
                        </FormItem>
                      )}
                    />
                    {isIdentityLocked && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.profile.identityLocked', locale)}
                      </p>
                    )}
                  </div>

                  {/* Last name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-last-name" className="text-xs">
                      {t('settings.profile.lastName', locale)}
                    </Label>
                    <ProfileFieldHint locked={isIdentityLocked} locale={locale} />
                    <FormField
                      control={form.control}
                      name="lastName"
                      render={({ field }) => (
                        <FormItem id="profile-last-name">
                          <FormControl>
                            <Input
                              {...field}
                              id="profile-last-name"
                              value={lastName}
                              onChange={(e) => change('lastName', e.target.value)}
                              disabled={locked || isIdentityLocked}
                              className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
                            />
                          </FormControl>
                          <FormMessage reserveSpace />
                        </FormItem>
                      )}
                    />
                    {isIdentityLocked && (
                      <p className="text-xs text-muted-foreground">
                        {t('settings.profile.identityLocked', locale)}
                      </p>
                    )}
                  </div>
                </div>

                {/* National ID (full width) */}
                <div className="space-y-1.5 max-w-sm">
                  <Label htmlFor="profile-national-id" className="text-xs">
                    {t('settings.profile.nationalId', locale)}
                  </Label>
                  <ProfileFieldHint locked={isIdentityLocked} locale={locale} />
                  <FormField
                    control={form.control}
                    name="nationalId"
                    render={({ field }) => (
                      <FormItem id="profile-national-id">
                        <FormControl>
                          <Input
                            {...field}
                            id="profile-national-id"
                            value={nationalId}
                            onChange={(e) => change('nationalId', e.target.value)}
                            disabled={locked || isIdentityLocked}
                            className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
                          />
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                  {isIdentityLocked && (
                    <p className="text-xs text-muted-foreground">
                      {t('settings.profile.identityLocked', locale)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Address section */}
            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <MapPinIcon className="h-4 w-4" />
                  {t('settings.profile.addressSection', locale)}
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings.profile.addressDescription', locale)}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Province */}
                <div className="space-y-1.5">
                  <Label htmlFor="profile-province" className="text-xs">
                    {t('settings.profile.province', locale)}
                  </Label>
                  <ProfileFieldHint locale={locale} />
                  <FormField
                    control={form.control}
                    name="provinceId"
                    render={({ field }) => (
                      <FormItem id="profile-province">
                        <FormControl>
                          <select
                            {...field}
                            id="profile-province"
                            value={provinceId}
                            onChange={(event) => {
                              change('provinceId', event.target.value);
                              change('cityId', '');
                            }}
                            disabled={locked || saving || loadingProvinces || provinceError}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            <option value="">{t('settings.profile.selectProvince', locale)}</option>
                            {provinceId && !provinces.some((item) => item.id === provinceId) && (
                              <option value={provinceId}>
                                {(savedMainAddress?.provinceId === provinceId &&
                                  (locale === 'fa'
                                    ? savedMainAddress.provinceNameFa
                                    : savedMainAddress.provinceNameEn)) ||
                                  t('settings.addresses.unknownProvince', locale)}
                              </option>
                            )}
                            {provinces.map((item) => (
                              <option key={item.id} value={item.id}>
                                {locale === 'fa' ? item.nameFa : item.nameEn}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                </div>

                {/* City */}
                <div className="space-y-1.5">
                  <Label htmlFor="profile-city" className="text-xs">
                    {t('settings.profile.city', locale)}
                  </Label>
                  <ProfileFieldHint locale={locale} />
                  <FormField
                    control={form.control}
                    name="cityId"
                    render={({ field }) => (
                      <FormItem id="profile-city">
                        <FormControl>
                          <DependentSelect
                            {...field}
                            id="profile-city"
                            dependencyValue={provinceId}
                            value={cityId}
                            ready={cityOptions.ready}
                            loading={cityOptions.loading}
                            options={cities.map((city) => ({
                              value: city.id,
                              label: locale === 'fa' ? city.nameFa : city.nameEn,
                              dependencyValue: city.provinceId ?? '',
                            }))}
                            placeholder={t('settings.profile.selectCity', locale)}
                            savedOption={{
                              value: savedMainAddress?.cityId ?? '',
                              dependencyValue: savedMainAddress?.provinceId ?? '',
                              label:
                                (locale === 'fa'
                                  ? savedMainAddress?.cityNameFa
                                  : savedMainAddress?.cityNameEn) ||
                                t('settings.addresses.unknownCity', locale),
                            }}
                            onChange={(event) => {
                              change('cityId', event.target.value);
                            }}
                            disabled={locked || saving}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {(provinceError || cityError) && (
                <div role="alert">
                  <p>
                    {t(
                      provinceError
                        ? 'settings.addresses.error.loadProvinces'
                        : 'settings.addresses.error.loadCities',
                      locale
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked}
                    onClick={() => {
                      if (!command.coordination.isLocked())
                        (provinceError ? provinceOptions.retry : cityOptions.retry)();
                    }}
                  >
                    {t('settings.addresses.retry', locale)}
                  </Button>
                </div>
              )}

              {/* Full address */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-address" className="text-xs">
                  {t('settings.profile.fullAddress', locale)}
                </Label>
                <ProfileFieldHint locale={locale} />
                <FormField
                  control={form.control}
                  name="fullAddress"
                  render={({ field }) => (
                    <FormItem id="profile-address">
                      <FormControl>
                        <textarea
                          {...field}
                          id="profile-address"
                          disabled={locked}
                          value={fullAddress}
                          onChange={(e) => change('fullAddress', e.target.value)}
                          maxLength={500}
                          rows={3}
                          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          dir={locale === 'fa' ? 'rtl' : 'ltr'}
                        />
                      </FormControl>
                      <FormMessage reserveSpace />
                    </FormItem>
                  )}
                />
              </div>

              {/* Postal code */}
              <div className="space-y-1.5 max-w-sm">
                <Label htmlFor="profile-postal-code" className="text-xs">
                  {t('settings.profile.postalCode', locale)}
                </Label>
                <ProfileFieldHint locale={locale} />
                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem id="profile-postal-code">
                      <FormControl>
                        <Input
                          {...field}
                          id="profile-postal-code"
                          disabled={locked}
                          value={postalCode}
                          onChange={(e) => change('postalCode', e.target.value)}
                          className="text-sm"
                        />
                      </FormControl>
                      <FormMessage reserveSpace />
                    </FormItem>
                  )}
                />
              </div>

              {/* Address history */}
              {profile.addresses.length > 1 && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">
                    {locale === 'fa'
                      ? `تعداد کل آدرس‌ها: ${numbers.number(profile.addresses.length)}`
                      : `Total addresses: ${numbers.number(profile.addresses.length)}`}
                  </p>
                </div>
              )}
            </div>

            {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => void fetchProfile(true)}
              >
                {copy('refreshProfile')}
              </Button>
              <Button ref={saveButton} type="submit" disabled={locked} className="gap-2">
                {form.formState.isSubmitting ? (
                  <Loader2Icon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                {t('settings.profile.save', locale)}
              </Button>
            </div>
            <Dialog
              open={confirmOpen}
              onOpenChange={(open) => {
                if (!open) cancelConfirmation();
              }}
            >
              <DialogContent
                finalFocus={() => {
                  const name = Object.keys(form.formState.errors).find((key) => key !== 'root');
                  const field = name ? feedback.element.current?.elements.namedItem(name) : null;
                  return field instanceof HTMLElement ? field : saveButton.current;
                }}
                showCloseButton={false}
                dir={locale === 'fa' ? 'rtl' : 'ltr'}
              >
                <DialogHeader>
                  <DialogTitle>{t('crm.profile.edit.confirm.title', locale)}</DialogTitle>
                  <DialogDescription>
                    {t('crm.profile.edit.confirm.message', locale)}
                  </DialogDescription>
                </DialogHeader>
                {command.phase !== 'ready'
                  ? recovery()
                  : command.error && (
                      <Alert variant="destructive">
                        <AlertDescription>{copy('error')}</AlertDescription>
                      </Alert>
                    )}
                <DialogFooter>
                  <Button
                    type="button"
                    data-settings-confirm
                    variant="outline"
                    disabled={command.busy || command.phase !== 'ready'}
                    onClick={cancelConfirmation}
                  >
                    {t('crm.profile.edit.cancel', locale)}
                  </Button>
                  <Button
                    type="button"
                    data-settings-confirm
                    disabled={command.busy || command.phase !== 'ready'}
                    onClick={() => void command.send()}
                  >
                    {saving && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                    {t(command.busy ? 'settings.profile.saving' : 'settings.profile.save', locale)}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </form>
        </Form>
      )}
    </div>
  );
}
