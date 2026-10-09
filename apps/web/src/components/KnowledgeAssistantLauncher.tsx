import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { readAssistantAvailability, type AssistantAvailability } from '../lib/assistant-chat.js';
import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { useProfileContextRevision } from '../lib/profile-context.js';

const KnowledgeAssistantPanel = lazy(() => import('./KnowledgeAssistantPanel.js'));

type Availability = AssistantAvailability;

type LauncherProps = { locale: Locale; pathname?: string };
export function KnowledgeAssistantLauncher(props: LauncherProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedKnowledgeAssistantLauncher key={JSON.stringify([actor, revision])} {...props} />;
}
function OwnedKnowledgeAssistantLauncher({ locale, pathname }: LauncherProps) {
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const trigger = useRef<HTMLButtonElement>(null);
  const [availability, setAvailability] = useState<(Availability & { revision: number }) | null>(
    null
  );
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.catalogue.detail(
      { context: 'account', ownerId: actor ?? 'current-account', accountId: actor, revision },
      JSON.stringify([reader, 'customer-assistant-availability'])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setAvailability(null);
    setOpen(false);
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
            value: response.status === 200 ? ((await response.json()) as unknown) : null,
          };
        },
      })
      .then(async (response) =>
        response.status === 200 ? readAssistantAvailability(response.value) : null
      )
      .then((value) => {
        if (!controller.signal.aborted) setAvailability(value ? { ...value, revision } : null);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
    };
  }, [revision, actor, client, reader]);

  if (
    availability?.revision !== revision ||
    !availability.available ||
    !availability.slotKey ||
    !availability.profileId
  )
    return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="fixed bottom-[calc(var(--mobile-navigation-height,0px)+1.25rem)] end-5 z-40 flex min-h-12 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transform-none"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        <BookOpenText className="size-5" aria-hidden="true" />
        {t('assistant.open', locale)}
      </button>
      {opened && (
        <Suspense fallback={null}>
          <KnowledgeAssistantPanel
            locale={locale}
            pathname={pathname ?? '/ai'}
            slotKey={availability.slotKey}
            profileId={availability.profileId}
            profileName={availability.profileName}
            open={open}
            onOpenChange={(value) => {
              setOpen(value);
              if (!value) trigger.current?.focus();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
