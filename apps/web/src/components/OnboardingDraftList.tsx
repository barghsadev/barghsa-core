import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/onboarding-drafts';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  parseOnboardingDraftPage,
  type OnboardingDraftPage,
} from '../lib/onboarding-draft-list.js';

export default function OnboardingDraftList({
  locale,
  onReady,
  disabled = false,
}: {
  locale: Locale;
  onReady: (ready: boolean) => void;
  disabled?: boolean;
}) {
  const time = useAccountTime(locale);
  const [page, setPage] = useState<OnboardingDraftPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'load' | 'denied' | null>(null);
  const [request, setRequest] = useState({ after: null as string | null, attempt: 0 });
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    busy.current = true;
    setLoading(true);
    setError(null);
    const url = '/api/onboarding/drafts' + (request.after ? `?after=${request.after}` : '');
    fetch(url, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          if (!controller.signal.aborted) {
            setPage(null);
            setError('denied');
            onReady(false);
          }
          return;
        }
        if (!response.ok) throw new Error('Unable to list drafts');
        const next = parseOnboardingDraftPage(await response.json(), request.after);
        if (!controller.signal.aborted) {
          setPage((previous) => ({
            drafts: request.after ? [...(previous?.drafts ?? []), ...next.drafts] : next.drafts,
            nextAfter: next.nextAfter,
          }));
          onReady(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('load');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          busy.current = false;
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [request, onReady]);
  function load(after: string | null) {
    if (busy.current || disabled) return;
    busy.current = true;
    setRequest((previous) => ({ after, attempt: previous.attempt + 1 }));
  }
  if (page?.drafts.length === 0 && !loading && !error) return null;
  return (
    <section
      aria-labelledby="unfinished-profiles-title"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      className="space-y-3"
    >
      <h2 id="unfinished-profiles-title" className="font-semibold">
        {t('title', locale)}
      </h2>
      <p className="text-sm text-muted-foreground">{t('help', locale)}</p>
      {page && page.drafts.length > 0 && (
        <>
          {time.notice}
          <ul className="divide-y rounded-xl border bg-card px-4">
            {page.drafts.map((draft) => (
              <li key={draft.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">
                      {draft.name || t(draft.profileType, locale)}
                    </p>
                    {draft.name && (
                      <p className="text-sm text-muted-foreground">
                        {t(draft.profileType, locale)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(draft.updatedAt ? 'saved' : 'created', locale)}:{' '}
                      {time.format(draft.updatedAt ?? draft.createdAt)}
                    </p>
                  </div>
                  <Link
                    to={
                      draft.profileType === 'INDIVIDUAL'
                        ? '/onboarding/individual/$profileId'
                        : '/onboarding/legal/$profileId'
                    }
                    params={{ profileId: draft.id }}
                    search={{ step: 1 }}
                    aria-disabled={disabled || undefined}
                    tabIndex={disabled ? -1 : undefined}
                    onClick={(event) => {
                      if (disabled) event.preventDefault();
                    }}
                    className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-50"
                  >
                    {t(draft.expired ? 'restart' : draft.hasDraft ? 'resume' : 'start', locale)}
                  </Link>
                </div>
                {draft.expired && (
                  <p className="text-sm text-muted-foreground">{t('expired', locale)}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {loading && (
        <p role="status" className="text-sm">
          {t('loading', locale)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error === 'denied' ? 'denied' : 'error', locale)}
        </p>
      )}
      {error === 'load' && (
        <Button
          type="button"
          variant="outline"
          disabled={loading || disabled}
          onClick={() => load(request.after)}
        >
          {t('retry', locale)}
        </Button>
      )}
      {page?.nextAfter && !error && (
        <Button
          type="button"
          variant="outline"
          disabled={loading || disabled}
          onClick={() => load(page.nextAfter)}
        >
          {t('more', locale)}
        </Button>
      )}
    </section>
  );
}
