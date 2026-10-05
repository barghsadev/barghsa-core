import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useZodForm, type FieldPath } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/crm';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { useAccountUser } from './useAccountUser.js';
import { useGeographyOptions } from './useGeographyOptions.js';
import { useSettingsCommand } from './useSettingsCommand.js';
import { useSettingsFormFeedback } from './useSettingsFormFeedback.js';
import {
  refreshProfileContext,
  useProfileContextReset,
  useProfileContextRevision,
} from '../lib/profile-context.js';
import { toast } from '../lib/toast-api.js';
import {
  emptyProfile,
  profileFormFields,
  profileValues,
  profilePatch,
  profileReceipt,
  profileConfirmation,
  profileCanEditIdentity,
  profilePatchAuthorized,
  settingsContext,
  settingsProfile,
  type SettingsProfile,
  type SettingsProfileSummary,
  type ProfileFormValues,
} from '../lib/settings-form.js';
export function useProfileSettingsEditor(locale: Locale) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision(),
    copy = (key: string) => tSettingsForms(key, locale);
  const identity = JSON.stringify([actor, revision]),
    current = useRef(identity);
  current.current = identity;
  const alive = useRef(true),
    withdrawn = useRef(false),
    generation = useRef(0),
    loadedIdentity = useRef('');
  const [profile, setProfile] = useState<SettingsProfile | null>(null),
    [loading, setLoading] = useState(true),
    [acceptedIdentity, setAcceptedIdentity] = useState(''),
    [error, setError] = useState<string | null>(null),
    [confirmOpen, setConfirmOpen] = useState(false);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null),
    [availableProfiles, setAvailableProfiles] = useState<SettingsProfileSummary[]>([]),
    [defaultError, setDefaultError] = useState<string | null>(null);
  const accepted = useRef(profile);
  accepted.current = profile;
  const command = useSettingsCommand(
    identity,
    () => {
      withdrawn.current = true;
      generation.current++;
      loadedIdentity.current = '';
      setProfile(null);
      setAcceptedIdentity('');
      setAvailableProfiles([]);
      setDefaultProfileId(null);
      setConfirmOpen(false);
      form.reset(emptyProfile);
      setLoading(false);
      setError(copy('forbidden'));
    },
    (held) =>
      !!actor &&
      !withdrawn.current &&
      (!held ||
        held.owner !== 'profile' ||
        (!!accepted.current && (!held.body || profilePatchAuthorized(accepted.current, held.body))))
  );
  const coordinator = useRef(command.coordination);
  coordinator.current = command.coordination;
  const geography = useRef<{
    provinces: readonly { id: string }[];
    cities: readonly { id: string; provinceId?: string }[];
    provinceReady: boolean;
    cityReady: boolean;
  }>({ provinces: [], cities: [], provinceReady: false, cityReady: false });
  const form = useZodForm<ProfileFormValues>(
    async () => {
      const token = identity,
        schema = await import('../lib/contract-review-signature-form-schemas.js');
      return alive.current && current.current === token && coordinator.current.isCurrent()
        ? schema.profileSettingsSchema(
            copy,
            () => accepted.current,
            profilePatch,
            (id) =>
              geography.current.provinceReady &&
              geography.current.provinces.some((row) => row.id === id),
            (id, parent) =>
              geography.current.cityReady &&
              geography.current.cities.some((row) => row.id === id && row.provinceId === parent)
          )
        : schema.settingsInactiveSchema;
    },
    { defaultValues: emptyProfile, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const values = form.watch(),
    locked = !!command.locked;
  const messages = Object.fromEntries(
    profileFormFields
      .filter(
        (key) =>
          !['firstName', 'lastName', 'nationalId', 'legalName', 'nationalIdentifier'].includes(
            key
          ) ||
          (profile &&
            (['firstName', 'lastName', 'nationalId'].includes(key)
              ? profileCanEditIdentity(profile)
              : profile.profileType === 'LEGAL' &&
                profile.status !== 'VERIFIED' &&
                !!profile.legalInfo))
      )
      .map((key) => [key, copy(key + 'Invalid')])
  );
  const feedback = useSettingsFormFeedback(
    form,
    identity,
    locked || confirmOpen,
    command.coordination,
    messages,
    copy('error'),
    !!profile && acceptedIdentity === identity
  );
  const provinceOptions = useGeographyOptions('/api/geography/provinces'),
    cityOptions = useGeographyOptions(
      values.provinceId
        ? '/api/geography/provinces/' + encodeURIComponent(values.provinceId) + '/cities'
        : null,
      values.provinceId || undefined
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
  function documentsDenied(profileId: string) {
    if (permitted(identity) && accepted.current?.id === profileId) command.coordination.denied();
  }
  async function privateRead(path: string, token: string) {
    const response = await fetch(path, { credentials: 'include' });
    if (!permitted(token)) throw new Error('Obsolete profile read');
    if ([401, 403, 404].includes(response.status)) {
      command.coordination.denied();
      throw new Error('Profile unavailable');
    }
    if (!response.ok) throw new Error('Profile read failed');
    const value: unknown = await response.json();
    if (!permitted(token)) throw new Error('Obsolete profile read');
    return value;
  }
  async function readDetail(id: string, token: string) {
    const parsed = settingsProfile(await privateRead('/api/profiles/' + id, token), id);
    if (!parsed) throw new Error('Invalid profile detail');
    if (permitted(token)) {
      setProfile(parsed);
      accepted.current = parsed;
      setAcceptedIdentity(token);
    }
    return parsed;
  }
  function retireProfile() {
    accepted.current = null;
    loadedIdentity.current = '';
    setProfile(null);
    setAcceptedIdentity('');
    setAvailableProfiles([]);
    setDefaultProfileId(null);
    setDefaultError(null);
    setConfirmOpen(false);
    form.reset(emptyProfile);
  }
  async function fetchProfile(refresh = false) {
    if (!actor || withdrawn.current) return;
    if (refresh && !command.coordination.claim('read')) return;
    const token = identity,
      read = ++generation.current;
    if (!refresh) setLoading(true);
    setError(null);
    try {
      const context = settingsContext(await privateRead('/api/profiles', token));
      if (!context) throw new Error('Invalid profiles');
      if (!permitted(token) || generation.current !== read) return;
      if (!context.activeProfileId) {
        retireProfile();
        setError(t('settings.profile.error.notFound', locale));
        return;
      }
      if (accepted.current && accepted.current.id !== context.activeProfileId) retireProfile();
      setAvailableProfiles(context.profiles);
      const previous = accepted.current,
        parsed = await readDetail(context.activeProfileId, token);
      if (!permitted(token) || generation.current !== read) return;
      setDefaultProfileId(context.activeProfileId);
      if (loadedIdentity.current !== identity || !previous || previous.id !== parsed.id) {
        command.reset();
        setConfirmOpen(false);
        form.reset(profileValues(parsed));
        loadedIdentity.current = identity;
      }
    } catch {
      if (permitted(token) && generation.current === read)
        setError(t('settings.profile.error.loadRetry', locale));
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
    loadedIdentity.current = '';
    accepted.current = null;
    setProfile(null);
    setAcceptedIdentity('');
    setAvailableProfiles([]);
    setDefaultProfileId(null);
    setConfirmOpen(false);
    form.reset(emptyProfile);
    void fetchProfile();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [identity]);
  useProfileContextReset(() => {
    current.current = '';
    generation.current++;
    command.reset();
    setProfile(null);
    form.reset(emptyProfile);
    setConfirmOpen(false);
  });
  async function changeDefault(id: string) {
    if (
      !id ||
      id === defaultProfileId ||
      !availableProfiles.some((row) => row.id === id) ||
      !command.coordination.claim('default')
    )
      return;
    const token = identity;
    setDefaultError(null);
    await command.submit({
      owner: 'default',
      path: '/api/profiles/default/' + encodeURIComponent(id),
      method: 'POST',
      status: 200,
      keyed: false,
      receipt: (v) =>
        !!v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        'activeProfileId' in v &&
        v.activeProfileId === id,
      confirmation: async () => {
        const context = settingsContext(await privateRead('/api/profiles', token));
        if (!context) throw new Error('Invalid profiles');
        return context;
      },
      confirmed: (v) =>
        !!v && typeof v === 'object' && 'activeProfileId' in v && v.activeProfileId === id,
      accepted: () => {
        if (permitted(token)) refreshProfileContext();
      },
    });
    if (permitted(token) && command.coordination.isLocked())
      setDefaultError(t('dashboard.profile.switchError', locale));
  }
  async function prepareSave(event: FormEvent) {
    event.preventDefault();
    if (!profile || !defaultProfileId || !command.coordination.claim('profile')) return;
    const raw = { ...form.getValues() },
      source = profile,
      token = identity,
      patch = profilePatch(raw, source),
      body = { ...patch, idempotencyKey: crypto.randomUUID() };
    try {
      await form.handleSubmit(
        async () => {
          if (!permitted(token)) return;
          if (!Object.keys(patch).length) {
            command.coordination.release('profile');
            return;
          }
          const staged = command.stage({
            owner: 'profile',
            path: '/api/profiles/' + source.id,
            method: 'PUT',
            status: 200,
            keyed: true,
            body,
            receipt: (v) => profileReceipt(v, source, patch),
            confirmation: () => readDetail(source.id, token),
            confirmed: (v) => !!profileConfirmation(v, source, patch),
            fields: (names) => {
              if (!feedback.fields(names)) return false;
              setConfirmOpen(false);
              return true;
            },
            accepted: (value) => {
              if (!permitted(token)) return;
              const updated = value as SettingsProfile;
              setProfile(updated);
              accepted.current = updated;
              form.reset(profileValues(updated));
              setConfirmOpen(false);
              toast.success(t('settings.profile.success', locale));
            },
          });
          if (staged) setConfirmOpen(true);
        },
        (errors) => {
          feedback.invalid(errors);
          command.coordination.release('profile');
        }
      )(event);
    } finally {
      command.coordination.release('profile');
    }
  }
  function change(name: FieldPath<ProfileFormValues>, value: string) {
    if (!command.coordination.isLocked())
      form.setValue(name, value, {
        shouldDirty: true,
        shouldValidate: !!form.formState.touchedFields[name],
      });
  }
  function cancelConfirmation() {
    if (command.busy || command.phase !== 'ready') return;
    command.cancel();
    setConfirmOpen(false);
  }
  function resetCapture() {
    if (command.busy) return;
    command.resetCapture();
    setConfirmOpen(false);
    setDefaultError(null);
  }
  return {
    profile: acceptedIdentity === identity ? profile : null,
    denied: withdrawn.current,
    loading,
    error,
    confirmOpen,
    defaultProfileId,
    availableProfiles: acceptedIdentity === identity ? availableProfiles : [],
    defaultError,
    form,
    feedback,
    values,
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
  };
}
