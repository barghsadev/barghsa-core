import InvoiceCorrectionsPanel from '../components/InvoiceCorrectionsPanel.js';
import { lazy, Suspense, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { contractText } from '@barghsa/i18n/contracts';
import { Button } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import ReminderOffsetTogglePanel from '../components/ReminderOffsetTogglePanel.js';
import ManualInvoicePanel from '../components/ManualInvoicePanel.js';
import ServiceDuePeriodPanel from '../components/ServiceDuePeriodPanel.js';
import { InvoiceBankReceiptQueue } from '../components/InvoiceBankReceiptQueue.js';
import { InvoiceLedger } from '../components/InvoiceLedger.js';
const InvoiceDueAtPanel = lazy(() => import('../components/InvoiceDueAtPanel.js'));
const RefundPanel = lazy(() =>
  import('../components/RefundPanel.js').then((module) => ({ default: module.RefundPanel }))
);
export interface InvoiceListQueries {
  pending?: import('../hooks/useListQuery.js').ListQueryBinding;
  ledger: import('../hooks/useListQuery.js').ListQueryBinding;
  history: import('../components/InvoiceBankReceiptQueue.js').ReceiptHistoryQuery;
  receiptsOpen: boolean;
  setReceiptsOpen: (open: boolean, history?: boolean) => void;
}
export default function AdminInvoicesPage({ queries }: { queries?: InvoiceListQueries } = {}) {
  const locale = useLocale();
  const [deadlineSelection, setDeadlineSelection] = useState<{
    invoiceId: string;
    revision: number;
  } | null>(null);
  const [refundInvoiceId, setRefundInvoiceId] = useState(
    () =>
      (typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).get('invoiceId')) ?? ''
  );
  const [showRefunds, setShowRefunds] = useState(() => !!refundInvoiceId);
  const [localReceiptQueue, setLocalReceiptQueue] = useState(false);
  const showReceiptQueue = queries?.receiptsOpen ?? localReceiptQueue;
  const setShowReceiptQueue = (value: boolean, history?: boolean) =>
    queries ? queries.setReceiptsOpen(value, history) : setLocalReceiptQueue(value);
  const [receiptSelection, setReceiptSelection] = useState<{
    receiptId: string;
    state: string;
    revision: number;
  } | null>(null);
  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold">{t('admin.invoices.nav', locale)}</h1>
      <InvoiceLedger
        {...(queries ? { query: queries.ledger } : {})}
        initialInvoiceId={
          typeof window === 'undefined'
            ? ''
            : (new URLSearchParams(window.location.search).get('invoiceId') ?? '')
        }
        onSelectForDueAt={(id) => {
          setDeadlineSelection((current) => ({
            invoiceId: id,
            revision: (current?.revision ?? 0) + 1,
          }));
          document.getElementById('invoice-deadline-panel')?.scrollIntoView?.({ block: 'start' });
        }}
        onSelectForRefund={(id) => {
          setRefundInvoiceId(id);
          setShowRefunds(true);
          document.getElementById('invoice-refunds-panel')?.scrollIntoView?.({ block: 'start' });
        }}
        onOpenReceipt={(receiptId, state) => {
          setReceiptSelection((current) => ({
            receiptId,
            state,
            revision: (current?.revision ?? 0) + 1,
          }));
          setShowReceiptQueue(true, state === 'Confirmed' || state === 'Rejected');
          document.getElementById('invoice-receipt-panel')?.scrollIntoView?.({ block: 'start' });
        }}
      />
      <ManualInvoicePanel />
      <InvoiceCorrectionsPanel />
      <section id="invoice-refunds-panel" className="space-y-4">
        {showRefunds ? (
          <Suspense
            fallback={<p role="status">{t('admin.invoices.walletRefunds.loading', locale)}</p>}
          >
            <RefundPanel destination="wallet" selectedInvoiceId={refundInvoiceId} />
            <RefundPanel destination="external_bank" selectedInvoiceId={refundInvoiceId} />
          </Suspense>
        ) : (
          <Button type="button" variant="outline" onClick={() => setShowRefunds(true)}>
            {contractText('refundOpen', locale)}
          </Button>
        )}
      </section>
      <ReminderOffsetTogglePanel />
      <ServiceDuePeriodPanel />
      <section id="invoice-receipt-panel" className="space-y-4">
        <button
          type="button"
          className="rounded-md border bg-card px-4 py-2 text-sm font-medium text-foreground"
          aria-expanded={showReceiptQueue}
          onClick={() => setShowReceiptQueue(!showReceiptQueue)}
        >
          {t('admin.invoiceReceipts.title', locale)}
        </button>
        {showReceiptQueue ? (
          <InvoiceBankReceiptQueue
            key={receiptSelection?.revision}
            initialSelection={receiptSelection}
            {...(queries
              ? {
                  historyQuery: queries.history,
                  ...(queries.pending ? { pendingQuery: queries.pending } : {}),
                }
              : {})}
          />
        ) : null}
      </section>

      <Suspense fallback={<p role="status">{t('admin.invoices.loading', locale)}</p>}>
        <InvoiceDueAtPanel selection={deadlineSelection} />
      </Suspense>
    </div>
  );
}
