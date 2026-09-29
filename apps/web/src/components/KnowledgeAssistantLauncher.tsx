import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/app';
import { useProfileContextRevision } from '../lib/profile-context.js';

const KnowledgeAssistantPanel = lazy(() => import('./KnowledgeAssistantPanel.js'));

type Availability = {
  available: boolean;
  profileId: string | null;
  slotKey: 'individual_chatbot' | 'legal_entity_chatbot' | null;
};

export function KnowledgeAssistantLauncher({ locale }: { locale: Locale }) {
  const revision = useProfileContextRevision();
  const trigger = useRef<HTMLButtonElement>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
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
      .then(async (response) => (response.ok ? ((await response.json()) as Availability) : null))
      .then((value) => {
        if (!controller.signal.aborted) setAvailability(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [revision]);

  if (!availability?.available || !availability.slotKey || !availability.profileId) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="fixed bottom-5 end-5 z-40 flex min-h-12 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transform-none"
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
            slotKey={availability.slotKey}
            profileId={availability.profileId}
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
