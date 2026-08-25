import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Badge } from '@barghsa/ui'

/** Profile shape returned by GET /api/profiles (T-03.01.01). */
export interface SwitcherProfile {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  isDefault: boolean
  status: 'DRAFT' | 'ACTIVE' | 'VERIFIED' | 'SUSPENDED'
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
}

export interface ProfileSwitchResponse {
  activeProfileId: string | null
}

interface ProfilesResponse {
  profiles: SwitcherProfile[]
  hasDefault: boolean
  activeProfileId: string | null
}

interface ProfileSwitcherProps {
  locale?: Locale
}

/**
 * ProfileSwitcher (T-03.03.01).
 *
 * Top-of-sidebar control showing the current active profile and letting the
 * user switch between the profiles they can access (as owner or agent).
 *
 * - Fetches the profile list from `GET /api/profiles`.
 * - On switch, calls `POST /api/profiles/switch/:profileId` and, on success,
 *   re-fetches the list so `activeProfileId` reflects the change, then
 *   invalidates the router so all profile-scoped page data refreshes.
 * - When the user has a single profile, renders it read-only (no dropdown).
 *
 * The dropdown uses the native `<select>` for reliable RTL + a11y behavior
 * with minimal JS; the current profile is shown as a labeled badge row above
 * the selector.
 */
export function ProfileSwitcher({ locale = 'fa' }: ProfileSwitcherProps) {
  const router = useRouter()
  const [profiles, setProfiles] = useState<SwitcherProfile[] | null>(null)
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRtl = locale === 'fa'

  async function loadProfiles() {
    try {
      const response = await fetch('/api/profiles', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (response.status === 401) {
        // Not authenticated — render nothing.
        setLoading(false)
        return
      }
      if (!response.ok) {
        setLoading(false)
        return
      }
      const data: ProfilesResponse = await response.json()
      setProfiles(data.profiles)
      setActiveProfileId(data.activeProfileId)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  // Re-run whenever the active profile may have changed externally (e.g.
  // onboarding completion or a navigation). Keeps the sidebar in sync.
  useEffect(() => {
    setLoading(true)
    loadProfiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.state.location.pathname])

  const activeProfile = useMemo(
    () => profiles?.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  )

  const profileName = useMemo(() => {
    if (!activeProfile) return null
    const parts = [activeProfile.title, activeProfile.firstName, activeProfile.lastName]
      .filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : null
  }, [activeProfile])

  // Single profile (or none renderable) — no switching needed.
  if (loading || !profiles || profiles.length === 0) return null
  if (profiles.length === 1) {
    return (
      <div
        className="flex items-center gap-2 px-1 py-2"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <span className="text-xs font-medium text-gray-600 truncate">
          {profileName ?? t('dashboard.profile.unnamed', locale)}
        </span>
        <TypeBadge profileType={activeProfile?.profileType} locale={locale} />
      </div>
    )
  }

  async function handleSwitch(profileId: string) {
    if (profileId === activeProfileId || switching) return
    setSwitching(true)
    setError(null)
    try {
      const response = await fetch(`/api/profiles/switch/${profileId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) {
        setError(t('dashboard.profile.switchError', locale))
        setSwitching(false)
        return
      }
      const data: ProfileSwitchResponse = await response.json()
      setActiveProfileId(data.activeProfileId)
      // Refresh profile-scoped page data after switching.
      router.invalidate()
    } catch {
      setError(t('dashboard.profile.switchError', locale))
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
      <label
        htmlFor="profile-switcher"
        className="flex items-center gap-2 text-sm font-medium text-gray-800"
      >
        <span className="truncate">{profileName ?? t('dashboard.profile.unnamed', locale)}</span>
        <TypeBadge profileType={activeProfile?.profileType} locale={locale} />
      </label>

      <select
        id="profile-switcher"
        value={activeProfileId ?? ''}
        disabled={switching}
        onChange={(e) => handleSwitch(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        aria-label={t('dashboard.profile.switchLabel', locale)}
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {formatProfileOption(profile, locale)}
          </option>
        ))}
      </select>

      {switching && (
        <p className="text-xs text-gray-500">{t('dashboard.profile.switching', locale)}</p>
      )}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}

function formatProfileOption(profile: SwitcherProfile, locale: Locale): string {
  const parts = [profile.title, profile.firstName, profile.lastName].filter(Boolean)
  const name = parts.length > 0 ? parts.join(' ') : t('dashboard.profile.unnamed', locale)
  const type =
    profile.profileType === 'LEGAL'
      ? t('dashboard.profile.typeLegal', locale)
      : t('dashboard.profile.typeIndividual', locale)
  return `${name} (${type})`
}

function TypeBadge({
  profileType,
  locale,
}: {
  profileType: SwitcherProfile['profileType'] | undefined
  locale: Locale
}) {
  if (!profileType) return null
  const isLegal = profileType === 'LEGAL'
  return (
    <Badge variant={isLegal ? 'secondary' : 'outline'} className="shrink-0">
      {isLegal
        ? t('dashboard.profile.typeLegal', locale)
        : t('dashboard.profile.typeIndividual', locale)}
    </Badge>
  )
}