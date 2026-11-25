import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { tManualInvoice } from '@barghsa/i18n/manual-invoice';
import { Button, buttonVariants, PageLoading } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import type { ReceiptHistoryQuery } from '../components/InvoiceBankReceiptQueue.js';
import { InvoiceLedger } from '../components/InvoiceLedger.js';

const ReceiptQueue = lazy(() =>
  import('../components/InvoiceBankReceiptQueue.js').then(({ InvoiceBankReceiptQueue }) => ({
    default: InvoiceBankReceiptQueue,
  }))
);

export interface InvoiceListQueries {
  pending: ListQueryBinding;
  ledger: ListQueryBinding;
  history: ReceiptHistoryQuery;
  receiptsOpen: boolean;
  setReceiptsOpen: (open: boolean) => void;
}

export default function AdminInvoicesPage({
  queries,
  recordSearch,
  onLookupInvoice,
  onOpenReceiptRecord,
}: {
  queries: InvoiceListQueries;
  recordSearch: Record<string, unknown>;
  onLookupInvoice: (invoiceId: string) => void;
  onOpenReceiptRecord: (receiptId: string) => void;
}) {
  const locale = useLocale();
  return (
    <div className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('admin.invoices.nav', locale)}</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/invoices/tools/{-$section}/{-$service}"
            params={{ section: undefined, service: undefined }}
            search={recordSearch}
            className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
          >
            {t('admin.invoices.tools', locale)}
          </Link>
          <Link
            className={buttonVariants({ className: 'min-h-11' })}
            to="/admin/invoices/new"
            search={recordSearch}
          >
            {tManualInvoice('admin.manualInvoice.new', locale)}
          </Link>
        </div>
      </header>
      <InvoiceLedger
        query={queries.ledger}
        recordSearch={recordSearch}
        onLookupInvoice={onLookupInvoice}
      />
      <section id="invoice-receipt-panel" className="space-y-4">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          aria-expanded={queries.receiptsOpen}
          aria-controls="invoice-receipt-lists"
          onClick={() => queries.setReceiptsOpen(!queries.receiptsOpen)}
        >
          {t('admin.invoiceReceipts.title', locale)}
        </Button>
        <div id="invoice-receipt-lists" hidden={!queries.receiptsOpen}>
          {queries.receiptsOpen && (
            <Suspense fallback={<PageLoading label={t('admin.invoiceReceipts.loading', locale)} />}>
              <ReceiptQueue
                onOpenRecord={onOpenReceiptRecord}
                pendingQuery={queries.pending}
                historyQuery={queries.history}
              />
            </Suspense>
          )}
        </div>
      </section>
    </div>
  );
}
