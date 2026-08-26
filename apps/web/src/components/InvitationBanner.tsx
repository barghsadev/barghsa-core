import { useState, useEffect, useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Button } from '@barghsa/ui'
import { withCsrf } from '../lib/csrf.js'

// ─── Types ────────────────────────────────────────────────────────────

interface PendingInvitation {
  id: string
  profileId: string
  profileName: string
  role: string
  invitedBy: string
  inviterName: string | null
  createdAt: string
  expiresAt: string | null
}

interface PendingInvitationsResponse {
  invitations: PendingInvitation[]
}

interface ActionState {
  accepting: boolean
  declining: boolean
  done: boolean
  doneAction: 'accept' | 'decline' | null
}

const defaultActionState = (): ActionState => ({
  accepting: false,
  declining: false,
  done: false,
  doneAction: null,
})

// ─── Props ────────────────────────────────────────────────────────────

interface InvitationBannerProps {
  locale?: Locale
}

// ─── Component ────────────────────────────────────────────────────────

/**
 * InvitationBanner (T-05.04.03).
 *
 * Fetches pending invitations for the current user and shows a banner
 * at the top of dashboard pages when there are pending invitations.
 * Each invitation shows the legal entity name, role, and inviter info,
 * with Accept and Decline buttons.
 */
export function InvitationBanner({ locale = 'fa' }: InvitationBannerProps) {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({})
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const isRtl = locale === 'fa'

  // ── Fetch pending invitations ─────────────────────────────────

  const fetchInvitations = useCallback(async () => {
    try {
      const response = await fetch('/api/invitations/pending', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })

      if (response.status === 401) {
        setLoading(false)
        return
      }

      if (!response.ok) {
        setLoading(false)
        return
      }

      const data: PendingInvitationsResponse = await response.json()
      setInvitations(data.invitations)
    } catch {
      // Silently fail — banner is non-critical UI
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInvitations()
  }, [fetchInvitations])

  // ── Accept invitation ─────────────────────────────────────────

  const handleAccept = useCallback(async (inviteId: string) => {
    setActionStates((prev) => {
      const current = prev[inviteId] ?? defaultActionState()
      return { ...prev, [inviteId]: { ...current, accepting: true, declining: false } }
    })
    setError(null)

    try {
      const response = await fetch(`/api/invitations/${inviteId}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      })

      if (!response.ok) {
        setError(t('invitation.banner.error', locale))
        setActionStates((prev) => {
          const current = prev[inviteId] ?? defaultActionState()
          return { ...prev, [inviteId]: { ...current, accepting: false } }
        })
        return
      }

      setActionStates((prev) => {
        const current = prev[inviteId] ?? defaultActionState()
        return { ...prev, [inviteId]: { ...current, accepting: false, done: true, doneAction: 'accept' } }
      })

      // Refresh the page after a brief delay
      setTimeout(() => {
        router.invalidate()
      }, 1500)
    } catch {
      setError(t('invitation.banner.error', locale))
      setActionStates((prev) => {
        const current = prev[inviteId] ?? defaultActionState()
        return { ...prev, [inviteId]: { ...current, accepting: false } }
      })
    }
  }, [locale, router])

  // ── Decline invitation ────────────────────────────────────────

  const handleDecline = useCallback(async (inviteId: string) => {
    setActionStates((prev) => {
      const current = prev[inviteId] ?? defaultActionState()
      return { ...prev, [inviteId]: { ...current, declining: true, accepting: false } }
    })
    setError(null)

    try {
      const response = await fetch(`/api/invitations/${inviteId}/decline`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
      })

      if (!response.ok) {
        setError(t('invitation.banner.error', locale))
        setActionStates((prev) => {
          const current = prev[inviteId] ?? defaultActionState()
          return { ...prev, [inviteId]: { ...current, declining: false } }
        })
        return
      }

      setActionStates((prev) => {
        const current = prev[inviteId] ?? defaultActionState()
        return { ...prev, [inviteId]: { ...current, declining: false, done: true, doneAction: 'decline' } }
      })

      // Refresh the page after a brief delay
      setTimeout(() => {
        router.invalidate()
      }, 1500)
    } catch {
      setError(t('invitation.banner.error', locale))
      setActionStates((prev) => {
        const current = prev[inviteId] ?? defaultActionState()
        return { ...prev, [inviteId]: { ...current, declining: false } }
      })
    }
  }, [locale, router])

  // ── Render ────────────────────────────────────────────────────

  if (loading || invitations.length === 0) {
    return null
  }

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      {error && (
        <div
          className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      {invitations.map((inv) => {
        const state = actionStates[inv.id] ?? defaultActionState()

        if (state.done) {
          return (
            <div
              key={inv.id}
              className="bg-green-50 border-b border-green-200 px-4 py-3 text-sm text-green-800"
              role="alert"
            >
              {state.doneAction === 'accept'
                ? t('invitation.banner.accepted', locale)
                : t('invitation.banner.declined', locale)}
            </div>
          )
        }

        const displayDate = new Date(inv.createdAt).toLocaleDateString(
          locale === 'fa' ? 'fa-IR' : 'en-US',
        )

        return (
          <div
            key={inv.id}
            className="bg-blue-50 border-b border-blue-200 px-4 py-3 text-sm"
            role="alert"
          >
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-blue-900">
                  {t('invitation.banner.title', locale)
                    .replace('{entity}', inv.profileName)
                    .replace('{role}', inv.role)}
                </span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-blue-700">
                  <span>
                    {t('invitation.banner.invitedBy', locale)
                      .replace('{name}', inv.inviterName ?? inv.invitedBy)}
                  </span>
                  <span>
                    {t('invitation.banner.date', locale)
                      .replace('{date}', displayDate)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleAccept(inv.id)}
                  disabled={state.accepting || state.declining}
                >
                  {state.accepting
                    ? t('invitation.banner.accepting', locale)
                    : t('invitation.banner.accept', locale)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDecline(inv.id)}
                  disabled={state.accepting || state.declining}
                >
                  {state.declining
                    ? t('invitation.banner.declining', locale)
                    : t('invitation.banner.decline', locale)}
                </Button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}