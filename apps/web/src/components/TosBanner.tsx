import { useState, useEffect, useCallback } from 'react'
import { t, type Locale } from '@barghsa/i18n'
import { Button } from '@barghsa/ui'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui'
import { AlertCircleIcon, CheckIcon, Loader2Icon } from 'lucide-react'
import { withCsrf } from '../lib/csrf.js'

// ─── Types ────────────────────────────────────────────────────────────

interface UserInfo {
  userId: string
  username: string
  email: string | null
  mobile: string | null
  requiresTosAcceptance: boolean
}

interface CurrentTosResponse {
  content: string
  versionId: string
  updatedAt: string
  publishedAt: string
}

// ─── Props ────────────────────────────────────────────────────────────

interface TosBannerProps {
  locale?: Locale
}

// ─── Component ────────────────────────────────────────────────────────

/**
 * TOS re-acceptance banner (T-04.01.03).
 *
 * Fetches the current user info and shows a sticky banner at the top of
 * dashboard pages when the user needs to re-accept updated Terms of Service.
 * The [Review] button opens a modal showing the full TOS with an accept button.
 * The modal also opens automatically on the first non-exempt page visit when
 * re-acceptance is required, with an explicit dismiss from the user suppressing
 * further auto-opens within the same session.
 *
 * The banner does NOT appear on exempt pages: auth/*, account recovery,
 * support, or the TOS page itself — but since this component is rendered
 * inside DashboardLayout and AdminLayout those are already authenticated pages.
 */
export function TosBanner({ locale = 'fa' }: TosBannerProps) {
  const [requiresAcceptance, setRequiresAcceptance] = useState(false)
  const [checking, setChecking] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [currentTos, setCurrentTos] = useState<CurrentTosResponse | null>(null)
  const [loadingTos, setLoadingTos] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissedAutoModal, setDismissedAutoModal] = useState(false)

  // ── Check TOS acceptance status ─────────────────────────────────

  const checkTosStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/user')
      if (!response.ok) {
        setChecking(false)
        return
      }
      const data: UserInfo = await response.json()
      setRequiresAcceptance(data.requiresTosAcceptance)
    } catch {
      // Silently fail — banner is non-critical UI
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    checkTosStatus()
  }, [checkTosStatus])

  // ── Auto-open modal on first non-exempt page visit ─────────────

  useEffect(() => {
    if (requiresAcceptance && !dismissedAutoModal) {
      openReviewModal()
    }
  }, [requiresAcceptance, dismissedAutoModal, openReviewModal])

  // ── Fetch current TOS content for modal ─────────────────────────

  const openReviewModal = useCallback(async () => {
    setShowModal(true)
    setLoadingTos(true)
    setError(null)

    try {
      const response = await fetch(`/api/tos/current?locale=${locale}`)
      if (!response.ok) {
        setError(t('tos.page.error', locale))
        return
      }
      const data: CurrentTosResponse = await response.json()
      setCurrentTos(data)
    } catch {
      setError(t('tos.page.error', locale))
    } finally {
      setLoadingTos(false)
    }
  }, [locale])

  // ── Accept TOS ──────────────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (!currentTos) return

    setAccepting(true)
    setError(null)

    try {
      const response = await fetch('/api/tos/accept', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ versionId: currentTos.versionId }),
      })

      if (!response.ok) {
        setError(t('tos.modal.error', locale))
        return
      }

      setAccepted(true)
      setRequiresAcceptance(false)

      // Close modal after brief success state
      setTimeout(() => {
        setShowModal(false)
        setAccepted(false)
      }, 1500)
    } catch {
      setError(t('tos.modal.error', locale))
    } finally {
      setAccepting(false)
    }
  }, [currentTos, locale])

  // ── Render ──────────────────────────────────────────────────────

  if (checking || !requiresAcceptance) {
    return null
  }

  return (
    <>
      {/* Sticky banner */}
      <div
        className="sticky top-0 z-40 flex items-center justify-between gap-4 bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm"
        role="alert"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center gap-2">
          <AlertCircleIcon className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-amber-800">{t('tos.banner.text', locale)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="default"
            size="sm"
            onClick={openReviewModal}
          >
            {t('tos.banner.review', locale)}
          </Button>
        </div>
      </div>

      {/* Review modal */}
      <Dialog open={showModal} onOpenChange={(open) => {
        if (!open && !accepted) {
          setDismissedAutoModal(true)
        }
        setShowModal(open)
      }}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('tos.modal.title', locale)}</DialogTitle>
            {currentTos && (
              <DialogDescription>
                {t('tos.page.lastUpdated', locale).replace('{date}', new Date(currentTos.updatedAt).toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US'))}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* TOS content area */}
          <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[50vh] border rounded-md p-4 bg-white">
            {loadingTos && (
              <div className="flex items-center justify-center h-full">
                <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {error && (
              <div className="flex items-center justify-center h-full text-red-500">
                <p>{error}</p>
              </div>
            )}
            {currentTos && !loadingTos && !error && (
              <div
                className="prose prose-sm max-w-none"
                dir={locale === 'fa' ? 'rtl' : 'ltr'}
              >
                {currentTos.content.split('\n').map((line, i) => (
                  <p key={i} className="mb-2">{line}</p>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            {accepted ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckIcon className="h-4 w-4" />
                <span>{t('tos.modal.success', locale)}</span>
              </div>
            ) : (
              <Button
                onClick={handleAccept}
                disabled={accepting || !currentTos}
              >
                {accepting ? (
                  <>
                    <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                    {t('tos.modal.accepting', locale)}
                  </>
                ) : (
                  t('tos.modal.accept', locale)
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}