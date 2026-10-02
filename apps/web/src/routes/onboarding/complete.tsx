import { parseOnboardingProfile, type OnboardingProfile } from '../../lib/onboarding-profile.js';
import { useLocale } from '../../hooks/useLocale.js';
import { withCsrf } from '../../lib/csrf.js';
import { useEffect, useRef, useState } from 'react';
import {
  parseOnboardingJourney,
  onboardingDestination,
  type OnboardingJourney,
  type OnboardingJourneyProfile,
} from '../../lib/onboarding-journey.js';
import { refreshProfileContext } from '../../lib/profile-context.js';
import { createFileRoute, useRouter, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/complete')({
  component: OnboardingCompletePage,
  validateSearch: (search: Record<string, unknown>) => ({
    profileId: typeof search.profileId === 'string' ? search.profileId : undefined,
    journeyId: typeof search.journeyId === 'string' ? search.journeyId : undefined,
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
  const { profileId, journeyId } = useSearch({ from: Route.id });
  return (
    <Completion
      key={`${profileId ?? ''}:${journeyId ?? ''}`}
      profileId={profileId}
      journeyId={journeyId}
    />
  );
}

function Completion({ profileId, journeyId }: { profileId?: string; journeyId?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'complete' | 'error'>('loading');
  const [profile, setProfile] = useState<OnboardingProfile | null>(null);
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [selected, setSelected] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  const finishRequest = useRef<AbortController | null>(null);
  useEffect(() => () => finishRequest.current?.abort(), []);
  useEffect(() => {
    if ((!profileId && !journeyId) || (profileId && journeyId)) {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setProfile(null);
    setJourney(null);
    const load = async () => {
      const response = await fetch(
        journeyId
          ? `/api/onboarding/journeys/${encodeURIComponent(journeyId)}`
          : `/api/onboarding/complete/${encodeURIComponent(profileId!)}`,
        {
          method: journeyId ? 'GET' : 'POST',
          credentials: 'include',
          ...(journeyId ? {} : { headers: withCsrf() }),
          signal: controller.signal,
        }
      );
      if (!response.ok) throw new Error('Completion failed');
      const body = await response.json();
      const completed = profileId ? parseOnboardingProfile(body, profileId) : null;
      const current = journeyId
        ? parseOnboardingJourney(body, journeyId)
        : body.journey !== undefined && body.journey !== null
          ? parseOnboardingJourney(body.journey)
          : null;
      if (
        completed &&
        current &&
        !current.profiles.some(
          (p) =>
            p.id === completed.id && p.profileType === completed.profileType && p.status !== 'DRAFT'
        )
      )
        throw new Error('Unexpected setup receipt');
      if (controller.signal.aborted) return;
      if (current?.profiles.some((p) => p.status === 'DRAFT')) {
        await router.navigate(onboardingDestination(current));
        return;
      }
      setProfile(completed);
      setJourney(current);
      setSelected(current?.selectedProfileId ?? current?.profiles[0]?.id ?? '');
      setStatus('complete');
    };
    void load().catch(() => {
      if (!controller.signal.aborted) setStatus('error');
    });
    return () => controller.abort();
  }, [profileId, journeyId, retry, router]);

  async function finish() {
    if (!journey || !selected || busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    finishRequest.current = controller;
    setSubmitting(true);
    setFinishError(false);
    try {
      const response = await fetch(`/api/onboarding/journeys/${journey.id}/finish`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ selectedProfileId: selected }),
      });
      if (!response.ok) throw new Error('Unable to select profile');
      const receipt = parseOnboardingJourney(await response.json(), journey.id);
      if (
        !receipt.completed ||
        receipt.selectedProfileId !== selected ||
        receipt.activeProfileId !== selected ||
        receipt.profiles.length !== journey.profiles.length ||
        receipt.profiles.some(
          (p) =>
            !journey.profiles.some(
              (previous) => previous.id === p.id && previous.profileType === p.profileType
            )
        )
      )
        throw new Error('Unexpected selection receipt');
      if (controller.signal.aborted) return;
      refreshProfileContext();
      await router.navigate({ to: '/app', replace: true });
    } catch {
      if (!controller.signal.aborted) setFinishError(true);
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setSubmitting(false);
      }
    }
  }
  const profiles: OnboardingJourneyProfile[] = journey?.profiles ?? (profile ? [profile] : []);
  return (
    <div
      className="container relative mx-auto flex min-h-screen items-center justify-center p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {status === 'complete' && <Confetti />}
      <div className="w-full max-w-lg text-center space-y-5">
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
            <p>
              {t(
                journey ? 'onboarding.journey.summaryHelp' : 'onboarding.complete.subtitle',
                locale
              )}
            </p>
            <ul className="space-y-3">
              {profiles.map((p) => (
                <li key={p.id}>
                  <dl
                    className="rounded-xl border bg-card p-5 text-start space-y-4"
                    aria-label={t('onboarding.wizard.review', locale)}
                  >
                    {[
                      { label: t('onboarding.wizard.profileName', locale), value: p.name },
                      {
                        label: t('onboarding.wizard.profileType', locale),
                        value: t(`settings.profile.profileType.${p.profileType}`, locale),
                      },
                      {
                        label: t('onboarding.wizard.status', locale),
                        value: t(`onboarding.wizard.${p.status}`, locale),
                      },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-sm text-muted-foreground">{label}</dt>
                        <dd className="font-medium">
                          <bdi>{value}</bdi>
                        </dd>
                      </div>
                    ))}
                    {!journey && p.isDefault && (
                      <div className="text-sm text-primary">
                        {t('onboarding.wizard.default', locale)}
                      </div>
                    )}
                  </dl>
                </li>
              ))}
            </ul>
            {journey ? (
              <>
                <fieldset
                  disabled={submitting || journey.completed}
                  className="space-y-3 text-start"
                >
                  <legend className="font-medium mb-3">
                    {t('onboarding.journey.defaultHelp', locale)}
                  </legend>
                  {profiles.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-3 rounded-lg border p-4 cursor-pointer focus-within:ring-2 focus-within:ring-ring"
                    >
                      <input
                        type="radio"
                        name="dashboard-profile"
                        checked={selected === p.id}
                        onChange={() => {
                          setSelected(p.id);
                          setFinishError(false);
                        }}
                        className="h-4 w-4 accent-primary"
                      />
                      <bdi>{p.name}</bdi>
                    </label>
                  ))}
                </fieldset>
                {finishError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t('onboarding.journey.finishError', locale)}
                  </p>
                )}
                <Button
                  type="button"
                  className="w-full"
                  disabled={submitting || !selected}
                  onClick={finish}
                >
                  {t(
                    submitting ? 'onboarding.journey.finishing' : 'onboarding.journey.done',
                    locale
                  )}
                </Button>
                {finishError && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => router.navigate({ to: '/onboarding', replace: true })}
                  >
                    {t('onboarding.complete.backToSetup', locale)}
                  </Button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.navigate({ to: '/onboarding', replace: true })}
                >
                  {t('onboarding.complete.addAnother', locale)}
                </Button>
                <Button
                  type="button"
                  onClick={() => router.navigate({ to: '/app', replace: true })}
                >
                  {t('onboarding.complete.goToDashboard', locale)}
                </Button>
              </div>
            )}
          </>
        ) : status === 'loading' ? (
          <p role="status">{t('onboarding.complete.finalizing', locale)}</p>
        ) : (
          <>
            <p role="alert">
              {t(
                profileId || journeyId
                  ? 'onboarding.complete.error'
                  : 'onboarding.complete.missingProfile',
                locale
              )}
            </p>
            {(profileId || journeyId) && (
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
