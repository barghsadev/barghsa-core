import { readWithDeadline } from '../lib/server-query-client.js';
import { serviceFeedback } from '@barghsa/i18n/service-feedback';
import { LoadingStatus, NoDeadEndBanner, Button } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { readAssistantAvailability, type AssistantAvailability } from '../lib/assistant-chat.js';
import { useEffect, useId, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import KnowledgeAssistantPanel from '../components/KnowledgeAssistantPanel.js';
import { MaintenanceBoundary } from '../components/MaintenanceNotice.js';

type Availability = AssistantAvailability;

export default function AIChat() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <MaintenanceBoundary capability="ai_chat">
      <OwnedAIChat key={JSON.stringify([actor, revision])} />
    </MaintenanceBoundary>
  );
}
function OwnedAIChat() {
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const locale = useLocale();
  const profileRevision = useProfileContextRevision();
  const [retry, setRetry] = useState(0);
  const [availability, setAvailability] = useState<(Availability & { revision: number }) | null>(
    null
  );
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.catalogue.detail(
      {
        context: 'account',
        ownerId: actor ?? 'current-account',
        accountId: actor,
        revision: profileRevision,
      },
      JSON.stringify([reader, 'assistant-page-availability', retry])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setAvailability(null);
    setStatus('loading');
    void client
      .fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal: ownerSignal }) =>
          readWithDeadline(ownerSignal, async (signal) => {
            const response = await fetch('/api/ai/knowledge/availability', {
              credentials: 'include',
              signal,
            });
            return {
              status: response.status,
              ok: response.ok,
              value: response.ok ? ((await response.json()) as unknown) : null,
            };
          }),
      })
      .then(async (response) => {
        if (!response.ok) throw new Error('Assistant availability unavailable');
        const value = readAssistantAvailability(response.value);
        if (response.status !== 200 || !value) throw new Error('Invalid availability');
        return value;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.available && result.profileId && result.slotKey) {
          setAvailability({ ...result, revision: profileRevision });
          setStatus('ready');
        } else {
          setStatus('unavailable');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [profileRevision, retry, actor, client, reader]);

  return (
    <div
      className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {(status === 'loading' ||
        (status === 'ready' && availability?.revision !== profileRevision)) && (
        <LoadingStatus>{loadingText('loadingGuide', locale)}</LoadingStatus>
      )}
      {status === 'unavailable' && (
        <section className="rounded-2xl border bg-card p-6">
          <h1 className="text-xl font-semibold">{t('assistant.title', locale)}</h1>
          <NoDeadEndBanner
            title={t('assistant.page.unavailable', locale)}
            description={serviceFeedback('next', locale)}
            responsibleTeam={serviceFeedback('team', locale)}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t('assistant.retry', locale)}
              </Button>
            }
            help={
              <Link to="/tickets" className="underline">
                {serviceFeedback('support', locale)}
              </Link>
            }
          />
        </section>
      )}
      {status === 'error' && (
        <section className="rounded-2xl border bg-card p-6">
          <h1 className="text-xl font-semibold">{t('assistant.title', locale)}</h1>
          <NoDeadEndBanner
            title={t('assistant.page.error', locale)}
            description={serviceFeedback('next', locale)}
            responsibleTeam={serviceFeedback('team', locale)}
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                {t('assistant.retry', locale)}
              </Button>
            }
            help={
              <Link to="/tickets" className="underline">
                {serviceFeedback('support', locale)}
              </Link>
            }
          />
        </section>
      )}
      {status === 'ready' &&
        availability?.revision === profileRevision &&
        availability.profileId &&
        availability.slotKey && (
          <KnowledgeAssistantPanel
            key={`${profileRevision}:${availability.profileId}`}
            locale={locale}
            profileId={availability.profileId}
            profileName={availability.profileName}
            slotKey={availability.slotKey}
            open
            onOpenChange={() => {}}
            embedded
          />
        )}
    </div>
  );
}
