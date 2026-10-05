import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm, useWatch } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { useAccountUser } from './useAccountUser.js';
import { useGeographyOptions } from './useGeographyOptions.js';
import { useSettingsCommand } from './useSettingsCommand.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import { useProfileContextReset, useProfileContextRevision } from '../lib/profile-context.js';
import { toast } from '../lib/toast-api.js';
import {
  addressFormFields,
  emptyAddress,
  addressPatch,
  addressReceipt,
  savedAddress,
  settingsAddresses,
  settingsContext,
  type AddressFormValues,
  type SavedAddress,
} from '../lib/settings-form.js';
export function useSavedAddressSettingsEditor(locale: Locale) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision(),
    copy = (key: string) => tSettingsForms(key, locale);
  const identity = JSON.stringify([actor, revision]),
    current = useRef(identity);
  current.current = identity;
  const alive = useRef(true),
    withdrawn = useRef(false),
    generation = useRef(0),
    accepted = useRef<SavedAddress[]>([]),
    acceptedProfile = useRef<string | null>(null);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]),
    [acceptedIdentity, setAcceptedIdentity] = useState(''),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false),
    [denied, setDenied] = useState(false),
    [profileId, setProfileId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false),
    [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null),
    [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const command = useSettingsCommand(
    identity,
    () => {
      withdrawn.current = true;
      generation.current++;
      accepted.current = [];
      acceptedProfile.current = null;
      setAddresses([]);
      setAcceptedIdentity('');
      setProfileId(null);
      setShowForm(false);
      setEditingAddress(null);
      setDeleteConfirmId(null);
      form.reset(emptyAddress);
      setDenied(true);
      setLoading(false);
    },
    () => !!actor && !withdrawn.current
  );
  const coordination = useRef(command.coordination);
  coordination.current = command.coordination;
  const base = useRef(editingAddress);
  base.current = editingAddress;
  const geography = useRef<{
    provinces: readonly { id: string }[];
    cities: readonly { id: string; provinceId?: string }[];
    provinceReady: boolean;
    cityReady: boolean;
  }>({ provinces: [], cities: [], provinceReady: false, cityReady: false });
  function validationCopy(key: string) {
    const legacy: Record<string, string> = {
      provinceIdInvalid: 'settings.addresses.validation.province',
      cityIdInvalid: 'settings.addresses.validation.city',
      fullAddressInvalid: 'settings.addresses.validation.fullAddress',
      postalCodeInvalid: 'settings.addresses.validation.postalCode',
    };
    return legacy[key] ? t(legacy[key], locale) : copy(key);
  }
  const form = useZodForm<AddressFormValues>(
    async () => {
      const token = identity,
        schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && current.current === token && coordination.current.isCurrent()
        ? schema.savedAddressSchema(
            validationCopy,
            () => base.current,
            (id) =>
              geography.current.provinceReady &&
              geography.current.provinces.some((row) => row.id === id),
            (id, parent) =>
              geography.current.cityReady &&
              geography.current.cities.some((row) => row.id === id && row.provinceId === parent)
          )
        : schema.settingsInactiveSchema;
    },
    { defaultValues: emptyAddress, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const locked = !!command.locked,
    saving = command.busy || form.formState.isSubmitting;
  const feedback = useSettingsFormFeedback(
    form,
    JSON.stringify([identity, editingAddress?.id ?? null]),
    locked,
    command.coordination,
    Object.fromEntries(addressFormFields.map((key) => [key, validationCopy(key + 'Invalid')])),
    copy('error'),
    showForm && acceptedIdentity === identity && !denied
  );
  const formProvinceId = useWatch({ control: form.control, name: 'provinceId' }),
    provinceOptions = useGeographyOptions('/api/geography/provinces'),
    cityOptions = useGeographyOptions(
      showForm && formProvinceId
        ? '/api/geography/provinces/' + encodeURIComponent(formProvinceId) + '/cities'
        : null,
      formProvinceId || undefined
    );
  geography.current = {
    provinces: provinceOptions.options,
    cities: cityOptions.options,
    provinceReady: provinceOptions.ready,
    cityReady: cityOptions.ready,
  };
  function permitted(token: string) {
    return (
      alive.current &&
      !withdrawn.current &&
      current.current === token &&
      command.coordination.isCurrent()
    );
  }
  async function privateRead(path: string, token: string) {
    const response = await fetch(path, { credentials: 'include' });
    if (!permitted(token)) throw new Error('Obsolete address read');
    if ([401, 403, 404].includes(response.status)) {
      command.coordination.denied();
      throw new Error('Address unavailable');
    }
    if (!response.ok) throw new Error('Address read failed');
    const value: unknown = await response.json();
    if (!permitted(token)) throw new Error('Obsolete address read');
    return value;
  }
  async function readAddresses(id: string, token: string) {
    const rows = settingsAddresses(
      await privateRead('/api/profiles/' + id + '/addresses', token),
      id
    );
    if (!rows) throw new Error('Invalid addresses');
    if (permitted(token)) {
      accepted.current = rows;
      setAddresses(rows);
      setProfileId(id);
      acceptedProfile.current = id;
      setAcceptedIdentity(identity);
    }
    return rows;
  }
  function retireAddresses() {
    accepted.current = [];
    acceptedProfile.current = null;
    base.current = null;
    setAddresses([]);
    setProfileId(null);
    setAcceptedIdentity('');
    setShowForm(false);
    setEditingAddress(null);
    setDeleteConfirmId(null);
    form.reset(emptyAddress);
  }
  async function fetchAddresses(refresh = false) {
    if (!actor || withdrawn.current) return;
    if (refresh && !command.coordination.claim('read')) return;
    const token = identity,
      read = ++generation.current;
    if (!refresh) setLoading(true);
    setLoadError(false);
    try {
      const context = settingsContext(await privateRead('/api/profiles', token));
      if (!context) throw new Error('Invalid profiles');
      if (!permitted(token) || generation.current !== read) return;
      if (!context.activeProfileId) {
        retireAddresses();
        return;
      }
      if (acceptedProfile.current && acceptedProfile.current !== context.activeProfileId)
        retireAddresses();
      const rows = await readAddresses(context.activeProfileId, token);
      if (!permitted(token) || generation.current !== read) return;
      if (base.current && !rows.some((row) => row.id === base.current?.id)) {
        setShowForm(false);
        setEditingAddress(null);
        form.reset(emptyAddress);
      }
    } catch {
      if (permitted(token) && generation.current === read) setLoadError(true);
    } finally {
      if (permitted(token) && generation.current === read) {
        setLoading(false);
        if (refresh) command.coordination.release('read');
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    withdrawn.current = false;
    setDenied(false);
    setShowForm(false);
    setEditingAddress(null);
    setDeleteConfirmId(null);
    form.reset(emptyAddress);
    acceptedProfile.current = null;
    accepted.current = [];
    void fetchAddresses();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [identity]);
  useProfileContextReset(() => {
    current.current = '';
    generation.current++;
    command.reset();
    setAddresses([]);
    setAcceptedIdentity('');
    setProfileId(null);
    setShowForm(false);
    form.reset(emptyAddress);
  });
  function openAddForm() {
    if (command.coordination.isLocked() || !profileId) return;
    setEditingAddress(null);
    form.reset(emptyAddress);
    setShowForm(true);
  }
  function openEditForm(address: SavedAddress) {
    if (command.coordination.isLocked() || !accepted.current.some((row) => row.id === address.id))
      return;
    setEditingAddress(address);
    form.reset({
      provinceId: address.provinceId,
      cityId: address.cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    });
    setShowForm(true);
  }
  function closeForm() {
    if (command.coordination.isLocked() || form.isSubmissionPending()) return;
    setShowForm(false);
    setEditingAddress(null);
  }
  async function prepareSave(event: FormEvent) {
    event.preventDefault();
    if (!profileId || !showForm || !command.coordination.claim('address')) return;
    const raw = { ...form.getValues() },
      source = editingAddress,
      target = profileId,
      token = identity,
      patch = addressPatch(raw, source),
      body = { ...patch, idempotencyKey: crypto.randomUUID() };
    try {
      await form.handleSubmit(
        async () => {
          if (!permitted(token)) return;
          if (!Object.keys(patch).length) {
            command.coordination.release('address');
            setShowForm(false);
            setEditingAddress(null);
            return;
          }
          await command.submit({
            owner: 'address',
            path: '/api/profiles/' + target + '/addresses' + (source ? '/' + source.id : ''),
            method: source ? 'PUT' : 'POST',
            status: source ? 200 : 201,
            keyed: true,
            body,
            receipt: (v) => addressReceipt(v, target, source, patch),
            fields: feedback.fields,
            accepted: async (value) => {
              if (!permitted(token)) return;
              const row = value as SavedAddress;
              accepted.current = [...accepted.current.filter((a) => a.id !== row.id), row];
              setAddresses(accepted.current);
              setShowForm(false);
              setEditingAddress(null);
              form.reset(emptyAddress);
              toast.success(
                t(
                  source
                    ? 'settings.addresses.success.update'
                    : 'settings.addresses.success.create',
                  locale
                )
              );
              try {
                await readAddresses(target, token);
              } catch {
                if (permitted(token)) setLoadError(true);
              }
            },
          });
        },
        (errors) => {
          feedback.invalid(errors);
          command.coordination.release('address');
        }
      )(event);
    } finally {
      command.coordination.release('address');
    }
  }
  async function handleSetMain(id: string) {
    if (
      !profileId ||
      !accepted.current.some((row) => row.id === id && !row.mainAddress) ||
      !command.coordination.claim('main')
    )
      return;
    const target = profileId,
      token = identity;
    await command.submit({
      owner: 'main',
      path: '/api/profiles/' + target + '/addresses/' + id + '/set-main',
      method: 'POST',
      status: 200,
      keyed: false,
      receipt: (v) => savedAddress(v, target) && v.id === id && v.mainAddress,
      confirmation: () => readAddresses(target, token),
      confirmed: (v) =>
        Array.isArray(v) &&
        v.some((row) => savedAddress(row, target) && row.id === id && row.mainAddress),
      accepted: () => {
        if (permitted(token)) toast.success(t('settings.addresses.success.setMain', locale));
      },
    });
  }
  function confirmDelete(id: string | null) {
    if (command.coordination.isLocked()) return;
    setDeleteConfirmId(id);
  }
  async function handleDelete(id: string) {
    if (
      !profileId ||
      !accepted.current.some((row) => row.id === id && !row.mainAddress) ||
      !command.coordination.claim('delete')
    )
      return;
    const target = profileId,
      token = identity;
    await command.submit({
      owner: 'delete',
      path: '/api/profiles/' + target + '/addresses/' + id,
      method: 'DELETE',
      status: 200,
      keyed: false,
      receipt: (v) =>
        !!v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        'message' in v &&
        v.message === 'Address deleted successfully.',
      confirmation: () => readAddresses(target, token),
      confirmed: (v) =>
        Array.isArray(v) && !v.some((row) => savedAddress(row, target) && row.id === id),
      accepted: () => {
        if (permitted(token)) {
          setDeleteConfirmId(null);
          if (base.current?.id === id) {
            setShowForm(false);
            setEditingAddress(null);
            form.reset(emptyAddress);
          }
          toast.success(t('settings.addresses.success.delete', locale));
        }
      },
    });
  }
  return {
    addresses: acceptedIdentity === identity ? addresses : [],
    profileId: acceptedIdentity === identity ? profileId : null,
    loading,
    loadError,
    denied,
    showForm: acceptedIdentity === identity && !denied && showForm,
    editingAddress: acceptedIdentity === identity && !denied ? editingAddress : null,
    deleteConfirmId: acceptedIdentity === identity && !denied ? deleteConfirmId : null,
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
  };
}
