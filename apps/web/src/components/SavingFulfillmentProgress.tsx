import { ProgressStepper, StatusTimeline, type ProgressStep } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import type { Locale } from '@barghsa/i18n';
import type { SavingFulfillmentEvent, SavingFulfillmentStage } from '../lib/saving-fulfillment.js';

const stageNames = new Set([
  'request_confirmation',
  'product_delivery',
  'installation_and_document_upload',
  'equipment_handover',
  'process_completion',
]);
const statuses = new Set(['pending', 'in_progress', 'completed', 'skipped']);
const statusKey = (value: string) =>
  value === 'in_progress' ? 'inProgress' : statuses.has(value) ? value : 'stageStateUnknown';

export function SavingFulfillmentHistory({
  events,
  truncated,
  locale,
  formatTimestamp,
}: {
  events: SavingFulfillmentEvent[];
  truncated?: boolean | undefined;
  locale: Locale;
  formatTimestamp: (date: string) => string;
}) {
  const copy = (key: string) => tSaving(key, locale);
  return (
    <section aria-label={copy('staffHistory')} className="space-y-3">
      <h3 className="font-semibold">{copy('staffHistory')}</h3>
      {truncated && (
        <p className="text-sm text-muted-foreground">{copy('stageHistoryTruncated')}</p>
      )}
      {events.length ? (
        <StatusTimeline
          label={copy('staffHistory')}
          items={events.map((event) => ({
            id: event.id,
            title: `${copy(stageNames.has(event.stage) ? event.stage : 'stageUnknown')} · ${copy(statusKey(event.from_status))} → ${copy(statusKey(event.to_status))}`,
            state: event.to_status === 'in_progress' ? 'draft' : 'completed',
            dateTime: event.created_at,
            dateLabel: formatTimestamp(event.created_at),
            actorLabel: event.actorName
              ? `${event.actorName} · ${copy('stageStaff')}`
              : copy('stageStaff'),
            description: (
              <span className="whitespace-pre-wrap break-words">
                {event.noteKind === 'started'
                  ? copy('stageStartedNote')
                  : event.noteKind === 'confirmed'
                    ? copy('stageConfirmedNote')
                    : event.explanation}
                {event.handover_description && (
                  <span className="mt-1 block">
                    {copy('staffHandover')}: <bdi>{event.handover_description}</bdi>
                  </span>
                )}
              </span>
            ),
          }))}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{copy('staffNoHistory')}</p>
      )}
    </section>
  );
}

export function SavingFulfillmentProgress({
  stages,
  events,
  truncated,
  status,
  locale,
  formatTimestamp,
}: {
  stages: SavingFulfillmentStage[];
  events: SavingFulfillmentEvent[];
  truncated?: boolean | undefined;
  status: string;
  locale: Locale;
  formatTimestamp: (date: string) => string;
}) {
  const copy = (key: string) => tSaving(key, locale);
  const stopped = ['cancelled', 'rejected'].includes(status);
  const terminal = stopped || status === 'completed';
  return (
    <section aria-label={copy('fulfillment')} className="space-y-5">
      <h2 className="text-xl font-semibold">{copy('fulfillment')}</h2>
      {stopped && <p role="status">{copy('stageStopped')}</p>}
      <ProgressStepper
        label={copy('fulfillment')}
        steps={stages.map((stage): ProgressStep => ({
          id: stage.stage,
          label: copy(stageNames.has(stage.stage) ? stage.stage : 'stageUnknown'),
          state:
            stage.status === 'completed'
              ? 'complete'
              : stage.status === 'skipped'
                ? 'skipped'
                : stage.status === 'in_progress' && !terminal
                  ? 'current'
                  : 'pending',
          stateLabel: copy(
            terminal && stage.status === 'in_progress'
              ? 'stageNotContinued'
              : statusKey(stage.status)
          ),
          description: (
            <>
              {stage.status === 'skipped' && <span className="block">{copy('skipped')}</span>}
              {stage.completed_at || stage.started_at ? (
                <>
                  <span className="block">
                    {copy(stage.completed_at ? 'stageRecordedAt' : 'stageStartedAt')}
                  </span>
                  <time dateTime={stage.completed_at ?? stage.started_at!}>
                    {formatTimestamp(stage.completed_at ?? stage.started_at!)}
                  </time>
                </>
              ) : ['completed', 'skipped', 'in_progress'].includes(stage.status) ? (
                copy('stageNoDate')
              ) : null}
              {stage.handover_description && (
                <bdi className="mt-1 block break-words">{stage.handover_description}</bdi>
              )}
            </>
          ),
        }))}
      />
      <SavingFulfillmentHistory
        events={events}
        truncated={truncated}
        locale={locale}
        formatTimestamp={formatTimestamp}
      />
    </section>
  );
}
