import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui'
import { Button } from '@barghsa/ui'
import { RadioGroup, RadioGroupItem } from '@barghsa/ui'
import { Label } from '@barghsa/ui'

/** Profile shape returned by GET /api/profiles (T-03.01.01). */
interface ProfileBrief {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  title: string | null
  firstName: string | null
  lastName: string | null
}

interface ProfilesResponse {
  profiles: ProfileBrief[]
  hasDefault: boolean
  activeProfileId: string | null
}

/**
 * DefaultProfileModal (T-03.03.02).
 *
 * On login, if the user has multiple profiles but no default profile set,
 * this forced modal blocks navigation until the user selects one. The
 * modal is non-dismissible — no backdrop click, no escape key, no close
 * button — because without a default profile the app cannot determine
 * which profile's data to show.
 *
 * - Fetches the profile list from `GET /api/profiles`.
 * - If `hasDefault === false && profiles.length > 1`, renders the modal.
 * - Radio-group list of profiles; user selects one and clicks "Set as default".
 * - Calls `POST /api/profiles/:id/set-default`, then invalidates the router so
 *   the app-level profile check (T-03.01.01) re-evaluates and proceeds.
 * - Renders nothing when the user has a default, only one profile, or none.
 */
export function DefaultProfileModal() {
  const router = useRouter()
  const [profiles, setProfiles] = useState<ProfileBrief[] | null>(null)
  const [hasDefault, setHasDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [setting, setSetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const locale: Locale = 'fa' // TODO: read from locale context
  const isRtl = locale === 'fa'

  useEffect(() => {
    let cancelled = false

    async function fetchProfiles() {
      try {
        const response = await fetch('/api/profiles', {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })

        // Not authenticated — no modal
        if (response.status === 401) {
          if (!cancelled) setLoading(false)
          return
        }

        if (!response.ok) {
          if (!cancelled) setLoading(false)
          return
        }

        const data: ProfilesResponse = await response.json()
        if (!cancelled) {
          setProfiles(data.profiles)
          setHasDefault(data.hasDefault)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    fetchProfiles()

    return () => {
      cancelled = true
    }
  }, [])

  // Don't render anything while loading or if we have no data.
  if (loading || !profiles) return null

  // Only show the modal when the user has multiple profiles and no default.
  if (hasDefault || profiles.length <= 1) return null

  async function handleSetDefault() {
    if (!selectedId || setting) return
    setSetting(true)
    setError(null)

    try {
      const response = await fetch(`/api/profiles/${selectedId}/set-default`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })

      if (response.ok) {
        // Invalidate the router so the app-level profile check re-evaluates
        // and the user proceeds to the dashboard.
        router.invalidate()
      } else {
        setSetting(false)
        setError(t('dashboard.profile.switchError', locale))
      }
    } catch {
      setSetting(false)
      setError(t('dashboard.profile.switchError', locale))
    }
  }

  function formatProfileName(profile: ProfileBrief): string {
    const parts = [profile.title, profile.firstName, profile.lastName].filter(Boolean)
    const name = parts.length > 0 ? parts.join(' ') : t('dashboard.profile.unnamed', locale)
    const type =
      profile.profileType === 'LEGAL'
        ? t('dashboard.profile.typeLegal', locale)
        : t('dashboard.profile.typeIndividual', locale)
    return `${name} (${type})`
  }

  // Auto-select the first profile so there's always a valid selection.
  const resolvedSelected = selectedId ?? profiles[0]?.id ?? null

  return (
    <Dialog open={true} onOpenChange={() => {
      // Intentionally no-op: the modal is forced and non-dismissible.
    }}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <DialogHeader>
          <DialogTitle>
            {t('dashboard.profile.default.title', locale)}
          </DialogTitle>
          <DialogDescription>
            {t('dashboard.profile.default.description', locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <RadioGroup
            value={resolvedSelected}
            onValueChange={(value: string) => setSelectedId(value)}
            aria-label={t('dashboard.profile.default.title', locale)}
          >
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <RadioGroupItem value={profile.id} id={`profile-${profile.id}`} />
                <Label
                  htmlFor={`profile-${profile.id}`}
                  className="cursor-pointer text-sm font-medium"
                >
                  {formatProfileName(profile)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {error && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            onClick={handleSetDefault}
            disabled={!resolvedSelected || setting}
          >
            {setting
              ? t('dashboard.profile.default.setting', locale)
              : t('dashboard.profile.default.setAsDefault', locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}