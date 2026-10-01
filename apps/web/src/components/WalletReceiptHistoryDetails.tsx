import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { t as appText, type Locale } from '@barghsa/i18n/app';
import type { WalletBankReceiptHistory } from '@barghsa/shared/finance';
import type { useAccountTime } from '../hooks/useAccountTime.js';
import { ReceiptAttachmentPreview } from './ReceiptAttachmentPreview.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { WalletReceiptTimeline } from './WalletReceiptTimeline.js';

export function WalletReceiptHistoryDetails({
  receiptId,
  profileId,
  receipt,
  locale,
  formatTime,
}: {
  receiptId: string;
  profileId: string;
  receipt: WalletBankReceiptHistory;
  locale: Locale;
  formatTime: ReturnType<typeof useAccountTime>['format'];
}) {
  const word = (key: string) => t(`wallet.receipt.${key}`, locale);
  return (
    <details className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
      <summary className="cursor-pointer rounded font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {word('details')}
      </summary>
      <div className="space-y-4 pt-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{word('id')}</dt>
            <dd className="break-all">
              <bdi>{receiptId}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{word('paymentDate')}</dt>
            <dd>
              <ReceiptDepositDate
                value={receipt.paymentDate}
                locale={locale}
                calendar={locale === 'fa' ? 'persian' : 'gregory'}
              />
            </dd>
          </div>
          {(['bankName', 'payerReference', 'customerNote'] as const).map((key) => (
            <div key={key}>
              <dt className="text-muted-foreground">
                {word(key === 'customerNote' ? 'note' : key)}
              </dt>
              <dd className="break-words [overflow-wrap:anywhere]" dir="auto">
                {receipt[key] ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
        {receipt.rejectionReason && (
          <div className="rounded-md border border-destructive/30 bg-danger-soft p-3">
            <h3 className="font-medium">{word('rejectionReason')}</h3>
            <p className="mt-1 break-words [overflow-wrap:anywhere]" dir="auto">
              {receipt.rejectionReason}
            </p>
          </div>
        )}
        <ReceiptAttachmentPreview profileId={profileId} receiptId={receiptId} locale={locale} />
        <a
          href={`/api/wallet/${encodeURIComponent(profileId)}/bank-receipt-top-ups/${encodeURIComponent(receiptId)}/attachment`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-primary underline underline-offset-4"
        >
          {appText('invoices.activity.viewReceiptAttachment', locale)}
        </a>
        <WalletReceiptTimeline
          timeline={receipt.timeline}
          locale={locale}
          formatTime={formatTime}
        />
      </div>
    </details>
  );
}
