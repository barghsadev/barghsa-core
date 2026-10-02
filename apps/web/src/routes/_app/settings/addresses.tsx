import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from '../../../lib/toast-api.js';
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
import { z } from 'zod';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormSubmit,
  useZodForm,
  useWatch,
  setServerFieldErrors,
} from '@barghsa/ui/form';
import { withCsrf } from '../../../lib/csrf.js';
import { useGeographyOptions } from '../../../hooks/useGeographyOptions.js';
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

// ─── Types ────────────────────────────────────────────────────────────

interface Address {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  provinceNameFa?: string;
  provinceNameEn?: string;
  cityNameFa?: string;
  cityNameEn?: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}

const addressFormFields = ['provinceId', 'cityId', 'fullAddress', 'postalCode'] as const;
const emptyAddress = { provinceId: '', cityId: '', fullAddress: '', postalCode: '' };
type AddressFormValues = typeof emptyAddress;

// ─── Page Component ────────────────────────────────────────────────────

function SettingsAddressesPage() {
  const locale = useLocale();
  const { returnTo } = Route.useSearch();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const validationMessages = {
    provinceId: t('settings.addresses.validation.province', locale),
    cityId: t('settings.addresses.validation.city', locale),
    fullAddress: t('settings.addresses.validation.fullAddress', locale),
    postalCode: t('settings.addresses.validation.postalCode', locale),
  };
  const form = useZodForm(
    z.object({
      provinceId: z.string().uuid(validationMessages.provinceId),
      cityId: z.string().uuid(validationMessages.cityId),
      fullAddress: z
        .string()
        .trim()
        .min(1, validationMessages.fullAddress)
        .max(500, validationMessages.fullAddress),
      postalCode: z
        .string()
        .trim()
        .regex(/^[1-9]\d{9}$/, validationMessages.postalCode),
    }),
    { defaultValues: emptyAddress }
  );
  const saving = form.formState.isSubmitting;
  const formProvinceId = useWatch({ control: form.control, name: 'provinceId' });
  const provinceOptions = useGeographyOptions('/api/geography/provinces');
  const cityOptions = useGeographyOptions(
    showForm && formProvinceId
      ? `/api/geography/provinces/${encodeURIComponent(formProvinceId)}/cities`
      : null,
    formProvinceId || undefined
  );
  const provinces = provinceOptions.options;
  const cities = cityOptions.options;

  // ── Fetch addresses ────────────────────────────────────────────────

  const fetchAddresses = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setProfileId(null);
    try {
      // First get the active profile
      const profileRes = await fetch('/api/profiles');
      if (!profileRes.ok) {
        throw new Error('Failed to load profiles');
      }
      const profileData: { activeProfileId: string | null } = await profileRes.json();
      if (!profileData.activeProfileId) {
        setAddresses([]);
        return;
      }

      const res = await fetch(`/api/profiles/${profileData.activeProfileId}/addresses`);
      if (!res.ok) throw new Error('Failed to load addresses');
      const data: { addresses: Address[] } = await res.json();
      if (!Array.isArray(data.addresses)) throw new Error('Invalid address list');
      setAddresses(data.addresses);
      setProfileId(profileData.activeProfileId);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAddresses();
  }, [fetchAddresses]);

  // ── Open form for add ──────────────────────────────────────────────

  const openAddForm = () => {
    setEditingAddress(null);
    form.reset(emptyAddress);
    setShowForm(true);
  };

  // ── Open form for edit ─────────────────────────────────────────────

  const openEditForm = (address: Address) => {
    setEditingAddress(address);
    form.reset({
      provinceId: address.provinceId,
      cityId: address.cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    });
    setShowForm(true);
  };

  // ── Close form ─────────────────────────────────────────────────────

  const closeForm = () => {
    if (form.isSubmissionPending()) return;
    setShowForm(false);
    setEditingAddress(null);
  };

  // ── Save handler (create or update) ────────────────────────────────

  const handleSave = async (values: AddressFormValues) => {
    const fallbackMessage = t(
      editingAddress ? 'settings.addresses.error.update' : 'settings.addresses.error.create',
      locale
    );
    if (
      !provinceOptions.ready ||
      !cityOptions.ready ||
      !provinces.some((province) => province.id === values.provinceId) ||
      !cities.some((city) => city.id === values.cityId)
    ) {
      setServerFieldErrors(
        form,
        {
          provinceId: validationMessages.provinceId,
          cityId: validationMessages.cityId,
        },
        addressFormFields,
        fallbackMessage
      );
      return;
    }
    try {
      if (!profileId) throw new Error();
      const res = await fetch(
        editingAddress
          ? `/api/profiles/${profileId}/addresses/${editingAddress.id}`
          : `/api/profiles/${profileId}/addresses`,
        {
          method: editingAddress ? 'PUT' : 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(values),
        }
      );
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
        const fields =
          res.status === 400 &&
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'VALIDATION:INPUT:INVALID' &&
          'fields' in error &&
          Array.isArray(error.fields)
            ? error.fields
            : [];
        const messages = Object.fromEntries(
          fields.map((field: unknown) => [
            typeof field === 'string' ? field : '',
            typeof field === 'string' && Object.hasOwn(validationMessages, field)
              ? validationMessages[field as keyof typeof validationMessages]
              : null,
          ])
        );
        setServerFieldErrors(form, messages, addressFormFields, fallbackMessage);
        return;
      }
      toast.success(
        t(
          editingAddress
            ? 'settings.addresses.success.update'
            : 'settings.addresses.success.create',
          locale
        )
      );
      setShowForm(false);
      setEditingAddress(null);
      await fetchAddresses();
    } catch {
      form.setError('root.server', { type: 'server', message: fallbackMessage });
    }
  };

  // ── Set as main address ────────────────────────────────────────────

  const handleSetMain = useCallback(
    async (addressId: string) => {
      try {
        if (!profileId) throw new Error();

        const res = await fetch(`/api/profiles/${profileId}/addresses/${addressId}/set-main`, {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
        });

        if (!res.ok) {
          toast.error(t('settings.addresses.error.setMain', locale));
          return;
        }

        toast.success(t('settings.addresses.success.setMain', locale));
        fetchAddresses();
      } catch {
        toast.error(t('settings.addresses.error.setMain', locale));
      }
    },
    [locale, profileId, fetchAddresses]
  );

  // ── Delete address ─────────────────────────────────────────────────

  const handleDelete = useCallback(
    async (addressId: string) => {
      if (deletingRef.current || !profileId) return;
      deletingRef.current = true;
      setDeleting(true);
      try {
        const res = await fetch(`/api/profiles/${profileId}/addresses/${addressId}`, {
          method: 'DELETE',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
        });

        if (!res.ok) {
          toast.error(t('settings.addresses.error.delete', locale));
          return;
        }

        toast.success(t('settings.addresses.success.delete', locale));
        setDeleteConfirmId(null);
        fetchAddresses();
      } catch {
        toast.error(t('settings.addresses.error.delete', locale));
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [locale, profileId, fetchAddresses]
  );

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
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between mb-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold">
          {t('settings.addresses.title', locale)}
        </h1>
        <Button disabled={loading || !profileId} onClick={openAddForm} className="gap-2">
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

      {/* Address list */}
      {!loading && loadError && (
        <div role="alert">
          <p>{t('settings.addresses.error.load', locale)}</p>
          <Button variant="outline" onClick={fetchAddresses}>
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
                        onClick={() => handleSetMain(address.id)}
                        className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                        title={t('settings.addresses.setMain', locale)}
                        aria-label={t('settings.addresses.setMain', locale)}
                      >
                        <StarIcon className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditForm(address)}
                      className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                      title={t('settings.addresses.edit', locale)}
                      aria-label={t('settings.addresses.edit', locale)}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        deleteTriggerRef.current = event.currentTarget;
                        setDeleteConfirmId(address.id);
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
          if (!open && !deletingRef.current) setDeleteConfirmId(null);
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
          <div className="flex justify-end gap-2">
            <Button
              ref={cancelDeleteRef}
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteConfirmId(null)}
            >
              {t('settings.addresses.form.cancel', locale)}
            </Button>
            {!deletingAddress?.mainAddress && (
              <Button
                variant="destructive"
                disabled={deleting || !profileId}
                onClick={() => deletingAddress && handleDelete(deletingAddress.id)}
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
            if (!open && !saving) closeForm();
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
                disabled={saving}
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
              <form noValidate onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
                {form.formState.errors.root?.server?.message && (
                  <Alert variant="destructive">
                    <AlertDescription>{form.formState.errors.root.server.message}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-3">
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
                              form.setValue('cityId', '', {
                                shouldDirty: true,
                                shouldValidate: Boolean(form.formState.touchedFields.cityId),
                              });
                              field.onChange(event);
                            }}
                            disabled={saving || !provinceOptions.ready}
                            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                            dir={locale === 'fa' ? 'rtl' : 'ltr'}
                          >
                            <option value="">
                              {t('settings.addresses.form.provincePlaceholder', locale)}
                            </option>
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
                            disabled={saving}
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
                        onClick={provinceOptions.error ? provinceOptions.retry : cityOptions.retry}
                      >
                        {t('settings.addresses.retry', locale)}
                      </Button>
                    </div>
                  )}
                  <FormField
                    control={form.control}
                    name="fullAddress"
                    render={({ field }) => (
                      <FormItem id="addresses-field-3">
                        <FormLabel>{t('settings.addresses.form.fullAddress', locale)}</FormLabel>
                        <FormControl>
                          <textarea
                            {...field}
                            disabled={saving}
                            placeholder={t(
                              'settings.addresses.form.fullAddressPlaceholder',
                              locale
                            )}
                            className="flex w-full min-h-[80px] rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                            dir={locale === 'fa' ? 'rtl' : 'ltr'}
                            maxLength={500}
                          />
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem id="addresses-field-4">
                        <FormLabel>{t('settings.addresses.form.postalCode', locale)}</FormLabel>
                        <FormControl>
                          <input
                            {...field}
                            type="text"
                            inputMode="numeric"
                            disabled={saving}
                            placeholder={t('settings.addresses.form.postalCodePlaceholder', locale)}
                            className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
                            dir="ltr"
                            maxLength={10}
                          />
                        </FormControl>
                        <FormMessage reserveSpace />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
                    {t('settings.addresses.form.cancel', locale)}
                  </Button>
                  <FormSubmit disabled={!provinceOptions.ready || !cityOptions.ready}>
                    {saving
                      ? t('settings.addresses.form.saving', locale)
                      : t('settings.addresses.form.save', locale)}
                  </FormSubmit>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
