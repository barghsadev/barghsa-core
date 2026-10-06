import { historyContextText } from '../lib/history-context.js';
import { ProgressStepper, StatusTimeline } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import type { SolarProgress } from '../lib/solar-progress.js';

export function SolarStageProgress({
  progress,
  showTimeNotice = true,
}: {
  progress: SolarProgress;
  showTimeNotice?: boolean;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  return (
    <section
      className="space-y-5 rounded-xl border bg-card p-5"
      aria-label={copy('constructionTitle')}
    >
      <div>
        <h2 className="text-xl font-semibold">{copy('constructionTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{copy('constructionDescription')}</p>
      </div>
      {showTimeNotice && time.notice}
      {progress.stopped && <p role="status">{copy('constructionStopped')}</p>}
      <ProgressStepper
        label={copy('constructionTitle')}
        steps={progress.steps.map((step) => ({
          id: step.id,
          label: copy(`construction_${step.id}`),
          state: step.state,
          stateLabel: copy(`construction_${step.state}`),
          description: step.recordedAt ? (
            <>
              <span className="block">{copy('constructionDate')}</span>
              <time dateTime={step.recordedAt}>
                {time.format(step.recordedAt, { dateStyle: 'medium' })}
              </time>
            </>
          ) : step.completed ? (
            copy('constructionNoDate')
          ) : undefined,
        }))}
      />
      <div className="space-y-3">
        <h3 className="font-medium">{copy('constructionHistory')}</h3>
        {progress.events.length ? (
          <StatusTimeline
            label={copy('constructionHistory')}
            items={progress.events.map((event) => ({
              id: String(event.revision),
              title: copy(`construction_${event.stage}`),
              dateTime: event.recordedAt,
              dateLabel: time.format(event.recordedAt),
              actorLabel: [event.actorName, historyContextText(event.actorContext, locale)]
                .filter(Boolean)
                .join(' · '),
              description: <span className="whitespace-pre-wrap break-words">{event.note}</span>,
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{copy('constructionNoUpdates')}</p>
        )}
      </div>
    </section>
  );
}
