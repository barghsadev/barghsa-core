import { Link } from '@tanstack/react-router';
import { Button, LoadingStatus } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { InvoiceReceiptContent } from './InvoiceReceiptContent.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { fetchInvoiceReceipt, InvoiceRequestError } from '../lib/customer-invoices.js';
import { queryKeys } from '../lib/query-keys.js';
import type { ReceiptHistorySearch } from '../lib/receipt-history-search.js';

export function InvoiceReceiptPage({
  invoiceId,
  receiptId,
  historySearch,
}: {
  invoiceId: string;
  receiptId: string;
  historySearch: ReceiptHistorySearch;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  const text = (name: string) => t(`invoices.receipts.${name}`, locale);
  const receipt = useServerDetailQuery({
    queryKey: queryKeys.invoices.detail(
      { context: 'account', ownerId: accountId ?? 'account-session', accountId, revision },
      `${invoiceId}/receipts/${receiptId}`
    ),
    read: (signal) => fetchInvoiceReceipt(invoiceId, receiptId, signal),
  });
  const unavailable =
    receipt.error instanceof InvoiceRequestError &&
    [400, 401, 403, 404].includes(receipt.error.status);
  return (
    <div className="mx-auto grid max-w-3xl min-w-0 gap-4">
      <div className="space-y-1">
        <Link
          to="/invoices/receipts"
          search={historySearch}
          className="touch-action text-sm font-medium text-primary underline underline-offset-4"
        >
          {text('title')}
        </Link>
        <h1 className="text-2xl font-semibold">{text('detailTitle')}</h1>
      </div>
      {time.notice}
      {receipt.isFetching ? (
        <LoadingStatus>{text('detailLoading')}</LoadingStatus>
      ) : receipt.isError ? (
        <div role="alert" className="space-y-3">
          <p>{text(unavailable ? 'detailUnavailable' : 'detailError')}</p>
          {!unavailable && (
            <Button variant="outline" onClick={() => void receipt.refetch()}>
              {text('retry')}
            </Button>
          )}
        </div>
      ) : receipt.data ? (
        <section
          id={`bank-receipt-${receipt.data.id}`}
          aria-label={text('detailTitle')}
          className="min-w-0 rounded-xl border border-border bg-card p-4 text-sm sm:p-6"
        >
          <InvoiceReceiptContent
            key={JSON.stringify([accountId, revision, invoiceId, receiptId])}
            invoiceId={invoiceId}
            row={receipt.data}
            initiallyOpen
            formatTimestamp={time.format}
            headingLevel="h2"
          />
        </section>
      ) : null}
    </div>
  );
}
