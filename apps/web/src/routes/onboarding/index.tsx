import { readWithDeadline } from '../../lib/server-query-client.js';
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
import { t as draftText } from '@barghsa/i18n/onboarding-drafts';
import { LoadingStatus, Button, Badge } from '@barghsa/ui';
import { Building2, UserRound } from 'lucide-react';
import { RecordEditorActions, recordEditorSurface } from '../../components/RecordEditorLayout.js';

export const Route = createFileRoute('/onboarding/')({ component: OnboardingPage });
type ProfileType = 'INDIVIDUAL' | 'LEGAL';
const OnboardingDraftList = lazy(() => import('../../components/OnboardingDraftList.js'));
const personalTypes = ['INDIVIDUAL'] as const;
const types = [...personalTypes, 'LEGAL'] as const;

function OnboardingPage() {
  const { onboardingUserId, staffAccount } = Route.useRouteContext();
  return (
    <OnboardingContent
      key={onboardingUserId}
      accountId={onboardingUserId}
      staffAccount={staffAccount}
    />
  );
}

function OnboardingContent({
  accountId,
  staffAccount,
}: {
  accountId: string;
  staffAccount: boolean;
}) {
  const locale = useLocale();
  const router = useRouter();
  const availableTypes = staffAccount ? personalTypes : types;
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
    void readWithDeadline(controller.signal, async (signal) => {
      const response = await fetch('/api/onboarding/journeys/active', {
        credentials: 'include',
        signal,
      });
      if (!response.ok) throw new Error('Unable to read setup');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('journey' in body))
        throw new Error('Invalid setup response');
      const current = body.journey === null ? null : parseOnboardingJourney(body.journey);
      if (current?.completed) throw new Error('Unexpected completed setup');
      return current;
    })
      .then((current) => {
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
      const current = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch('/api/onboarding/journeys', {
          method: 'POST',
          credentials: 'include',
          signal,
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ requestId: requestId.current, profileTypes: selected }),
        });
        if (!response.ok) throw new Error('Unable to start setup');
        return parseOnboardingJourney(await response.json());
      });
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
      className="container mx-auto flex min-h-dvh items-start justify-center px-4 pt-7 pb-8 sm:pt-16"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div className="w-full min-w-0 max-w-xl space-y-3.5">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold">{t('onboarding.welcome.title', locale)}</h1>
          <p className="text-sm text-muted-foreground">
            {t('onboarding.welcome.subtitle', locale)}
          </p>
        </div>
        <InvitationBanner locale={locale} accountId={accountId} />
        <Suspense
          fallback={
            <LoadingStatus className="text-sm">{draftText('loading', locale)}</LoadingStatus>
          }
        >
          <OnboardingDraftList locale={locale} onReady={setDraftListReady} disabled={submitting} />
        </Suspense>
        {loading ? (
          <LoadingStatus>{t('onboarding.journey.loading', locale)}</LoadingStatus>
        ) : journey ? (
          <div className={recordEditorSurface}>
            <div className="space-y-2.5 px-4 py-4 sm:px-6">
              <h2 className="font-semibold">{t('onboarding.journey.resumeTitle', locale)}</h2>
              <p className="text-sm text-muted-foreground">
                {t('onboarding.journey.resumeHelp', locale)}
              </p>
              <ul className="divide-y border-t">
                {journey.profiles.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{t(`settings.profile.profileType.${p.profileType}`, locale)}</span>
                    <Badge>{t(`onboarding.wizard.${p.status}`, locale)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
            <RecordEditorActions>
              <Button type="button" onClick={() => router.navigate(onboardingDestination(journey))}>
                {t('onboarding.journey.resume', locale)}
              </Button>
            </RecordEditorActions>
          </div>
        ) : (
          <div className={recordEditorSurface}>
            <div className="px-4 py-4 sm:px-6">
              <fieldset disabled={submitting || error} className="min-w-0 space-y-2.5">
                <legend className="font-semibold">{t('onboarding.type.prompt', locale)}</legend>
                {!staffAccount && (
                  <p className="text-sm text-muted-foreground">
                    {t('onboarding.journey.chooseHelp', locale)}
                  </p>
                )}
                <div className="grid gap-2">
                  {availableTypes.map((type) => {
                    const key = type === 'INDIVIDUAL' ? 'individual' : 'legal';
                    const ProfileIcon = type === 'INDIVIDUAL' ? UserRound : Building2;
                    return (
                      <label
                        key={type}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring ${selected.includes(type) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-primary">
                          <ProfileIcon aria-hidden="true" className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {t(`onboarding.profile.${key}`, locale)}
                          </span>
                          <span className="block text-sm leading-snug text-muted-foreground">
                            {t(`onboarding.type.${key}Hint`, locale)}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          aria-label={t(`onboarding.profile.${key}`, locale)}
                          checked={selected.includes(type)}
                          onChange={() => {
                            requestId.current = null;
                            setSelected((previous) =>
                              availableTypes.filter((candidate) =>
                                candidate === type
                                  ? !previous.includes(type)
                                  : previous.includes(candidate)
                              )
                            );
                          }}
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
            <RecordEditorActions>
              <Button
                type="button"
                disabled={!selected.length || submitting || error || !draftListReady}
                onClick={handleContinue}
              >
                {submitting
                  ? t('onboarding.journey.creating', locale)
                  : t('onboarding.type.continue', locale)}
              </Button>
            </RecordEditorActions>
          </div>
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
