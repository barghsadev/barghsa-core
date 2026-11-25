import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Link, useBlocker, useLocation } from '@tanstack/react-router';
import { buttonVariants, PageLoading } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { receiptEditorMessages } from '@barghsa/i18n/receipt-editor';
import { contractText } from '@barghsa/i18n/contracts';
import type { InvoiceReceiptDecision } from '../lib/invoice-receipt-decision.js';
import type {
  InvoiceRefundDecision,
  InvoiceRefundDestination,
} from '../lib/invoice-refund-route.js';
import { useLocale } from '../hooks/useLocale.js';
import { InvoiceLedger } from '../components/InvoiceLedger.js';

const InvoiceCorrectionsPanel = lazy(() => import('../components/InvoiceCorrectionsPanel.js'));
const RefundPanel = lazy(() =>
  import('../components/RefundPanel.js').then(({ RefundPanel }) => ({ default: RefundPanel }))
);

type Entry =
  | {
      mode: 'new';
      title: string;
      Form: ComponentType<{
        recordPage: boolean;
        onLocked: (locked: boolean) => void;
        renderInvoiceLink: (id: string) => ReactNode;
      }>;
    }
  | {
      mode: 'receipt';
      receiptId: string;
      decision?: InvoiceReceiptDecision | undefined;
      Panel: ComponentType<{
        recordId: string;
        recordDecision?: InvoiceReceiptDecision | undefined;
        recordSearch: Record<string, unknown>;
        onLocked: (locked: boolean) => void;
      }>;
    }
  | {
      mode: 'refunds';
      invoiceId: string;
      destination: InvoiceRefundDestination | undefined;
      request: boolean;
      refundDecision?: InvoiceRefundDecision;
    }
  | {
      mode: 'deadline';
      invoiceId: string;
      Panel: ComponentType<{ recordId: string; onLocked: (locked: boolean) => void }>;
    }
  | { mode: 'detail' | 'correction'; invoiceId: string };

export default function AdminInvoiceRecordPage({
  entry,
  search,
}: {
  entry: Entry;
  search: Record<string, unknown>;
}) {
  const locale = useLocale();
  const queueReturn = useLocation({ select: (location) => location.state.contractRefundQueue });
  const [commandLocked, setLocked] = useState(false);
  useBlocker({ shouldBlockFn: () => commandLocked, enableBeforeUnload: () => commandLocked });
  const heading = useRef<HTMLHeadingElement>(null);
  const invoiceId = 'invoiceId' in entry ? entry.invoiceId : undefined;
  const receiptId = entry.mode === 'receipt' ? entry.receiptId : undefined;
  const decision = entry.mode === 'receipt' ? entry.decision : undefined;
  const refundDestination = entry.mode === 'refunds' ? entry.destination : undefined;
  const refundRequest = entry.mode === 'refunds' && entry.request;
  const refundDecision = entry.mode === 'refunds' ? entry.refundDecision : undefined;
  const operation = refundDecision?.operation;
  const fromContractRefunds =
    !!operation && ['record-transfer', 'reconcile', 'process'].includes(operation) && !!queueReturn;
  const refundText = (key: string) => t(`admin.invoices.refunds.${key}`, locale);
  const backInvoiceId = receiptId
    ? typeof search.receipt_invoiceId === 'string'
      ? search.receipt_invoiceId
      : undefined
    : invoiceId;
  const backToRecord = entry.mode !== 'detail' && backInvoiceId;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [
    entry.mode,
    invoiceId,
    receiptId,
    refundDestination,
    refundRequest,
    operation,
    refundDecision?.refundId,
  ]);
  const word = (key: string) => t(`admin.invoices.ledger.${key}`, locale);
  const actionClass = buttonVariants({ variant: 'outline', className: 'min-h-11' });
  const refundDestinationTitle = (destination: InvoiceRefundDestination) =>
    t(
      destination === 'wallet'
        ? 'admin.invoices.walletRefunds.title'
        : 'admin.invoices.externalRefunds.title',
      locale
    );
  const newRefundTitle = (destination: InvoiceRefundDestination) =>
    destination === 'wallet' ? refundText('newWalletRefund') : refundText('newBankRefund');
  const refundDecisionTitle = operation
    ? fromContractRefunds
      ? contractText('cancellation.queue.' + operation, locale)
      : t(
          `admin.invoices.${operation === 'record-transfer' || operation === 'reconcile' ? 'externalRefunds' : 'walletRefunds'}.${operation}`,
          locale
        )
    : undefined;
  const recordLink = (id: string) => (
    <Link
      to="/admin/invoices/$invoiceId"
      params={{ invoiceId: id }}
      search={search}
      className="touch-action text-sm text-primary underline underline-offset-4"
    >
      {word('detail')}
    </Link>
  );

  return (
    <div
      className={
        refundDecision
          ? 'mx-auto max-w-xl space-y-3'
          : decision || ['new', 'correction', 'deadline', 'refunds'].includes(entry.mode)
            ? 'mx-auto max-w-3xl space-y-3'
            : 'mx-auto max-w-5xl space-y-4'
      }
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {receiptId && decision ? (
        <Link
          to="/admin/invoices/receipts/$receiptId/{-$decision}"
          params={{ receiptId, decision: undefined }}
          search={search}
          disabled={commandLocked}
          data-testid="invoice-receipt-back-to-review"
          className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
        >
          {receiptEditorMessages[locale].backToReceipt}
        </Link>
      ) : fromContractRefunds ? (
        <Link
          to="/admin/contracts/refunds"
          search={{
            ...queueReturn?.search,
            refund_before: queueReturn?.before ?? undefined,
          }}
          disabled={commandLocked}
          data-testid="contract-refund-back-to-queue"
          className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
        >
          {refundText('backToContractRefunds')}
        </Link>
      ) : refundDestination && invoiceId ? (
        <Link
          to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
          params={{
            invoiceId,
            action: 'refunds',
            destination: refundDecision ? refundDestination : undefined,
            view: undefined,
            operation: undefined,
          }}
          search={search}
          disabled={commandLocked}
          data-testid={refundDecision ? 'invoice-refund-back-to-history' : undefined}
          className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
        >
          {refundDecision ? refundText('viewRequests') : refundText('backToRefunds')}
        </Link>
      ) : backToRecord ? (
        <Link
          to="/admin/invoices/$invoiceId"
          params={{ invoiceId: backToRecord }}
          search={search}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {word('backToInvoice')}
        </Link>
      ) : (
        <Link
          to="/admin/invoices"
          search={receiptId ? { ...search, receipts: 'true' } : search}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {word(receiptId ? 'backToReceipts' : 'backToInvoices')}
        </Link>
      )}
      {entry.mode === 'detail' && (
        <InvoiceLedger
          recordId={entry.invoiceId}
          renderActions={(id) => (
            <>
              <Link
                className={actionClass}
                to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                params={{
                  invoiceId: id,
                  action: 'deadline',
                  destination: undefined,
                  view: undefined,
                }}
                search={search}
              >
                {word('changeDueAt')}
              </Link>
              <Link
                className={actionClass}
                to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                params={{
                  invoiceId: id,
                  action: 'refunds',
                  destination: undefined,
                  view: undefined,
                }}
                search={search}
              >
                {word('useRefund')}
              </Link>
              <Link
                className={actionClass}
                to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                params={{
                  invoiceId: id,
                  action: 'correction',
                  destination: undefined,
                  view: undefined,
                }}
                search={search}
              >
                {word('createCorrection')}
              </Link>
            </>
          )}
          renderReceiptAction={(id) => (
            <Link
              to="/admin/invoices/receipts/$receiptId/{-$decision}"
              params={{ receiptId: id, decision: undefined }}
              search={{ ...search, receipt_invoiceId: entry.invoiceId }}
              className="touch-action text-primary underline underline-offset-2"
            >
              {word('openReceipt')}
            </Link>
          )}
        />
      )}
      {entry.mode !== 'detail' && (
        <>
          {entry.mode !== 'receipt' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1
                id="staff-invoice-heading"
                ref={heading}
                tabIndex={-1}
                className="text-xl font-semibold outline-none"
              >
                {entry.mode === 'new'
                  ? entry.title
                  : entry.mode === 'deadline'
                    ? word('changeDueAt')
                    : entry.mode === 'refunds'
                      ? refundDestination
                        ? refundRequest
                          ? newRefundTitle(refundDestination)
                          : (refundDecisionTitle ?? refundDestinationTitle(refundDestination))
                        : word('useRefund')
                      : tInvoiceCorrections('title', locale)}
              </h1>
              {refundDestination && invoiceId && !refundDecision && (
                <Link
                  className={
                    refundRequest
                      ? 'touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60'
                      : buttonVariants()
                  }
                  to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                  params={{
                    invoiceId,
                    action: 'refunds',
                    destination: refundDestination,
                    view: refundRequest ? undefined : 'new',
                  }}
                  search={search}
                  disabled={commandLocked}
                  data-testid={
                    refundRequest ? 'invoice-refund-view-requests' : 'invoice-refund-new'
                  }
                >
                  {refundRequest ? refundText('viewRequests') : newRefundTitle(refundDestination)}
                </Link>
              )}
            </div>
          )}
          {invoiceId && entry.mode !== 'correction' && entry.mode !== 'deadline' && (
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
              <span>{word('invoice')}</span>
              <bdi className="max-w-full break-all font-mono text-xs">{invoiceId}</bdi>
            </p>
          )}
          <Suspense fallback={<PageLoading label={t('admin.invoices.loading', locale)} />}>
            {entry.mode === 'new' && (
              <entry.Form recordPage onLocked={setLocked} renderInvoiceLink={recordLink} />
            )}
            {entry.mode === 'deadline' && (
              <entry.Panel recordId={entry.invoiceId} onLocked={setLocked} />
            )}
            {entry.mode === 'correction' && (
              <InvoiceCorrectionsPanel
                recordId={entry.invoiceId}
                onLocked={setLocked}
                renderInvoiceLink={recordLink}
              />
            )}
            {entry.mode === 'refunds' &&
              (refundDestination ? (
                <RefundPanel
                  destination={refundDestination === 'wallet' ? 'wallet' : 'external_bank'}
                  selectedInvoiceId={entry.invoiceId}
                  recordView={refundDecision ? 'decision' : refundRequest ? 'request' : 'history'}
                  decision={refundDecision}
                  fromContractRefunds={fromContractRefunds}
                  renderDecisionLink={(refundId, operation, label, disabled) => (
                    <Link
                      key={operation}
                      to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                      params={{
                        invoiceId: entry.invoiceId,
                        action: 'refunds',
                        destination: refundDestination,
                        view: refundId,
                        operation,
                      }}
                      search={search}
                      state={{ contractRefundQueue: fromContractRefunds ? queueReturn : undefined }}
                      disabled={disabled}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      data-testid={`invoice-refund-${operation}-${refundId}`}
                    >
                      {label}
                    </Link>
                  )}
                  onLocked={setLocked}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['wallet', 'bank'] as const).map((destination) => (
                    <section
                      key={destination}
                      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5"
                    >
                      <h2 className="font-semibold">{refundDestinationTitle(destination)}</h2>
                      <p className="flex-1 text-sm text-muted-foreground">
                        {destination === 'wallet'
                          ? refundText('walletDestination')
                          : refundText('bankDestination')}
                      </p>
                      <div className="flex flex-col items-start gap-2">
                        <Link
                          className={buttonVariants()}
                          to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                          params={{
                            invoiceId: entry.invoiceId,
                            action: 'refunds',
                            destination,
                            view: 'new',
                          }}
                          search={search}
                        >
                          {newRefundTitle(destination)}
                        </Link>
                        <Link
                          className="touch-action text-sm text-primary underline underline-offset-4"
                          to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                          params={{
                            invoiceId: entry.invoiceId,
                            action: 'refunds',
                            destination,
                            view: undefined,
                          }}
                          search={search}
                          aria-label={`${refundText('viewRequests')} · ${refundDestinationTitle(destination)}`}
                        >
                          {refundText('viewRequests')}
                        </Link>
                      </div>
                    </section>
                  ))}
                </div>
              ))}
            {entry.mode === 'receipt' && (
              <entry.Panel
                recordId={entry.receiptId}
                recordDecision={entry.decision}
                recordSearch={search}
                onLocked={setLocked}
              />
            )}
          </Suspense>
        </>
      )}
    </div>
  );
}
