import { InvitationBanner } from '../../components/InvitationBanner.js';
import { useLocale } from '../../hooks/useLocale.js';
import { withCsrf } from '../../lib/csrf.js';
import {
  parseOnboardingJourney,
  onboardingDestination,
  type OnboardingJourney,
} from '../../lib/onboarding-journey.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';

export const Route = createFileRoute('/onboarding/')({ component: OnboardingPage });
type ProfileType = 'INDIVIDUAL' | 'LEGAL';
const OnboardingDraftList = lazy(() => import('../../components/OnboardingDraftList.js'));
const types = ['INDIVIDUAL', 'LEGAL'] as const;

function OnboardingPage() {
  const { onboardingUserId } = Route.useRouteContext();
  return <OnboardingContent key={onboardingUserId} accountId={onboardingUserId} />;
}

function OnboardingContent({ accountId }: { accountId: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [draftListReady, setDraftListReady] = useState(false);
  const [selected, setSelected] = useState<ProfileType[]>([]);
  const [journey, setJourney] = useState<OnboardingJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/api/onboarding/journeys/active', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to read setup');
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object' || !('journey' in body))
          throw new Error('Invalid setup response');
        const current = body.journey === null ? null : parseOnboardingJourney(body.journey);
        if (current?.completed) throw new Error('Unexpected completed setup');
        if (!controller.signal.aborted) setJourney(current);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);

  async function handleContinue() {
    if (busy.current || loading || error || !draftListReady || !selected.length) return;
    busy.current = true;
    const controller = new AbortController();
    request.current = controller;
    requestId.current ??= crypto.randomUUID();
    setSubmitting(true);
    setError(false);
    try {
      const response = await fetch('/api/onboarding/journeys', {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ requestId: requestId.current, profileTypes: selected }),
      });
      if (!response.ok) throw new Error('Unable to start setup');
      const current = parseOnboardingJourney(await response.json());
      if (
        current.profiles.length !== selected.length ||
        current.profiles.some((p) => !selected.includes(p.profileType))
      )
        throw new Error('Unexpected selection');
      if (!controller.signal.aborted) await router.navigate(onboardingDestination(current));
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <div
      className="container mx-auto flex min-h-screen items-center justify-center p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{t('onboarding.welcome.title', locale)}</h1>
          <p className="text-muted-foreground">{t('onboarding.welcome.subtitle', locale)}</p>
        </div>
        <InvitationBanner locale={locale} accountId={accountId} />
        <Suspense fallback={null}>
          <OnboardingDraftList locale={locale} onReady={setDraftListReady} disabled={submitting} />
        </Suspense>
        {loading ? (
          <p role="status">{t('onboarding.journey.loading', locale)}</p>
        ) : journey ? (
          <>
            <div className="rounded-xl border bg-card p-5 space-y-3">
              <h2 className="font-semibold">{t('onboarding.journey.resumeTitle', locale)}</h2>
              <p className="text-sm text-muted-foreground">
                {t('onboarding.journey.resumeHelp', locale)}
              </p>
              <ul className="space-y-2">
                {journey.profiles.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4">
                    <span>{t(`settings.profile.profileType.${p.profileType}`, locale)}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`onboarding.wizard.${p.status}`, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <Button
              className="w-full"
              type="button"
              onClick={() => router.navigate(onboardingDestination(journey))}
            >
              {t('onboarding.journey.resume', locale)}
            </Button>
          </>
        ) : (
          <>
            <fieldset disabled={submitting || error} className="space-y-4">
              <legend className="font-medium">{t('onboarding.type.prompt', locale)}</legend>
              <p className="text-sm text-muted-foreground">
                {t('onboarding.journey.chooseHelp', locale)}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {types.map((type) => {
                  const key = type === 'INDIVIDUAL' ? 'individual' : 'legal';
                  return (
                    <label
                      key={type}
                      className={`relative flex cursor-pointer flex-col items-center rounded-xl border-2 p-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring ${selected.includes(type) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                    >
                      <input
                        type="checkbox"
                        className="absolute top-4 start-4 h-4 w-4 accent-primary"
                        aria-label={t(`onboarding.profile.${key}`, locale)}
                        checked={selected.includes(type)}
                        onChange={() => {
                          requestId.current = null;
                          setSelected((previous) =>
                            types.filter((candidate) =>
                              candidate === type
                                ? !previous.includes(type)
                                : previous.includes(candidate)
                            )
                          );
                        }}
                      />
                      <span className="mb-3 text-3xl" aria-hidden="true">
                        {type === 'INDIVIDUAL' ? '👤' : '🏢'}
                      </span>
                      <span className="font-semibold">
                        {t(`onboarding.profile.${key}`, locale)}
                      </span>
                      <span className="mt-2 text-sm text-muted-foreground">
                        {t(`onboarding.profile.${key}Desc`, locale)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <Button
              className="w-full"
              type="button"
              disabled={!selected.length || submitting || error || !draftListReady}
              onClick={handleContinue}
            >
              {submitting
                ? t('onboarding.journey.creating', locale)
                : t('onboarding.type.continue', locale)}
            </Button>
          </>
        )}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {t('onboarding.journey.error', locale)}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={loading || submitting}
              onClick={() => setRetry((value) => value + 1)}
            >
              {t('onboarding.draft.retry', locale)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
