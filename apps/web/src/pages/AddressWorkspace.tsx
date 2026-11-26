import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { ConfirmationFields } from '@barghsa/ui';
import { Skeleton } from '@barghsa/ui';
import { useRef, type Ref } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  useSavedAddressSettingsEditor,
  type SavedAddressView,
} from '../hooks/useSavedAddressSettingsEditor.js';
import type { SavedAddress as Address } from '../lib/settings-form.js';
import { t } from '@barghsa/i18n/app';
import { addressesText } from '@barghsa/i18n/addresses';
import { MapPinIcon, PlusIcon, PencilIcon, SearchIcon, Trash2Icon, StarIcon } from 'lucide-react';
import {
  Button,
  buttonVariants,
  ComboBox,
  ComboBoxInput,
  ComboBoxItem,
  ComboBoxPopup,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Alert,
  AlertDescription,
  EmptyState,
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

import { useLocale } from '../hooks/useLocale.js';
import type { GeographyOption } from '../hooks/useGeographyOptions.js';
import { addressWorkspaceText } from './address-workspace-text.js';
import { type AddressReturn } from '../lib/address-return.js';
import { RecordEditorSection, recordEditorGrid } from '../components/RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';

function matchableName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ');
}

function AddressLocationPicker({
  locale,
  options,
  selected,
  saved,
  placeholder,
  disabled,
  loading,
  inputRef,
  onChange,
  onBlur,
}: {
  locale: 'fa' | 'en';
  options: readonly GeographyOption[];
  selected: string;
  saved?: GeographyOption;
  placeholder: string;
  disabled: boolean;
  loading?: boolean;
  inputRef: Ref<HTMLInputElement>;
  onChange: (id: string) => void;
  onBlur: () => void;
}) {
  const label = (option: GeographyOption) => (locale === 'fa' ? option.nameFa : option.nameEn);
  const value = options.find((option) => option.id === selected) ?? saved ?? null;
  const direction = locale === 'fa' ? 'rtl' : 'ltr';

  return (
    <ComboBox
      items={options}
      value={value}
      itemToStringLabel={label}
      itemToStringValue={(option) => option.id}
      isItemEqualToValue={(option, selection) => option.id === selection.id}
      filter={(option, query) => {
        const search = matchableName(query);
        return (
          matchableName(option.nameFa).includes(search) ||
          matchableName(option.nameEn).includes(search)
        );
      }}
      autoHighlight
      openOnInputClick
      disabled={disabled}
      onValueChange={(option) => {
        if (!disabled && (!option || options.some(({ id }) => id === option.id)))
          onChange(option?.id ?? '');
      }}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <FormControl>
        <ComboBoxInput
          ref={inputRef}
          onBlur={onBlur}
          aria-required="true"
          aria-busy={loading || undefined}
          placeholder={placeholder}
          className="h-11 ps-9 aria-invalid:border-destructive"
          dir={direction}
        />
      </FormControl>
      <ComboBoxPopup
        dir={direction}
        emptyMessage={addressWorkspaceText('noMatch', locale)}
        className="w-(--anchor-width) min-w-0 p-1"
      >
        {(option: GeographyOption) => (
          <ComboBoxItem
            key={option.id}
            value={option}
            aria-label={label(option)}
            className="min-h-10"
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-2">
              <bdi className="font-medium">{label(option)}</bdi>
              {option.nameFa !== option.nameEn && (
                <bdi className="text-xs text-muted-foreground" lang={locale === 'fa' ? 'en' : 'fa'}>
                  {locale === 'fa' ? option.nameEn : option.nameFa}
                </bdi>
              )}
            </span>
          </ComboBoxItem>
        )}
      </ComboBoxPopup>
    </ComboBox>
  );
}

export function AddressWorkspace({
  view,
  returnTo,
}: {
  view: SavedAddressView;
  returnTo?: AddressReturn;
}) {
  const locale = useLocale();
  const navigate = useNavigate();
  const addressId = 'addressId' in view ? view.addressId : undefined;
  const formMode = view.kind === 'new' || view.kind === 'edit';
  const openList = () => void navigate({ to: '/settings/addresses', search: { returnTo } });
  const openRecord = (id: string) =>
    void navigate({
      to: '/settings/addresses/$addressId',
      params: { addressId: id },
      search: { returnTo },
    });
  const cancelForm = () => {
    if (addressId) openRecord(addressId);
    else if (returnTo) void navigate({ to: returnTo });
    else openList();
  };
  const editor = useSavedAddressSettingsEditor(
    locale,
    view,
    (id) => {
      if (view.kind === 'new' && returnTo)
        void navigate({
          to: returnTo,
          replace: true,
          state: id && profileId ? { savedOrderAddress: { profileId, id } } : undefined,
        });
      else if (id)
        void navigate({
          to: '/settings/addresses/$addressId',
          params: { addressId: id },
          search: { returnTo },
          replace: true,
        });
      else openList();
    },
    () => {
      if (view.kind === 'detail') openList();
    }
  );
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
  const deletionGate = useRiskConfirmation(
    JSON.stringify([profileId, deleteConfirmId]),
    locale,
    'destructive'
  );

  return (
    <div
      className="mx-auto max-w-3xl min-w-0 space-y-4"
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
      {view.kind !== 'list' && (
        <Link
          to="/settings/addresses"
          search={{ returnTo }}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {t('settings.addresses.title', locale)}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 text-2xl font-bold outline-none [overflow-wrap:anywhere]"
        >
          {view.kind === 'edit'
            ? t('settings.addresses.form.editTitle', locale)
            : view.kind === 'new'
              ? t('settings.addresses.form.title', locale)
              : view.kind === 'detail'
                ? t('settings.addresses.detailTitle', locale)
                : t('settings.addresses.title', locale)}
        </h1>
        {view.kind === 'list' && !locked && !loading && profileId && (
          <Link
            to="/settings/addresses/new"
            search={{ returnTo }}
            className={buttonVariants({ className: 'min-h-11 gap-2' })}
          >
            <PlusIcon className="size-4" aria-hidden="true" />
            {t('settings.addresses.add', locale)}
          </Link>
        )}
      </div>
      {view.kind === 'list' && (
        <p className="text-sm text-muted-foreground">
          {t('settings.addresses.description', locale)}
        </p>
      )}
      {returnTo && !formMode && (
        <Link
          to={returnTo}
          className="touch-action text-sm text-primary underline underline-offset-4"
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
        <div className="text-center py-8 text-muted-foreground" role="status">
          <Skeleton className="h-6 w-20 shrink-0" />
          <p className="text-sm">{t('settings.addresses.loading', locale)}</p>
        </div>
      )}

      {denied && <p role="alert">{copy('forbidden')}</p>}
      {command.locked === 'main' && recovery()}
      {/* Address list */}
      {!loading && !denied && loadError && (
        <div role="alert">
          <p>{t('settings.addresses.error.load', locale)}</p>
          <Button variant="outline" disabled={locked} onClick={() => void fetchAddresses(true)}>
            {t('settings.addresses.retry', locale)}
          </Button>
        </div>
      )}
      {!loading && !denied && !loadError && !profileId && (
        <EmptyState
          icon={<MapPinIcon />}
          title={addressWorkspaceText('profileRequired', locale)}
          description={addressWorkspaceText('profileRequiredHint', locale)}
          action={
            <Link to="/app" className="text-sm text-primary underline underline-offset-4">
              {addressWorkspaceText('openDashboard', locale)}
            </Link>
          }
        />
      )}
      {!formMode && !loading && !denied && !loadError && profileId && (
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {address.mainAddress && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 py-0.5">
                          <StarIcon className="h-3 w-3" />
                          {t('settings.addresses.main', locale)}
                        </span>
                      )}
                      <span className="text-sm font-medium">
                        {getProvinceName(address)}
                        {locale === 'fa' ? '، ' : ', '}
                        {getCityName(address)}
                      </span>
                    </div>
                    {view.kind === 'list' && !locked ? (
                      <Link
                        to="/settings/addresses/$addressId"
                        params={{ addressId: address.id }}
                        search={{ returnTo }}
                        className="touch-action font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
                      >
                        {address.fullAddress}
                      </Link>
                    ) : (
                      <p className="font-medium [overflow-wrap:anywhere]">{address.fullAddress}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('settings.addresses.form.postalCode', locale)}: {address.postalCode}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {!address.mainAddress && (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => void handleSetMain(address.id)}
                        className="touch-action rounded p-2 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title={t('settings.addresses.setMain', locale)}
                        aria-label={t('settings.addresses.setMain', locale)}
                      >
                        <StarIcon className="h-4 w-4" />
                      </button>
                    )}
                    {!locked && (
                      <Link
                        to="/settings/addresses/$addressId/edit"
                        params={{ addressId: address.id }}
                        search={{ returnTo }}
                        className="touch-action rounded text-sm text-primary underline underline-offset-4"
                        aria-label={t('settings.addresses.edit', locale)}
                      >
                        <PencilIcon className="size-4" aria-hidden="true" />
                        {t('settings.addresses.edit', locale)}
                      </Link>
                    )}
                    <button
                      type="button"
                      disabled={locked}
                      onClick={(event) => {
                        if (command.coordination.isLocked()) return;
                        deleteTriggerRef.current = event.currentTarget;
                        confirmDelete(address.id);
                      }}
                      className="touch-action rounded p-2 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
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
              : addressWorkspaceText('removalHistory', locale)}
          </DialogDescription>
          {command.locked === 'delete' && recovery()}
          <ConfirmationFields gate={deletionGate} disabled={locked} />
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
                disabled={locked || !profileId || !deletionGate.allowed}
                onClick={() => {
                  if (deletingAddress && deletionGate.allowed)
                    void handleDelete(deletingAddress.id);
                }}
              >
                {t('settings.addresses.delete', locale)}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {showForm && !loading && !loadError && (
        <Form {...form}>
          <form
            noValidate
            ref={feedback.element}
            data-slot="settings-address-form"
            aria-label={t('settings.addresses.form.save', locale)}
            onSubmit={(event) => void prepareSave(event)}
            className={`max-w-2xl ${recordEditorFormSurface}`}
            onFocus={keepRecordFieldVisible}
          >
            <RecordEditorSection title={addressWorkspaceText('details', locale)}>
              {form.formState.errors.root?.server?.message && (
                <Alert variant="destructive">
                  <AlertDescription>{form.formState.errors.root.server.message}</AlertDescription>
                </Alert>
              )}
              {form.formState.errors.root && !form.formState.errors.root.server && (
                <p role="alert">{copy('validationUnavailable')}</p>
              )}
              {recovery()}
              <fieldset
                disabled={locked}
                className="min-w-0 space-y-1.5 [&_[data-slot=form-message]]:min-h-4 [&_[data-slot=form-message]]:text-xs [&_[data-slot=form-message]]:leading-4"
              >
                <div className={recordEditorGrid}>
                  <FormField
                    control={form.control}
                    name="provinceId"
                    render={({ field }) => (
                      <FormItem id="addresses-field-1">
                        <FormLabel>{t('settings.addresses.form.province', locale)}</FormLabel>
                        <AddressLocationPicker
                          locale={locale}
                          options={provinces}
                          selected={field.value}
                          {...(editingAddress && field.value === editingAddress.provinceId
                            ? {
                                saved: {
                                  id: field.value,
                                  nameFa:
                                    editingAddress.provinceNameFa ??
                                    getProvinceName(editingAddress),
                                  nameEn:
                                    editingAddress.provinceNameEn ??
                                    getProvinceName(editingAddress),
                                },
                              }
                            : {})}
                          placeholder={addressWorkspaceText('province', locale)}
                          disabled={locked || !provinceOptions.ready}
                          loading={provinceOptions.loading}
                          inputRef={field.ref}
                          onBlur={field.onBlur}
                          onChange={(id) => {
                            if (command.coordination.isLocked() || id === field.value) return;
                            form.setValue('cityId', '', {
                              shouldDirty: true,
                              shouldValidate: Boolean(form.formState.touchedFields.cityId),
                            });
                            field.onChange(id);
                          }}
                        />
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
                        <AddressLocationPicker
                          key={formProvinceId}
                          locale={locale}
                          options={cities}
                          selected={field.value}
                          {...(editingAddress && historicalPair
                            ? {
                                saved: {
                                  id: field.value,
                                  nameFa: editingAddress.cityNameFa ?? getCityName(editingAddress),
                                  nameEn: editingAddress.cityNameEn ?? getCityName(editingAddress),
                                },
                              }
                            : {})}
                          placeholder={
                            !formProvinceId
                              ? addressesText('provinceFirst', locale)
                              : cityOptions.loading
                                ? addressesText('loadingCities', locale)
                                : addressWorkspaceText('city', locale)
                          }
                          disabled={locked || !cityOptions.ready}
                          loading={cityOptions.loading}
                          inputRef={field.ref}
                          onBlur={field.onBlur}
                          onChange={(id) => {
                            if (!command.coordination.isLocked()) field.onChange(id);
                          }}
                        />
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                </div>
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
                    'aria-required': true,
                    placeholder: addressesText('streetExample', locale),
                    dir: 'auto',
                    autoComplete: 'street-address',
                    maxLength: 500,
                    rows: 2,
                    className: 'max-h-44 min-h-16 resize-y placeholder-shown:[direction:inherit]',
                  }}
                />
                <FormInput
                  control={form.control}
                  name="postalCode"
                  id="addresses-field-4"
                  label={t('settings.addresses.form.postalCode', locale)}
                  itemClassName="max-w-xs"
                  reserveMessageSpace
                  inputProps={{
                    'aria-required': true,
                    type: 'text',
                    inputMode: 'numeric',
                    autoComplete: 'postal-code',
                    placeholder: t('settings.addresses.form.postalCodePlaceholder', locale),
                    dir: 'ltr',
                    maxLength: 10,
                  }}
                />
              </fieldset>
            </RecordEditorSection>
            <StickyRecordEditorActions>
              <Button type="button" variant="ghost" onClick={cancelForm} disabled={locked}>
                {t('settings.addresses.form.cancel', locale)}
              </Button>
              <FormSubmit
                disabled={
                  locked || ((!provinceOptions.ready || !cityOptions.ready) && !historicalPair)
                }
              >
                {saving
                  ? t('settings.addresses.form.saving', locale)
                  : t('settings.addresses.form.save', locale)}
              </FormSubmit>
            </StickyRecordEditorActions>
          </form>
        </Form>
      )}
    </div>
  );
}
