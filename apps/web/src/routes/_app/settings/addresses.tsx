import { useRef } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useSavedAddressSettingsEditor } from '../../../hooks/useSavedAddressSettingsEditor.js';
import type { SavedAddress as Address } from '../../../lib/settings-form.js';
import { t } from '@barghsa/i18n/app';
import { addressesText } from '@barghsa/i18n/addresses';
import {
  MapPinIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  StarIcon,
  Loader2Icon,
  XIcon,
} from 'lucide-react';
import {
  Button,
  DependentSelect,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Alert,
  AlertDescription,
} from '@barghsa/ui';

import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormInput,
  FormTextarea,
  FormSubmit,
} from '@barghsa/ui/form';

import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/settings/addresses')({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo:
      search.returnTo === '/electricity/advanced' || search.returnTo === '/solar/requests/new'
        ? search.returnTo
        : undefined,
  }),
  component: SettingsAddressesPage,
});

// ─── Page Component ────────────────────────────────────────────────────

function SettingsAddressesPage() {
  const locale = useLocale(),
    { returnTo } = Route.useSearch(),
    editor = useSavedAddressSettingsEditor(locale);
  const {
    addresses,
    loading,
    loadError,
    denied,
    profileId,
    showForm,
    editingAddress,
    deleteConfirmId,
    form,
    feedback,
    command,
    locked,
    saving,
    copy,
    formProvinceId,
    provinceOptions,
    cityOptions,
    fetchAddresses,
    openAddForm,
    openEditForm,
    closeForm,
    prepareSave,
    handleSetMain,
    confirmDelete,
    handleDelete,
  } = editor;
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null),
    cancelDeleteRef = useRef<HTMLButtonElement | null>(null),
    headingRef = useRef<HTMLHeadingElement | null>(null);
  const provinces = provinceOptions.options,
    cities = cityOptions.options;
  const historicalPair =
    !!editingAddress &&
    formProvinceId === editingAddress.provinceId &&
    form.watch('cityId') === editingAddress.cityId;
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
              onClick={() => command.resetCapture()}
            >
              {copy('resetCapture')}
            </Button>
          </div>
        </div>
      )
    );
  }
  // ── Helpers ────────────────────────────────────────────────────────

  const getProvinceName = (address: Address): string => {
    const province = provinces.find((item) => item.id === address.provinceId);
    return (
      (locale === 'fa'
        ? (address.provinceNameFa ?? province?.nameFa)
        : (address.provinceNameEn ?? province?.nameEn)) ??
      t('settings.addresses.unknownProvince', locale)
    );
  };

  const getCityName = (address: Address): string =>
    (locale === 'fa' ? address.cityNameFa : address.cityNameEn) ??
    t('settings.addresses.unknownCity', locale);

  // ── Render ─────────────────────────────────────────────────────────
  const deletingAddress = addresses.find((address) => address.id === deleteConfirmId);

  return (
    <div
      className="container mx-auto max-w-2xl py-8 px-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onClickCapture={(event) => {
        if (
          command.coordination.isLocked() &&
          !(event.target instanceof Element && event.target.closest('[data-settings-recovery]'))
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
      <div className="flex items-center justify-between mb-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          {t('settings.addresses.title', locale)}
        </h1>
        <Button disabled={loading || !profileId || locked} onClick={openAddForm} className="gap-2">
          <PlusIcon className="h-4 w-4" />
          {t('settings.addresses.add', locale)}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        {t('settings.addresses.description', locale)}
      </p>
      {returnTo && (
        <Link
          to={returnTo}
          className="mb-6 inline-block text-sm text-primary underline underline-offset-4"
        >
          {t(
            returnTo === '/solar/requests/new'
              ? 'settings.addresses.returnToSolarRequest'
              : 'settings.addresses.returnToAdvancedOrder',
            locale
          )}
        </Link>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
          <p className="text-sm">{t('settings.addresses.loading', locale)}</p>
        </div>
      )}

      {denied && <p role="alert">{copy('forbidden')}</p>}
      {command.locked === 'main' && recovery()}
      {/* Address list */}
      {!loading && loadError && (
        <div role="alert">
          <p>{t('settings.addresses.error.load', locale)}</p>
          <Button variant="outline" disabled={locked} onClick={() => void fetchAddresses(true)}>
            {t('settings.addresses.retry', locale)}
          </Button>
        </div>
      )}
      {!loading && !loadError && (
        <div className="space-y-3">
          {addresses.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center">
                <MapPinIcon className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('settings.addresses.noAddresses', locale)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('settings.addresses.noAddressesHint', locale)}
                </p>
              </CardContent>
            </Card>
          )}

          {addresses.map((address) => (
            <Card key={address.id} className={address.mainAddress ? 'border-primary/50' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {address.mainAddress && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                          <StarIcon className="h-3 w-3" />
                          {t('settings.addresses.main', locale)}
                        </span>
                      )}
                      <span className="text-sm font-medium truncate">
                        {getProvinceName(address)}، {getCityName(address)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{address.fullAddress}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('settings.addresses.form.postalCode', locale)}: {address.postalCode}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-4" dir="ltr">
                    {!address.mainAddress && (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void handleSetMain(address.id)}
                        className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title={t('settings.addresses.setMain', locale)}
                        aria-label={t('settings.addresses.setMain', locale)}
                      >
                        <StarIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => openEditForm(address)}
                      className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                      title={t('settings.addresses.edit', locale)}
                      aria-label={t('settings.addresses.edit', locale)}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={(event) => {
                        if (command.coordination.isLocked()) return;
                        deleteTriggerRef.current = event.currentTarget;
                        confirmDelete(address.id);
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                      title={t('settings.addresses.delete', locale)}
                      aria-label={t('settings.addresses.delete', locale)}
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(deletingAddress)}
        onOpenChange={(open) => {
          if (!open) confirmDelete(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={cancelDeleteRef}
          finalFocus={() =>
            deleteTriggerRef.current?.isConnected ? deleteTriggerRef.current : headingRef.current
          }
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
        >
          <DialogTitle>{t('settings.addresses.deleteConfirm', locale)}</DialogTitle>
          <p className="break-words">{deletingAddress?.fullAddress}</p>
          <DialogDescription>
            {deletingAddress?.mainAddress
              ? t('settings.addresses.deleteConfirmMain', locale)
              : addressesText('removalHistory', locale)}
          </DialogDescription>
          {command.locked === 'delete' && recovery()}
          <div className="flex justify-end gap-2">
            <Button
              ref={cancelDeleteRef}
              variant="outline"
              disabled={locked}
              onClick={() => confirmDelete(null)}
            >
              {t('settings.addresses.form.cancel', locale)}
            </Button>
            {!deletingAddress?.mainAddress && (
              <Button
                variant="destructive"
                disabled={locked || !profileId}
                onClick={() => {
                  if (deletingAddress) void handleDelete(deletingAddress.id);
                }}
              >
                {t('settings.addresses.delete', locale)}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Modal */}
      {showForm && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="bg-background rounded-lg shadow-lg w-full sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-semibold">
                {editingAddress
                  ? t('settings.addresses.form.editTitle', locale)
                  : t('settings.addresses.form.title', locale)}
              </DialogTitle>
              <button
                type="button"
                onClick={closeForm}
                disabled={locked}
                className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label={t('settings.addresses.form.cancel', locale)}
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <DialogDescription>
              {t('settings.addresses.form.description', locale)}
            </DialogDescription>
            <Form {...form}>
              <form
                noValidate
                ref={feedback.element}
                data-slot="settings-address-form"
                aria-label={t('settings.addresses.form.save', locale)}
                onSubmit={(event) => void prepareSave(event)}
                className="flex flex-col gap-4"
              >
                {form.formState.errors.root?.server?.message && (
                  <Alert variant="destructive">
                    <AlertDescription>{form.formState.errors.root.server.message}</AlertDescription>
                  </Alert>
                )}
                {form.formState.errors.root && !form.formState.errors.root.server && (
                  <p role="alert">{copy('validationUnavailable')}</p>
                )}
                {recovery()}
                <fieldset disabled={locked} className="flex flex-col gap-3">
                  <FormField
                    control={form.control}
                    name="provinceId"
                    render={({ field }) => (
                      <FormItem id="addresses-field-1">
                        <FormLabel>{t('settings.addresses.form.province', locale)}</FormLabel>
                        <FormControl>
                          <select
                            {...field}
                            onChange={(event) => {
                              if (command.coordination.isLocked()) return;
                              form.setValue('cityId', '', {
                                shouldDirty: true,
                                shouldValidate: Boolean(form.formState.touchedFields.cityId),
                              });
                              field.onChange(event);
                            }}
                            disabled={locked || !provinceOptions.ready}
                            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                            dir={locale === 'fa' ? 'rtl' : 'ltr'}
                          >
                            <option value="">
                              {t('settings.addresses.form.provincePlaceholder', locale)}
                            </option>
                            {editingAddress &&
                              formProvinceId === editingAddress.provinceId &&
                              !provinces.some((row) => row.id === editingAddress.provinceId) && (
                                <option value={editingAddress.provinceId}>
                                  {getProvinceName(editingAddress)}
                                </option>
                              )}
                            {provinces.map((province) => (
                              <option key={province.id} value={province.id}>
                                {locale === 'fa' ? province.nameFa : province.nameEn}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="cityId"
                    render={({ field }) => (
                      <FormItem id="addresses-field-2">
                        <FormLabel>{t('settings.addresses.form.city', locale)}</FormLabel>
                        <FormControl>
                          <DependentSelect
                            {...field}
                            dependencyValue={formProvinceId}
                            ready={cityOptions.ready}
                            loading={cityOptions.loading}
                            options={cities.map((city) => ({
                              value: city.id,
                              label: locale === 'fa' ? city.nameFa : city.nameEn,
                              dependencyValue: city.provinceId ?? '',
                            }))}
                            placeholder={t('settings.addresses.form.cityPlaceholder', locale)}
                            {...(editingAddress
                              ? {
                                  savedOption: {
                                    value: editingAddress.cityId,
                                    dependencyValue: editingAddress.provinceId,
                                    label: getCityName(editingAddress),
                                  },
                                }
                              : {})}
                            disabled={locked}
                            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                            dir={locale === 'fa' ? 'rtl' : 'ltr'}
                          />
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                  {(provinceOptions.error || cityOptions.error) && (
                    <div>
                      <p role="alert">
                        {t(
                          provinceOptions.error
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
                            (provinceOptions.error ? provinceOptions.retry : cityOptions.retry)();
                        }}
                      >
                        {t('settings.addresses.retry', locale)}
                      </Button>
                    </div>
                  )}
                  <FormTextarea
                    control={form.control}
                    name="fullAddress"
                    id="addresses-field-3"
                    label={t('settings.addresses.form.fullAddress', locale)}
                    reserveMessageSpace
                    inputProps={{
                      placeholder: t('settings.addresses.form.fullAddressPlaceholder', locale),
                      dir: locale === 'fa' ? 'rtl' : 'ltr',
                      maxLength: 500,
                      className: 'min-h-20',
                    }}
                  />
                  <FormInput
                    control={form.control}
                    name="postalCode"
                    id="addresses-field-4"
                    label={t('settings.addresses.form.postalCode', locale)}
                    reserveMessageSpace
                    inputProps={{
                      type: 'text',
                      inputMode: 'numeric',
                      placeholder: t('settings.addresses.form.postalCodePlaceholder', locale),
                      dir: 'ltr',
                      maxLength: 10,
                    }}
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={closeForm} disabled={locked}>
                      {t('settings.addresses.form.cancel', locale)}
                    </Button>
                    <FormSubmit
                      disabled={
                        locked ||
                        ((!provinceOptions.ready || !cityOptions.ready) && !historicalPair)
                      }
                    >
                      {saving
                        ? t('settings.addresses.form.saving', locale)
                        : t('settings.addresses.form.save', locale)}
                    </FormSubmit>
                  </div>
                </fieldset>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
