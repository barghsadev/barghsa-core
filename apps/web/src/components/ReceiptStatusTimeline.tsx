import { StatusTimeline } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import type { InvoiceReceiptActivity } from '../lib/customer-invoices.js';

export function ReceiptStatusTimeline({
  history,
  label,
  locale,
  formatTimestamp,
}: {
  history: NonNullable<InvoiceReceiptActivity['statusHistory']>;
  label: string;
  locale: Locale;
  formatTimestamp: (value: string) => string;
}) {
  const word = (key: string) => t(`invoices.activity.${key}`, locale);
  return (
    <StatusTimeline
      label={label}
      items={history.map((event, index) => {
        const stateKey = `state.${event.state}`;
        const stateLabel = word(stateKey);
        const actor =
          event.actorType === 'customer' || event.actorType === 'staff'
            ? event.actorType
            : 'unknown';
        return {
          id: `${event.state}-${event.occurredAt}-${index}`,
          title:
            stateLabel === `invoices.activity.${stateKey}` ? word('state.Unknown') : stateLabel,
          state: event.state,
          tone: event.state === 'Confirmed' ? 'success' : undefined,
          dateTime: event.occurredAt,
          dateLabel: formatTimestamp(event.occurredAt),
          actorLabel: [actor === 'unknown' ? null : event.actorName, word(`actor.${actor}`)]
            .filter(Boolean)
            .join(' · '),
          description: [event.reason, event.backfilled ? word('historicalTime') : null]
            .filter(Boolean)
            .join(' · '),
        };
      })}
    />
  );
}
