import { parseOnboardingProfile, type OnboardingProfile } from '../../lib/onboarding-profile.js';
import { useLocale } from '../../hooks/useLocale.js';
import { withCsrf } from '../../lib/csrf.js';
import { useEffect, useState } from 'react';
import { createFileRoute, useRouter, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
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
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!profileId) {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setProfile(null);
    fetch(`/api/onboarding/complete/${encodeURIComponent(profileId)}`, {
      method: 'POST',
      credentials: 'include',
      headers: withCsrf(),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Completion failed');
        const completed = parseOnboardingProfile(await response.json(), profileId);
        if (!controller.signal.aborted) {
          setProfile(completed);
          setStatus('complete');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => controller.abort();
  }, [profileId, retry]);
  const displayStatus = status === 'complete' && profile?.id !== profileId ? 'loading' : status;
  return (
    <div
      className="container relative mx-auto flex min-h-screen items-center justify-center p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {displayStatus === 'complete' && <Confetti />}
      <div className="max-w-md text-center space-y-5">
        <h1 className="text-2xl font-bold">
          {t(
            displayStatus === 'complete'
              ? 'onboarding.complete.title'
              : displayStatus === 'loading'
                ? 'onboarding.complete.finalizing'
                : 'onboarding.complete.failedTitle',
            locale
          )}
        </h1>
        {displayStatus === 'complete' && profile ? (
          <>
            <p>{t('onboarding.complete.subtitle', locale)}</p>
            <dl
              className="rounded-xl border bg-card p-5 text-start space-y-4"
              aria-label={t('onboarding.wizard.review', locale)}
            >
              {[
                { label: t('onboarding.wizard.profileName', locale), value: profile.name },
                {
                  label: t('onboarding.wizard.profileType', locale),
                  value: t(`settings.profile.profileType.${profile.profileType}`, locale),
                },
                {
                  label: t('onboarding.wizard.status', locale),
                  value: t(`onboarding.wizard.${profile.status}`, locale),
                },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-medium">
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
              {profile.isDefault && (
                <div className="text-sm text-primary">{t('onboarding.wizard.default', locale)}</div>
              )}
            </dl>
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
        ) : displayStatus === 'loading' ? (
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
