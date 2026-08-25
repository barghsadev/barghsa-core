import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
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
} from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'

export const Route = createFileRoute('/_app/settings/profile')({
  component: SettingsProfilePage,
})

// ─── Types ────────────────────────────────────────────────────────────

interface AddressItem {
  id: string
  provinceId: string
  cityId: string
  fullAddress: string
  postalCode: string
  mainAddress: boolean
  createdAt: string
  updatedAt: string
}

interface LegalInfo {
  legalName: string
  nationalIdentifier: string
  registrationNumber: string
  companyTypeId: string | null
  economicCode: string | null
  representativeTitle: string
  representativeRelationship: string
}

interface ProfileDetail {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED'
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
  createdAt: string
  updatedAt: string
  addresses: AddressItem[]
  legalInfo: LegalInfo | null
}

interface ProfileSummary {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: string
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getStatusBadge(status: string, locale: Locale): { label: string; variant: string } {
  switch (status) {
    case 'VERIFIED':
      return { label: locale === 'fa' ? 'تأیید شده' : 'Verified', variant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' }
    case 'ACTIVE':
      return { label: locale === 'fa' ? 'فعال' : 'Active', variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' }
    case 'DRAFT':
      return { label: locale === 'fa' ? 'پیش‌نویس' : 'Draft', variant: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' }
    case 'SUSPENDED':
      return { label: locale === 'fa' ? 'مسدود' : 'Suspended', variant: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' }
    default:
      return { label: status, variant: 'bg-gray-100 text-gray-800' }
  }
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsProfilePage() {
  const locale: Locale = 'fa' // TODO: read from locale context

  const [profile, setProfile] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null)

  // Editable form fields
  const [title, setTitle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nationalId, setNationalId] = useState('')
  const [provinceId, setProvinceId] = useState('')
  const [cityId, setCityId] = useState('')
  const [fullAddress, setFullAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')

  // ── Fetch profile data ──────────────────────────────────────────────

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // First get the default/active profile ID
      const listResponse = await fetch('/api/profiles')
      if (!listResponse.ok) {
        setError(t('settings.profile.error.load', locale))
        return
      }

      const listData: { profiles: ProfileSummary[]; hasDefault: boolean; activeProfileId: string | null } =
        await listResponse.json()

      if (!listData.activeProfileId) {
        setError(t('settings.profile.error.notFound', locale))
        return
      }

      setDefaultProfileId(listData.activeProfileId)

      // Fetch full profile details
      const detailResponse = await fetch(`/api/profiles/${listData.activeProfileId}`)
      if (!detailResponse.ok) {
        if (detailResponse.status === 404) {
          setError(t('settings.profile.error.notFound', locale))
        } else {
          setError(t('settings.profile.error.loadRetry', locale))
        }
        return
      }

      const data: ProfileDetail = await detailResponse.json()
      setProfile(data)

      // Populate form fields
      setTitle(data.title ?? '')
      setFirstName(data.firstName ?? '')
      setLastName(data.lastName ?? '')
      setNationalId(data.nationalId ?? '')

      // Populate main address
      const mainAddress = data.addresses.find((a) => a.mainAddress) ?? data.addresses[0]
      if (mainAddress) {
        setProvinceId(mainAddress.provinceId)
        setCityId(mainAddress.cityId)
        setFullAddress(mainAddress.fullAddress)
        setPostalCode(mainAddress.postalCode)
      }
    } catch {
      setError(t('settings.profile.error.loadRetry', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  // ── Save handler ─────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!defaultProfileId) return

    setSaving(true)

    try {
      const response = await fetch(`/api/profiles/${defaultProfileId}`, {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          title: title || undefined,
          firstName: profile?.status === 'VERIFIED' ? undefined : (firstName || undefined),
          lastName: profile?.status === 'VERIFIED' ? undefined : (lastName || undefined),
          nationalId: profile?.status === 'VERIFIED' ? undefined : (nationalId || undefined),
          provinceId: provinceId || undefined,
          cityId: cityId || undefined,
          fullAddress: fullAddress || undefined,
          postalCode: postalCode || undefined,
        }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const message = (body as { message?: string }).message
        toast.error(message || t('settings.profile.error.save', locale))
        return
      }

      toast.success(t('settings.profile.success', locale))

      // Refresh profile data
      fetchProfile()
    } catch {
      toast.error(t('settings.profile.error.save', locale))
    } finally {
      setSaving(false)
    }
  }, [defaultProfileId, title, firstName, lastName, nationalId, provinceId, cityId, fullAddress, postalCode, profile, locale, fetchProfile])

  // ── Render ──────────────────────────────────────────────────────────

  const isVerified = profile?.status === 'VERIFIED'
  const isLegal = profile?.profileType === 'LEGAL'

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>

      {/* Title */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('settings.profile.title', locale)}</h1>
      </div>

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
                  : t('settings.profile.profileType.INDIVIDUAL', locale)
                }
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

          {/* Legal entity info (read-only) */}
          {isLegal && profile.legalInfo && (
            <div className="rounded-lg border p-4 space-y-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Building2Icon className="h-4 w-4" />
                {t('settings.profile.legalName', locale)}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('settings.profile.legalName', locale)}</Label>
                  <p className="text-sm font-medium">{profile.legalInfo.legalName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('settings.profile.nationalIdentifier', locale)}</Label>
                  <p className="text-sm font-medium">{profile.legalInfo.nationalIdentifier}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{locale === 'fa' ? 'شماره ثبت' : 'Registration No.'}</Label>
                  <p className="text-sm font-medium">{profile.legalInfo.registrationNumber}</p>
                </div>
              </div>
            </div>
          )}

          {/* Identity section */}
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
              {isVerified && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                  <LockIcon className="h-3 w-3" />
                  {locale === 'fa' ? 'تأیید شده' : 'Verified'}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Title */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-title" className="text-xs">{t('settings.profile.title.label', locale)}</Label>
                <Input
                  id="profile-title"
                  placeholder={t('settings.profile.title.placeholder', locale)}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="text-sm"
                />
              </div>

              {/* First name */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-first-name" className="text-xs">
                  {t('settings.profile.firstName', locale)}
                  {isVerified && <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                </Label>
                <Input
                  id="profile-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={isVerified}
                  className={`text-sm ${isVerified ? 'opacity-70' : ''}`}
                />
                {isVerified && (
                  <p className="text-xs text-muted-foreground">{t('settings.profile.identityLocked', locale)}</p>
                )}
              </div>

              {/* Last name */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-last-name" className="text-xs">
                  {t('settings.profile.lastName', locale)}
                  {isVerified && <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />}
                </Label>
                <Input
                  id="profile-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={isVerified}
                  className={`text-sm ${isVerified ? 'opacity-70' : ''}`}
                />
                {isVerified && (
                  <p className="text-xs text-muted-foreground">{t('settings.profile.identityLocked', locale)}</p>
                )}
              </div>
            </div>

            {/* National ID (full width) */}
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="profile-national-id" className="text-xs">
                {t('settings.profile.nationalId', locale)}
                {isVerified && <LockIcon className="h-3 w-3 inline ml-1 text-muted-foreground" />}
              </Label>
              <Input
                id="profile-national-id"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                disabled={isVerified}
                className={`text-sm ${isVerified ? 'opacity-70' : ''}`}
              />
              {isVerified && (
                <p className="text-xs text-muted-foreground">{t('settings.profile.identityLocked', locale)}</p>
              )}
            </div>
          </div>

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
                <Label htmlFor="profile-province" className="text-xs">{t('settings.profile.province', locale)}</Label>
                <Input
                  id="profile-province"
                  placeholder={t('settings.profile.selectProvince', locale)}
                  value={provinceId}
                  onChange={(e) => setProvinceId(e.target.value)}
                  className="text-sm"
                />
              </div>

              {/* City */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-city" className="text-xs">{t('settings.profile.city', locale)}</Label>
                <Input
                  id="profile-city"
                  placeholder={t('settings.profile.selectCity', locale)}
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Full address */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-address" className="text-xs">{t('settings.profile.fullAddress', locale)}</Label>
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
              <Label htmlFor="profile-postal-code" className="text-xs">{t('settings.profile.postalCode', locale)}</Label>
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
                    ? `تعداد کل آدرس‌ها: ${profile.addresses.length}`
                    : `Total addresses: ${profile.addresses.length}`
                  }
                </p>
              </div>
            )}
          </div>

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2"
            >
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving
                ? t('settings.profile.saving', locale)
                : t('settings.profile.save', locale)
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
