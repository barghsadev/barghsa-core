import { Skeleton } from '@barghsa/ui';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

import { LegalProfileDocuments } from '../components/LegalProfileDocuments.js';
import { useRef } from 'react';
import { Link } from '@tanstack/react-router';

import { t, type Locale } from '@barghsa/i18n/crm';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { LockIcon, AlertCircleIcon, Loader2Icon } from 'lucide-react';
import {
  Button,
  buttonVariants,
  NativeSelect,
  ListRefreshButton,
  Textarea,
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
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormDescription,
  FormMessage,
} from '@barghsa/ui/form';
import { useProfileSettingsEditor } from '../hooks/useProfileSettingsEditor.js';
import { useLocale } from '../hooks/useLocale.js';
import { addressesText } from '@barghsa/i18n/addresses';
import { stripPostalCodeSeparators } from '../lib/profile-digits.js';
import { RecordEditorSection, recordEditorGrid } from '../components/RecordEditorLayout.js';
import { GeographyPicker } from '../components/GeographyPicker.js';
import {
  keepRecordFieldVisible,
  recordEditorFormSurface,
  StickyRecordEditorActions,
} from '../components/StickyRecordEditorActions.js';
import { profileCanEditIdentity } from '../lib/settings-form.js';

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

function LockedProfileIdentity({
  entries,
  locale,
}: {
  entries: ReadonlyArray<readonly [string, string | null | undefined]>;
  locale: Locale;
}) {
  return (
    <div
      data-slot="profile-locked-identity"
      className="space-y-3 rounded-lg bg-muted/50 px-3 py-3 text-sm"
    >
      <p className="flex items-start gap-2 text-muted-foreground">
        <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {tSettingsForms('verifiedIdentity', locale)}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3 sm:grid-cols-3">
        {entries.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">
              <bdi>{value?.trim() || t('settings.profile.notProvided', locale)}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SettingsProfilePage({ edit = true }: { edit?: boolean } = {}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    editor = useProfileSettingsEditor(locale, edit);
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
    addressRequired,
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

  const isLegal = profile?.profileType === 'LEGAL';
  const isIdentityLocked =
    !!profile && (isLegal ? profile.status === 'VERIFIED' : !profileCanEditIdentity(profile));
  const savedMainAddress = profile?.addresses.find((address) => address.mainAddress);
  const displayName =
    profile?.displayName?.trim() ||
    profile?.title?.trim() ||
    (isLegal
      ? profile?.legalInfo?.legalName
      : [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')) ||
    t('dashboard.profile.unnamed', locale);
  const profileType = t(`settings.profile.profileType.${isLegal ? 'LEGAL' : 'INDIVIDUAL'}`, locale);
  const badge = profile ? getStatusBadge(profile.status, locale) : null;

  const defaultProfileControl = availableProfiles.length > 0 && (
    <section aria-labelledby="default-profile-title" className="rounded-xl border bg-card p-4">
      <h2 id="default-profile-title" className="mb-3 text-base font-semibold">
        <label htmlFor="settings-profile-switcher">
          {t('dashboard.profile.default.title', locale)}
        </label>
      </h2>
      <NativeSelect
        id="settings-profile-switcher"
        value={defaultProfileId ?? ''}
        onChange={(event) => void changeDefault(event.target.value)}
        disabled={loading || locked}
        className="w-full"
      >
        {!defaultProfileId && (
          <option value="" disabled>
            {t('dashboard.profile.choose', locale)}
          </option>
        )}
        {availableProfiles.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName?.trim() ||
              [item.title, item.firstName, item.lastName].filter(Boolean).join(' ') ||
              t('dashboard.profile.unnamed', locale)}
          </option>
        ))}
      </NativeSelect>
      {defaultError && <p role="alert">{defaultError}</p>}
      {command.locked === 'default' && recovery()}
    </section>
  );

  return (
    <div
      className="mx-auto max-w-2xl min-w-0 space-y-4"
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {edit && (
            <Link className="text-sm text-primary hover:underline" to="/settings/profile">
              {t('settings.profile.title', locale)}
            </Link>
          )}
          <h1 className="break-words text-2xl font-semibold">
            {edit ? (
              copy('editProfile')
            ) : profile ? (
              <bdi>{displayName}</bdi>
            ) : (
              t('settings.profile.title', locale)
            )}
          </h1>
          {profile && badge && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {edit && <bdi className="font-medium">{displayName}</bdi>}
              <span className="text-muted-foreground">{profileType}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${badge.variant}`}>
                {badge.label}
              </span>
            </div>
          )}
        </div>
        {!edit && !loading && profile && !denied && (
          <Link
            to="/settings/profile/edit"
            disabled={locked}
            className={buttonVariants({ className: 'min-h-11' })}
          >
            {copy('editProfile')}
          </Link>
        )}
      </header>

      {!edit && defaultProfileControl}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <Skeleton className="h-6 w-20 shrink-0" />
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
      {!edit && !loading && profile && (
        <div className="space-y-4">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">{t('settings.profile.identitySection', locale)}</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">{copy('profileName')}</dt>
                <dd className="break-words font-medium">
                  <bdi>{displayName}</bdi>
                </dd>
              </div>
              {isLegal && profile.legalInfo?.legalName && (
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t('settings.profile.legalName', locale)}
                  </dt>
                  <dd className="break-words font-medium">
                    <bdi>{profile.legalInfo.legalName}</bdi>
                  </dd>
                </div>
              )}
            </dl>
            {isIdentityLocked && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {copy('verifiedIdentity')}
              </p>
            )}
          </section>
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="font-semibold">{t('settings.profile.addressSection', locale)}</h2>
            {savedMainAddress && (
              <p className="break-words text-sm">
                <bdi>{savedMainAddress.fullAddress}</bdi>
              </p>
            )}
            <Link
              to="/settings/addresses"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('settings.addresses.title', locale)}
            </Link>
          </section>
          {isLegal && (
            <Link
              to="/documents"
              className="block w-fit text-sm font-medium text-primary hover:underline"
            >
              {copy('viewDocuments')}
            </Link>
          )}
        </div>
      )}
      {edit && !loading && profile && (
        <Form {...form}>
          <form
            ref={feedback.element}
            data-slot="settings-profile-form"
            noValidate
            aria-label={t('settings.profile.save', locale)}
            onSubmit={(event) => void prepareSave(event)}
            onFocus={keepRecordFieldVisible}
            className={`${recordEditorFormSurface} [&_[data-slot=form-message]]:min-h-4 [&_[data-slot=form-message]]:text-xs [&_[data-slot=form-message]]:leading-4`}
          >
            <RecordEditorSection title={copy('profileDetails')}>
              <div className="max-w-xs space-y-1">
                <Label htmlFor="profile-title" className="text-xs">
                  {t('settings.profile.title.label', locale)}
                </Label>

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
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </RecordEditorSection>

            {/* Legal entity identity */}
            {isLegal && profile.legalInfo && (
              <RecordEditorSection title={copy('companyDetails')}>
                {isIdentityLocked ? (
                  <LockedProfileIdentity
                    locale={locale}
                    entries={[
                      [t('settings.profile.legalName', locale), profile.legalInfo.legalName],
                      [
                        t('settings.profile.nationalIdentifier', locale),
                        profile.legalInfo.nationalIdentifier,
                      ],
                      [copy('registrationNumber'), profile.legalInfo.registrationNumber],
                    ]}
                  />
                ) : (
                  <>
                    <div className={recordEditorGrid}>
                      <div className="space-y-1.5">
                        <Label htmlFor="profile-legalName" className="text-xs">
                          {t('settings.profile.legalName', locale)}
                        </Label>

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
                                  disabled={locked}
                                />
                              </FormControl>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="profile-nationalIdentifier" className="text-xs">
                          {t('settings.profile.nationalIdentifier', locale)}
                        </Label>

                        <FormField
                          control={form.control}
                          name="nationalIdentifier"
                          render={({ field }) => (
                            <FormItem id="profile-nationalIdentifier" className="max-w-xs">
                              <FormControl>
                                <Input
                                  {...field}
                                  id="profile-nationalIdentifier"
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={nationalIdentifier}
                                  onChange={(event) =>
                                    change('nationalIdentifier', event.target.value)
                                  }
                                  disabled={locked}
                                />
                              </FormControl>
                              <FormDescription className="text-xs">
                                {copy('nationalIdentifierHelp')}
                              </FormDescription>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    {profile.legalInfo.registrationNumber && (
                      <dl className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <dt className="text-muted-foreground">{copy('registrationNumber')}</dt>
                        <dd>
                          <bdi>{profile.legalInfo.registrationNumber}</bdi>
                        </dd>
                      </dl>
                    )}
                  </>
                )}
              </RecordEditorSection>
            )}

            {/* Identity section */}
            {!isLegal && (
              <RecordEditorSection
                title={t('settings.profile.identitySection', locale)}
                description={
                  isIdentityLocked ? '' : t('settings.profile.identityDescription', locale)
                }
              >
                {isIdentityLocked ? (
                  <LockedProfileIdentity
                    locale={locale}
                    entries={[
                      [t('settings.profile.firstName', locale), profile.firstName],
                      [t('settings.profile.lastName', locale), profile.lastName],
                      [t('settings.profile.nationalId', locale), profile.nationalId],
                    ]}
                  />
                ) : (
                  <>
                    <div className={recordEditorGrid}>
                      {/* First name */}
                      <div className="space-y-1.5">
                        <Label htmlFor="profile-first-name" className="text-xs">
                          {t('settings.profile.firstName', locale)}
                        </Label>

                        <FormField
                          control={form.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem id="profile-first-name">
                              <FormControl>
                                <Input
                                  {...field}
                                  id="profile-first-name"
                                  autoComplete="given-name"
                                  value={firstName}
                                  onChange={(e) => change('firstName', e.target.value)}
                                  disabled={locked}
                                  className="text-sm"
                                />
                              </FormControl>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Last name */}
                      <div className="space-y-1.5">
                        <Label htmlFor="profile-last-name" className="text-xs">
                          {t('settings.profile.lastName', locale)}
                        </Label>

                        <FormField
                          control={form.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem id="profile-last-name">
                              <FormControl>
                                <Input
                                  {...field}
                                  id="profile-last-name"
                                  autoComplete="family-name"
                                  value={lastName}
                                  onChange={(e) => change('lastName', e.target.value)}
                                  disabled={locked}
                                  className="text-sm"
                                />
                              </FormControl>
                              <FormMessage reserveSpace />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* National ID */}
                    <div className="space-y-1.5 max-w-xs">
                      <Label htmlFor="profile-national-id" className="text-xs">
                        {t('settings.profile.nationalId', locale)}
                      </Label>

                      <FormField
                        control={form.control}
                        name="nationalId"
                        render={({ field }) => (
                          <FormItem id="profile-national-id">
                            <FormControl>
                              <Input
                                {...field}
                                id="profile-national-id"
                                dir="ltr"
                                inputMode="numeric"
                                value={nationalId}
                                onChange={(e) => change('nationalId', e.target.value)}
                                disabled={locked}
                                className="text-sm"
                              />
                            </FormControl>
                            <FormDescription className="text-xs">
                              {copy('nationalIdHelp')}
                            </FormDescription>
                            <FormMessage reserveSpace />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}
              </RecordEditorSection>
            )}

            <RecordEditorSection
              title={t('settings.profile.addressSection', locale)}
              description={copy('mainAddressDescription')}
            >
              <div className={recordEditorGrid}>
                {/* Province */}
                <div className="space-y-1.5">
                  <Label htmlFor="profile-province" className="text-xs">
                    {t('settings.profile.province', locale)}
                  </Label>

                  <FormField
                    control={form.control}
                    name="provinceId"
                    render={({ field }) => (
                      <FormItem id="profile-province">
                        <FormControl>
                          <GeographyPicker
                            kind="province"
                            locale={locale}
                            id="profile-province"
                            options={provinces}
                            selected={provinceId}
                            savedLabel={
                              savedMainAddress?.provinceId === provinceId
                                ? (locale === 'fa'
                                    ? savedMainAddress?.provinceNameFa
                                    : savedMainAddress?.provinceNameEn) ||
                                  t('settings.addresses.unknownProvince', locale)
                                : undefined
                            }
                            required={addressRequired}
                            loading={provinceOptions.loading}
                            disabled={locked || saving || !provinceOptions.ready}
                            inputRef={field.ref}
                            onBlur={field.onBlur}
                            onChange={(id) => {
                              if (id === provinceId) return;
                              change('provinceId', id);
                              change('cityId', '');
                            }}
                          />
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

                  <FormField
                    control={form.control}
                    name="cityId"
                    render={({ field }) => (
                      <FormItem id="profile-city">
                        <FormControl>
                          <GeographyPicker
                            key={provinceId}
                            kind="city"
                            locale={locale}
                            id="profile-city"
                            options={cities}
                            selected={cityId}
                            hasProvince={!!provinceId}
                            required={addressRequired}
                            loading={cityOptions.loading}
                            savedLabel={
                              savedMainAddress?.provinceId === provinceId &&
                              savedMainAddress.cityId === cityId
                                ? (locale === 'fa'
                                    ? savedMainAddress.cityNameFa
                                    : savedMainAddress.cityNameEn) ||
                                  t('settings.addresses.unknownCity', locale)
                                : undefined
                            }
                            inputRef={field.ref}
                            onBlur={field.onBlur}
                            onChange={(id) => change('cityId', id)}
                            disabled={locked || saving || !cityOptions.ready}
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

                <FormField
                  control={form.control}
                  name="fullAddress"
                  render={({ field }) => (
                    <FormItem id="profile-address">
                      <FormControl>
                        <Textarea
                          {...field}
                          id="profile-address"
                          aria-required={addressRequired || undefined}
                          disabled={locked}
                          value={fullAddress}
                          onChange={(e) => change('fullAddress', e.target.value)}
                          maxLength={500}
                          rows={2}
                          autoComplete="street-address"
                          placeholder={addressesText('streetExample', locale)}
                          className="max-h-44 min-h-16 resize-y placeholder-shown:[direction:inherit]"
                          dir="auto"
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

                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem id="profile-postal-code" className="max-w-xs">
                      <FormControl>
                        <Input
                          {...field}
                          id="profile-postal-code"
                          dir="ltr"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          placeholder={t('settings.addresses.form.postalCodePlaceholder', locale)}
                          aria-required={addressRequired || undefined}
                          disabled={locked}
                          value={postalCode}
                          onChange={(e) =>
                            change('postalCode', stripPostalCodeSeparators(e.target.value))
                          }
                          className="text-sm"
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        {copy('postalCodeHelp')}
                      </FormDescription>
                      <FormMessage />
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
              {form.formState.errors.root && <p role="alert">{copy('validationUnavailable')}</p>}
            </RecordEditorSection>
            <StickyRecordEditorActions
              secondary={
                <ListRefreshButton
                  label={copy('refreshProfile')}
                  disabled={locked}
                  onClick={() => void fetchProfile(true)}
                />
              }
            >
              <Link
                to="/settings/profile"
                disabled={locked}
                className={buttonVariants({ variant: 'ghost' })}
              >
                {t('crm.profile.edit.cancel', locale)}
              </Link>
              <Button ref={saveButton} type="submit" loading={saving} disabled={locked}>
                {t('settings.profile.save', locale)}
              </Button>
            </StickyRecordEditorActions>
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
      {edit && !loading && profile && (
        <div className="space-y-3">
          {isLegal && profile.legalInfo && (
            <details className="rounded-xl border bg-card px-4 py-3">
              <summary className="cursor-pointer font-medium">
                {copy('representativeDetails')}
              </summary>
              <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
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
            </details>
          )}
          {isLegal && (
            <LegalProfileDocuments
              profileId={profile.id}
              disabled={locked}
              canInteract={() => !command.coordination.isLocked()}
              onAccessDenied={() => documentsDenied(profile.id)}
            />
          )}
        </div>
      )}
      {edit && defaultProfileControl}
    </div>
  );
}
