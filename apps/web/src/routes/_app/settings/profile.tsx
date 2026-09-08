import { useNumberFormatting } from '../../../hooks/useNumberFormatting.js';
import { LegalProfileDocuments } from '../../../components/LegalProfileDocuments.js';
import { useState, useEffect, useCallback } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { t, type Locale } from '@barghsa/i18n/crm';
import {
  UserIcon,
  Building2Icon,
  MapPinIcon,
  LockIcon,
  AlertCircleIcon,
  SaveIcon,
  Loader2Icon,
  BadgeCheckIcon,
  ShieldAlertIcon,
} from 'lucide-react';
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { useLocale } from '../../../hooks/useLocale.js';
import { refreshProfileContext } from '../../../lib/profile-context.js';

export const Route = createFileRoute('/_app/settings/profile')({
  component: SettingsProfilePage,
});

// ─── Types ────────────────────────────────────────────────────────────

interface AddressItem {
  provinceNameFa?: string;
  provinceNameEn?: string;
  cityNameFa?: string;
  cityNameEn?: string;
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LegalInfo {
  representativePostalCode?: string | null;
  representativeFullAddress?: string | null;
  representativeNationalId?: string | null;
  representativeLastName?: string | null;
  representativeFirstName?: string | null;
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  economicCode: string | null;
  representativeTitle: string;
  representativeRelationship: string;
}

interface ProfileDetail {
  canEditIdentity?: boolean;
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  isDefault: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED';
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  createdAt: string;
  updatedAt: string;
  addresses: AddressItem[];
  legalInfo: LegalInfo | null;
}

interface ProfileSummary {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  isDefault: boolean;
  status: string;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getStatusBadge(status: string, locale: Locale): { label: string; variant: string } {
  switch (status) {
    case 'VERIFIED':
      return {
        label: locale === 'fa' ? 'تأیید شده' : 'Verified',
        variant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
      };
    case 'ACTIVE':
      return {
        label: locale === 'fa' ? 'فعال' : 'Active',
        variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
      };
    case 'PENDING_VERIFICATION':
      return {
        label: t('crm.list.PENDING_VERIFICATION', locale),
        variant: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      };
    case 'DRAFT':
      return {
        label: locale === 'fa' ? 'پیش‌نویس' : 'Draft',
        variant: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
      };
    case 'SUSPENDED':
      return {
        label: locale === 'fa' ? 'مسدود' : 'Suspended',
        variant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
      };
    default:
      return { label: status, variant: 'bg-gray-100 text-gray-800' };
  }
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsProfilePage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);

  const [profile, setProfile] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<ProfileSummary[]>([]);
  const [settingDefault, setSettingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  // Editable form fields
  const [title, setTitle] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [provinceId, setProvinceId] = useState('');
  const [cityId, setCityId] = useState('');
  const [legalName, setLegalName] = useState('');
  const [nationalIdentifier, setNationalIdentifier] = useState('');
  const [fullAddress, setFullAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');

  const [provinces, setProvinces] = useState<Array<{ id: string; nameFa: string; nameEn: string }>>(
    []
  );
  const [cities, setCities] = useState<Array<{ id: string; nameFa: string; nameEn: string }>>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
  const [provinceError, setProvinceError] = useState(false);
  const [cityError, setCityError] = useState(false);
  const [geographyRetry, setGeographyRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingProvinces(true);
    setProvinceError(false);
    fetch('/api/geography/provinces', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Provinces unavailable');
        return response.json() as Promise<Array<{ id: string; nameFa: string; nameEn: string }>>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setProvinces(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProvinceError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProvinces(false);
      });
    return () => controller.abort();
  }, [geographyRetry]);
  useEffect(() => {
    const controller = new AbortController();
    setCities([]);
    setCityError(false);
    if (!provinceId) {
      setLoadingCities(false);
      return;
    }
    setLoadingCities(true);
    fetch(`/api/geography/provinces/${provinceId}/cities`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Cities unavailable');
        return response.json() as Promise<Array<{ id: string; nameFa: string; nameEn: string }>>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setCities(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCityError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCities(false);
      });
    return () => controller.abort();
  }, [provinceId, geographyRetry]);

  // ── Fetch profile data ──────────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // First get the default/active profile ID
      const listResponse = await fetch('/api/profiles');
      if (!listResponse.ok) {
        setError(t('settings.profile.error.load', locale));
        return;
      }

      const listData: {
        profiles: ProfileSummary[];
        hasDefault: boolean;
        activeProfileId: string | null;
      } = await listResponse.json();

      setAvailableProfiles(listData.profiles);
      if (!listData.activeProfileId) {
        setError(t('settings.profile.error.notFound', locale));
        return;
      }

      setDefaultProfileId(listData.activeProfileId);

      // Fetch full profile details
      const detailResponse = await fetch(`/api/profiles/${listData.activeProfileId}`);
      if (!detailResponse.ok) {
        if (detailResponse.status === 404) {
          setError(t('settings.profile.error.notFound', locale));
        } else {
          setError(t('settings.profile.error.loadRetry', locale));
        }
        return;
      }

      const data: ProfileDetail = await detailResponse.json();
      setProfile(data);

      // Populate form fields
      setTitle(data.title ?? '');
      setFirstName(data.firstName ?? '');
      setLastName(data.lastName ?? '');
      setNationalId(data.nationalId ?? '');
      setLegalName(data.legalInfo?.legalName ?? '');
      setNationalIdentifier(data.legalInfo?.nationalIdentifier ?? '');

      // Populate main address
      const mainAddress = data.addresses.find((a) => a.mainAddress);
      if (mainAddress) {
        setProvinceId(mainAddress.provinceId);
        setCityId(mainAddress.cityId);
        setFullAddress(mainAddress.fullAddress);
        setPostalCode(mainAddress.postalCode);
      } else {
        setProvinceId('');
        setCityId('');
        setFullAddress('');
        setPostalCode('');
      }
    } catch {
      setError(t('settings.profile.error.loadRetry', locale));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  async function changeDefault(profileId: string) {
    if (!profileId || settingDefault || saving || profileId === defaultProfileId) return;
    setSettingDefault(true);
    setDefaultError(null);
    try {
      const response = await fetch(`/api/profiles/default/${encodeURIComponent(profileId)}`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      });
      if (!response.ok) throw new Error('Profile switch failed');
      const result: { activeProfileId?: string } = await response.json();
      if (result.activeProfileId !== profileId) throw new Error('Unexpected profile');
      refreshProfileContext();
    } catch {
      setDefaultError(t('dashboard.profile.switchError', locale));
    } finally {
      setSettingDefault(false);
    }
  }

  // ── Save handler ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!defaultProfileId) return;

    setSaving(true);

    try {
      if (!profile) return;
      const payload: Record<string, unknown> = {};
      if (title !== (profile.title ?? '')) payload.title = title;
      const editable =
        profile.profileType === 'INDIVIDUAL' &&
        (profile.status !== 'VERIFIED' || profile.canEditIdentity === true);
      if (editable) {
        if (firstName !== (profile.firstName ?? '')) payload.firstName = firstName;
        if (lastName !== (profile.lastName ?? '')) payload.lastName = lastName;
        if (nationalId !== (profile.nationalId ?? '')) payload.nationalId = nationalId;
      }
      if (profile.profileType === 'LEGAL' && profile.status !== 'VERIFIED' && profile.legalInfo) {
        if (legalName !== profile.legalInfo.legalName) payload.legalName = legalName;
        if (nationalIdentifier !== profile.legalInfo.nationalIdentifier)
          payload.nationalIdentifier = nationalIdentifier;
      }
      const main = profile.addresses.find((address) => address.mainAddress);
      const addressChanged =
        provinceId !== (main?.provinceId ?? '') ||
        cityId !== (main?.cityId ?? '') ||
        fullAddress !== (main?.fullAddress ?? '') ||
        postalCode !== (main?.postalCode ?? '');
      if (addressChanged) {
        if (
          loadingProvinces ||
          loadingCities ||
          provinceError ||
          cityError ||
          !provinceId ||
          !cityId ||
          !fullAddress.trim() ||
          !postalCode.trim()
        ) {
          toast.error(t('settings.profile.error.save', locale));
          return;
        }
        Object.assign(payload, { provinceId, cityId, fullAddress, postalCode });
      }
      if (!Object.keys(payload).length) return;
      const response = await fetch(`/api/profiles/${defaultProfileId}`, {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = (body as { message?: string }).message;
        toast.error(message || t('settings.profile.error.save', locale));
        return;
      }

      toast.success(t('settings.profile.success', locale));

      // Refresh profile data
      fetchProfile();
    } catch {
      toast.error(t('settings.profile.error.save', locale));
    } finally {
      setSaving(false);
    }
  }, [
    defaultProfileId,
    legalName,
    nationalIdentifier,
    loadingProvinces,
    loadingCities,
    provinceError,
    cityError,
    title,
    firstName,
    lastName,
    nationalId,
    provinceId,
    cityId,
    fullAddress,
    postalCode,
    profile,
    locale,
    fetchProfile,
  ]);

  // ── Render ──────────────────────────────────────────────────────────

  const isIdentityLocked =
    profile?.profileType === 'LEGAL' ||
    (profile?.status === 'VERIFIED' && profile.canEditIdentity !== true);
  const isLegal = profile?.profileType === 'LEGAL';
  const savedMainAddress = profile?.addresses.find((address) => address.mainAddress);

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
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
            disabled={loading || saving || settingDefault}
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
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Profile detail form */}
      {!loading && !error && profile && (
        <div className="space-y-8">
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
                    {profile.status === 'VERIFIED' && <LockIcon className="inline h-3 w-3 ms-1" />}
                  </Label>
                  <Input
                    id="profile-legalName"
                    value={legalName}
                    onChange={(event) => setLegalName(event.target.value)}
                    disabled={profile.status === 'VERIFIED'}
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
                    {profile.status === 'VERIFIED' && <LockIcon className="inline h-3 w-3 ms-1" />}
                  </Label>
                  <Input
                    id="profile-nationalIdentifier"
                    value={nationalIdentifier}
                    onChange={(event) => setNationalIdentifier(event.target.value)}
                    disabled={profile.status === 'VERIFIED'}
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
                  <dd>{profile.legalInfo?.[field] || t('settings.profile.notProvided', locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          {isLegal && <LegalProfileDocuments profileId={profile.id} />}

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="profile-title" className="text-xs">
              {t('settings.profile.title.label', locale)}
            </Label>
            <Input
              id="profile-title"
              placeholder={t('settings.profile.title.placeholder', locale)}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-sm"
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
                    {isIdentityLocked && (
                      <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />
                    )}
                  </Label>
                  <Input
                    id="profile-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    disabled={isIdentityLocked}
                    className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
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
                    {isIdentityLocked && (
                      <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />
                    )}
                  </Label>
                  <Input
                    id="profile-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={isIdentityLocked}
                    className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
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
                  {isIdentityLocked && (
                    <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />
                  )}
                </Label>
                <Input
                  id="profile-national-id"
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  disabled={isIdentityLocked}
                  className={`text-sm ${isIdentityLocked ? 'opacity-70' : ''}`}
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
                <select
                  id="profile-province"
                  value={provinceId}
                  onChange={(event) => {
                    setProvinceId(event.target.value);
                    setCityId('');
                    setCities([]);
                  }}
                  disabled={saving || loadingProvinces || provinceError}
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
              </div>

              {/* City */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-city" className="text-xs">
                  {t('settings.profile.city', locale)}
                </Label>
                <select
                  id="profile-city"
                  value={cityId}
                  onChange={(event) => {
                    setCityId(event.target.value);
                  }}
                  disabled={saving || loadingCities || cityError || !provinceId}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('settings.profile.selectCity', locale)}</option>
                  {cityId && !cities.some((item) => item.id === cityId) && (
                    <option value={cityId}>
                      {(savedMainAddress?.cityId === cityId &&
                        (locale === 'fa'
                          ? savedMainAddress.cityNameFa
                          : savedMainAddress.cityNameEn)) ||
                        t('settings.addresses.unknownCity', locale)}
                    </option>
                  )}
                  {cities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {locale === 'fa' ? item.nameFa : item.nameEn}
                    </option>
                  ))}
                </select>
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
                  onClick={() => setGeographyRetry((value) => value + 1)}
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
              <textarea
                id="profile-address"
                value={fullAddress}
                onChange={(e) => setFullAddress(e.target.value)}
                maxLength={500}
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                dir={locale === 'fa' ? 'rtl' : 'ltr'}
              />
            </div>

            {/* Postal code */}
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="profile-postal-code" className="text-xs">
                {t('settings.profile.postalCode', locale)}
              </Label>
              <Input
                id="profile-postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="text-sm"
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

          {/* Save button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving ? t('settings.profile.saving', locale) : t('settings.profile.save', locale)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
