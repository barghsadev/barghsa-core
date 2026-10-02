import { StatusTimeline } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import type { Locale } from '@barghsa/i18n';
import type { ContractHistoryEvent } from '../lib/contracts.js';

const states = new Map([
  ['contract.created', 'draft'],
  ['contract.version_created', 'draft'],
  ['contract.submitted', 'waiting'],
  ['contract.resubmitted', 'waiting'],
  ['contract.changes_requested', 'changes_requested'],
  ['contract.published', 'waiting'],
  ['contract.accepted', 'approved'],
  ['contract.signature_requested', 'waiting'],
  ['contract.signed_copy_recorded', 'signed'],
  ['contract.activated', 'active'],
  ['contract.completed', 'completed'],
  ['contract.cancelled', 'cancelled'],
  ['contract.amendment_created', 'draft'],
  ['contract.amendment_published', 'waiting'],
  ['contract.amendment_accepted', 'approved'],
]);

export function ContractStatusTimeline({
  history,
  truncated,
  locale,
  formatTimestamp,
}: {
  history: ContractHistoryEvent[];
  truncated?: boolean;
  locale: Locale;
  formatTimestamp: (date: string) => string;
}) {
  const word = (key: string) => contractText(key, locale);
  return (
    <section aria-label={word('statusHistory')} className="space-y-3">
      <h3 className="font-semibold">{word('statusHistory')}</h3>
      {truncated && (
        <p className="text-xs text-muted-foreground">{word('statusHistoryTruncated')}</p>
      )}
      {history.length ? (
        <StatusTimeline
          label={word('statusHistory')}
          items={history.map((event) => ({
            id: event.id,
            title: word(
              states.has(event.event) ? `timeline.${event.event}` : 'statusHistoryUnknown'
            ),
            state: states.get(event.event),
            dateTime: event.at,
            dateLabel: formatTimestamp(event.at),
            actorLabel: ['staff', 'customer', 'system'].includes(event.actorType)
              ? `${word('changedBy')}: ${word(event.actorType)}`
              : undefined,
            description: event.reason ?? undefined,
          }))}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{word('statusHistoryEmpty')}</p>
      )}
    </section>
  );
}
