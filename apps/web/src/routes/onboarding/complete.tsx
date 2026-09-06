import { useLocale } from '../../hooks/useLocale.js';
import { withCsrf } from '../../lib/csrf.js';
import { useEffect, useState } from 'react';
import { createFileRoute, useRouter, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n';
import { Button } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/complete')({
  component: OnboardingCompletePage,
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: typeof search.profileId === 'string' ? search.profileId : undefined,
  }),
});

/**
 * Simple confetti-like particle effect using CSS animations.
 * Spawns colourful squares that drift and fade out.
 */
function Confetti() {
  const particles = Array.from({ length: 40 }, (_, i) => {
    const hue = (i * 37 + 180) % 360;
    const left = `${(i / 40) * 100}%`;
    const delay = `${(i * 0.08).toFixed(2)}s`;
    const duration = `${(1.5 + Math.random() * 1.5).toFixed(2)}s`;
    const size = `${6 + Math.random() * 6}px`;

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
    );
  });

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden"
      aria-hidden="true"
    >
      <style>{`@keyframes confetti-drop {0% {transform:translateY(-10vh) rotate(0deg);opacity:1;}100% {transform:translateY(100vh) rotate(720deg);opacity:0;}} .animate-confetti-drop {animation:confetti-drop ease-in forwards;}`}</style>
      {particles}
    </div>
  );
}

function OnboardingCompletePage() {
  const locale = useLocale();
  const router = useRouter();
  const { profileId } = useSearch({ from: Route.id });
  const [status, setStatus] = useState<'loading' | 'complete' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!profileId) {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    fetch(`/api/onboarding/complete/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrf(),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Completion failed');
        const body = (await response.json()) as { id?: string; status?: string };
        if (
          body.id !== profileId ||
          !['ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED'].includes(body.status ?? '')
        )
          throw new Error('Unexpected completed profile');
        if (!controller.signal.aborted) setStatus('complete');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [profileId, retry]);
  return (
    <div
      className="container relative mx-auto flex min-h-screen items-center justify-center p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {status === 'complete' && <Confetti />}
      <div className="max-w-md text-center space-y-5">
        <h1 className="text-2xl font-bold">
          {t(
            status === 'complete'
              ? 'onboarding.complete.title'
              : status === 'loading'
                ? 'onboarding.complete.finalizing'
                : 'onboarding.complete.failedTitle',
            locale
          )}
        </h1>
        {status === 'complete' ? (
          <>
            <p>{t('onboarding.complete.subtitle', locale)}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.navigate({ to: '/onboarding', replace: true })}
              >
                {t('onboarding.complete.addAnother', locale)}
              </Button>
              <Button type="button" onClick={() => router.navigate({ to: '/app', replace: true })}>
                {t('onboarding.complete.goToDashboard', locale)}
              </Button>
            </div>
          </>
        ) : status === 'loading' ? (
          <p role="status">{t('onboarding.complete.finalizing', locale)}</p>
        ) : (
          <>
            <p role="alert">
              {t(
                profileId ? 'onboarding.complete.error' : 'onboarding.complete.missingProfile',
                locale
              )}
            </p>
            {profileId && (
              <Button type="button" onClick={() => setRetry((value) => value + 1)}>
                {t('onboarding.draft.retry', locale)}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => router.navigate({ to: '/onboarding', replace: true })}
            >
              {t('onboarding.complete.backToSetup', locale)}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
