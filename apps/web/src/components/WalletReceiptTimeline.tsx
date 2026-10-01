import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import type { Locale } from '@barghsa/i18n/app';
import type { WalletBankReceiptTimeline } from '@barghsa/shared/finance';
import type { useAccountTime } from '../hooks/useAccountTime.js';

export function WalletReceiptTimeline({
  timeline,
  locale,
  formatTime,
}: {
  timeline: WalletBankReceiptTimeline;
  locale: Locale;
  formatTime: ReturnType<typeof useAccountTime>['format'];
}) {
  const word = (key: string) => t(`wallet.receipt.${key}`, locale);
  return (
    <section
      aria-label={word('timeline')}
      className="space-y-3"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h3 className="text-sm font-semibold">{word('timeline')}</h3>
      <ol className="space-y-3 border-s-2 border-border ps-4 text-sm">
        {timeline.events.map((event) => (
          <li
            key={event.state}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
            <span className="font-medium">{word(event.state)}</span>
            {event.occurredAt ? (
              <time dateTime={event.occurredAt} className="text-muted-foreground">
                {formatTime(event.occurredAt, { dateStyle: 'medium', timeStyle: 'short' })}
              </time>
            ) : (
              <span className="text-muted-foreground">{word('unknownTime')}</span>
            )}
          </li>
        ))}
      </ol>
      {timeline.awaiting && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          {word(`awaiting.${timeline.awaiting}`)}
        </p>
      )}
    </section>
  );
}
