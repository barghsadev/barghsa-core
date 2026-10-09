import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { readAssistantAvailability, type AssistantAvailability } from '../lib/assistant-chat.js';
import { useEffect, useId, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import KnowledgeAssistantPanel from '../components/KnowledgeAssistantPanel.js';

type Availability = AssistantAvailability;

export default function AIChat() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedAIChat key={JSON.stringify([actor, revision])} />;
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
        queryFn: async ({ signal }) => {
          const response = await fetch('/api/ai/knowledge/availability', {
            credentials: 'include',
            signal,
          });
          return {
            status: response.status,
            ok: response.ok,
            value: response.ok ? ((await response.json()) as unknown) : null,
          };
        },
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
        <p role="status">{t('assistant.page.loading', locale)}</p>
      )}
      {status === 'unavailable' && (
        <section className="rounded-2xl border bg-card p-6">
          <h1 className="text-xl font-semibold">{t('assistant.title', locale)}</h1>
          <p className="mt-2 text-muted-foreground">{t('assistant.page.unavailable', locale)}</p>
        </section>
      )}
      {status === 'error' && (
        <section className="rounded-2xl border bg-card p-6" role="alert">
          <h1 className="text-xl font-semibold">{t('assistant.title', locale)}</h1>
          <p className="mt-2 text-muted-foreground">{t('assistant.page.error', locale)}</p>
          <button
            type="button"
            className="mt-4 rounded-md border px-4 py-2 font-medium text-primary"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t('assistant.retry', locale)}
          </button>
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
