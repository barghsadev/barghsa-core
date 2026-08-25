import { useState } from 'react'
import { createFileRoute, useRouter, useSearch } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { Button } from '@barghsa/ui'

export const Route = createFileRoute('/onboarding/complete')({
  component: OnboardingCompletePage,
  validateSearch: (search: Record<string, string | undefined>) => ({
    profileId: search.profileId as string | undefined,
  }),
})

/**
 * Simple confetti-like particle effect using CSS animations.
 * Spawns colourful squares that drift and fade out.
 */
function Confetti() {
  const particles = Array.from({ length: 40 }, (_, i) => {
    const hue = (i * 37 + 180) % 360
    const left = `${(i / 40) * 100}%`
    const delay = `${(i * 0.08).toFixed(2)}s`
    const duration = `${(1.5 + Math.random() * 1.5).toFixed(2)}s`
    const size = `${6 + Math.random() * 6}px`

    return (
      <span
        key={i}
        className="absolute top-0 animate-confetti-drop"
        style={{
          left,
          width: size,
          height: size,
          backgroundColor: `hsl(${hue}, 80%, 60%)`,
          animationDelay: delay,
          animationDuration: duration,
          borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          opacity: 0,
        }}
        aria-hidden="true"
      />
    )
  })

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden="true"
    >
      {particles}
    </div>
  )
}

function OnboardingCompletePage() {
  const locale: Locale = 'fa'
  const isRtl = locale === 'fa'
  const router = useRouter()
  const { profileId: searchProfileId } = useSearch({ from: Route.id })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAddAnother() {
    router.navigate({ to: '/onboarding', replace: true })
  }

  async function handleGoToDashboard() {
    setLoading(true)
    setError(null)

    try {
      // If we have a profileId from search params, complete that one.
      // Otherwise (e.g. direct URL access), try the first ACTIVE/DRAFT profile.
      const profileId = searchProfileId
        ? searchProfileId
        : await (async () => {
            const profilesRes = await fetch('/api/profiles', { credentials: 'include' })
            if (!profilesRes.ok) return null
            const profilesData = await profilesRes.json() as { profiles: Array<{ id: string; status: string }> }
            const p = profilesData.profiles?.find(
              (p: { status: string }) => p.status === 'ACTIVE' || p.status === 'DRAFT',
            )
            return p?.id ?? null
          })()

      if (profileId) {
        await fetch(`/api/onboarding/complete/${profileId}`, {
          method: 'POST',
          credentials: 'include',
        }).catch(() => {
          // Idempotent — failure is non-blocking
        })
      }

      router.navigate({ to: '/app', replace: true })
    } catch {
      setError(t('onboarding.complete.error', locale) || 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <div
      className="container relative mx-auto flex min-h-screen items-center justify-center p-4"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <Confetti />

      <div className="max-w-md text-center">
        {/* Success icon */}
        <div
          className="mx-auto mb-6 flex h-20 w-20 animate-bounce-once items-center justify-center rounded-full bg-green-100"
          aria-hidden="true"
        >
          <svg
            className="h-10 w-10 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold">
          {t('onboarding.complete.title', locale)}
        </h1>
        <p className="mb-8 text-muted-foreground">
          {t('onboarding.complete.subtitle', locale)}
        </p>

        {error && (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={handleAddAnother}
            disabled={loading}
          >
            {t('onboarding.complete.addAnother', locale)}
          </Button>
          <Button
            type="button"
            onClick={handleGoToDashboard}
            disabled={loading}
          >
            {loading
              ? '…'
              : t('onboarding.complete.goToDashboard', locale)}
          </Button>
        </div>
      </div>

      {/* Keyframe for confetti drop */}
      <style>{`
        @keyframes confetti-drop {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti-drop {
          animation: confetti-drop ease-in forwards;
        }
        @keyframes bounce-once {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); opacity: 1; }
        }
        .animate-bounce-once {
          animation: bounce-once 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  )
}