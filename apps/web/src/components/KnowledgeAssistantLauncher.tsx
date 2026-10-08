import { readAssistantAvailability, type AssistantAvailability } from '../lib/assistant-chat.js';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { useProfileContextRevision } from '../lib/profile-context.js';

const KnowledgeAssistantPanel = lazy(() => import('./KnowledgeAssistantPanel.js'));

type Availability = AssistantAvailability;

export function KnowledgeAssistantLauncher({
  locale,
  pathname,
}: {
  locale: Locale;
  pathname?: string;
}) {
  const revision = useProfileContextRevision();
  const trigger = useRef<HTMLButtonElement>(null);
  const [availability, setAvailability] = useState<(Availability & { revision: number }) | null>(
    null
  );
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setAvailability(null);
    setOpen(false);
    void fetch('/api/ai/knowledge/availability', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) =>
        response.status === 200 ? readAssistantAvailability(await response.json()) : null
      )
      .then((value) => {
        if (!controller.signal.aborted) setAvailability(value ? { ...value, revision } : null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [revision]);

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
