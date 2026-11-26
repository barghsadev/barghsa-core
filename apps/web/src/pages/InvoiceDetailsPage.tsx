import { useOwnedManualServerRead } from '../hooks/useServerQuery.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { Button, LoadingStatus, ResultGlyph, buttonVariants } from '@barghsa/ui';
import { InvoiceActivity } from './InvoiceActivity.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  InvoicePaymentSummary,
  invoicePaymentProgress,
} from '../components/InvoicePaymentSummary.js';
import { Currency } from '../components/Currency.js';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { invoiceReceiptPageMessages } from '@barghsa/i18n/receipt-editor';
import { canCustomerSubmitInvoiceBankReceipt } from '@barghsa/shared/finance';
import { ArrowRightIcon, Loader2Icon, ReceiptIcon } from 'lucide-react';
import { useLocale } from '../hooks/useLocale.js';
import { formatInvoiceServicePeriod } from '../lib/invoice-service-period.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import { contractText } from '@barghsa/i18n/contracts';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import {
  InvoiceRequestError,
  fetchInvoiceDetails,
  roleI18nKey,
  stateI18nKey,
  type CustomerInvoiceDetails,
  type CustomerInvoiceNode,
} from '../lib/customer-invoices.js';
import type { InvoiceBankReceiptUploadFormProps } from './InvoiceBankReceiptUploadForm.js';

interface InvoiceDetailsPageProps {
  invoiceId: string;
  ReceiptForm?: ComponentType<InvoiceBankReceiptUploadFormProps>;
}

function isInvoiceUnavailable(error: unknown) {
  return error instanceof InvoiceRequestError && [401, 403, 404].includes(error.status);
}

/**
 * Customer-facing invoice details (T-04.1.05.04 / S-04.1.05).
 *
 * Shows the requested invoice together with the original and every linked
 * replacement or adjustment, each with the staff-supplied explanation of
 * the change. RTL-aware, profile-scoped via the details API.
 */
export function InvoiceDetailsPage({ invoiceId, ReceiptForm }: InvoiceDetailsPageProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const scope = JSON.stringify([actor, revision, invoiceId, !!ReceiptForm]);
  return (
    <OwnedInvoiceDetails
      key={scope}
      invoiceId={invoiceId}
      actor={actor}
      revision={revision}
      scope={scope}
      {...(ReceiptForm ? { ReceiptForm } : {})}
    />
  );
}

function OwnedInvoiceDetails({
  invoiceId,
  actor,
  revision,
  scope,
  ReceiptForm,
}: InvoiceDetailsPageProps & {
  actor: string | null;
  revision: number;
  scope: string;
}) {
  const time = useAccountTime();
  const locale = useLocale();
  const isRtl = locale === 'fa';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (ReceiptForm) heading.current?.focus({ preventScroll: true });
  }, [ReceiptForm, invoiceId]);
  const [details, setDetails] = useState<CustomerInvoiceDetails | null>(null);
  const [error, setError] = useState<'unavailable' | 'load' | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const read = useOwnedManualServerRead(scope);
  const readDetails = useCallback(
    (signal?: AbortSignal) =>
      read(
        queryKeys.invoices.detail(
          { context: 'account', ownerId: actor ?? 'account-session', accountId: actor, revision },
          invoiceId
        ),
        signal,
        (transport) => fetchInvoiceDetails(invoiceId, transport)
      ),
    [read, actor, revision, invoiceId]
  );
  const refreshSequence = useRef(0);
  const refreshDetails = useCallback(async () => {
    const request = ++refreshSequence.current;
    const current = () =>
      request === refreshSequence.current && getProfileContextRevision() === revision;
    try {
      const next = await readDetails();
      if (current()) setDetails(next);
    } catch (err) {
      if (current() && isInvoiceUnavailable(err)) {
        setDetails(null);
        setError('unavailable');
      }
      throw err;
    }
  }, [readDetails, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && getProfileContextRevision() === revision;
    setLoading(true);
    setError(null);
    setDetails(null);
    void readDetails(controller.signal)
      .then((payload) => {
        if (current()) setDetails(payload);
      })
      .catch((err: unknown) => {
        if (current()) setError(isInvoiceUnavailable(err) ? 'unavailable' : 'load');
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
    return () => controller.abort();
  }, [readDetails, reload, revision]);
  const receiptCopy = invoiceReceiptPageMessages[locale];
  const canSubmitReceipt = details && canCustomerSubmitInvoiceBankReceipt(details.invoice);
  const receiptIssue =
    ReceiptForm && !loading
      ? (error ?? (details && !canSubmitReceipt ? 'ineligible' : null))
      : null;
  const backToInvoice = ReceiptForm && !error;
  const backLabel = backToInvoice ? receiptCopy.back : t('invoices.details.back', locale);
  const backContents = (
    <>
      <ArrowRightIcon className={`size-4 ${isRtl ? '' : 'rotate-180'}`} aria-hidden="true" />
      {backLabel}
    </>
  );
  const backClass =
    'touch-action inline-flex items-center gap-2 text-sm text-foreground underline underline-offset-4';
  const backLink = (className: string) =>
    backToInvoice ? (
      <Link to="/invoices/$invoiceId" params={{ invoiceId }} className={className}>
        {backContents}
      </Link>
    ) : (
      <Link to="/invoices" className={className}>
        {backContents}
      </Link>
    );

  return (
    <div
      className={
        ReceiptForm
          ? 'mx-auto max-w-3xl space-y-3'
          : 'mx-auto max-w-3xl space-y-6 rounded-lg bg-background p-4 text-foreground'
      }
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {time.notice}
      {!receiptIssue && <nav aria-label={backLabel}>{backLink(backClass)}</nav>}
      {!ReceiptForm && details?.consultationId && (
        <Link
          className="touch-action text-sm text-primary underline"
          to="/consultations/$requestId"
          params={{ requestId: details.consultationId }}
        >
          {tConsultation('backToRequest', locale)}
        </Link>
      )}
      {!ReceiptForm && details?.electricityOrderId && (
        <Link
          className="touch-action text-sm text-primary underline"
          to="/electricity/orders/$orderId"
          params={{ orderId: details.electricityOrderId }}
        >
          {t('invoices.details.backToElectricityOrder', locale)}
        </Link>
      )}
      {!ReceiptForm && details?.savingOrderId && (
        <Link
          className="touch-action text-sm text-primary underline"
          to="/savings/orders/$orderId"
          params={{ orderId: details.savingOrderId }}
        >
          {t('invoices.details.backToSavingOrder', locale)}
        </Link>
      )}
      {!ReceiptForm && details?.solarRequestId && (
        <Link
          className="touch-action text-sm text-primary underline"
          to="/solar/requests/$requestId"
          params={{ requestId: details.solarRequestId }}
        >
          {t('invoices.details.backToSolarRequest', locale)}
        </Link>
      )}

      {ReceiptForm ? (
        <header className="space-y-1">
          <h1
            ref={heading}
            tabIndex={-1}
            id="invoice-receipt-heading"
            className="text-xl font-semibold outline-none"
          >
            {t('invoices.details.receiptTitle', locale)}
          </h1>
          {!receiptIssue && (
            <p className="text-sm text-muted-foreground">
              {t('invoices.details.receiptSubtitle', locale)}
            </p>
          )}
        </header>
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ReceiptIcon className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-foreground">
              {t('invoices.details.title', locale)}
            </h1>
          </div>
          {details && !error && (
            <div className="flex flex-wrap items-center gap-3">
              {canSubmitReceipt && (
                <Link
                  to="/invoices/$invoiceId/receipts/new"
                  params={{ invoiceId: details.viewedInvoiceId }}
                  className={buttonVariants({ className: 'min-h-11' })}
                >
                  {t('invoices.details.receiptTitle', locale)}
                </Link>
              )}
              <Link
                className="text-sm font-medium text-primary underline underline-offset-4"
                to="/tickets/new"
                search={{ relatedType: 'invoice', relatedId: details.viewedInvoiceId }}
              >
                {tTicketForms('getHelp', locale)}
              </Link>
            </div>
          )}
        </header>
      )}

      {!ReceiptForm && details?.contractId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {details.contractState && (
            <p>
              {t('invoices.details.contractStatus', locale)}:{' '}
              <span className="font-medium">{contractText(details.contractState, locale)}</span>
            </p>
          )}
          <Link
            className="text-primary underline"
            to="/contracts/$contractId/{-$action}"
            params={{ contractId: details.contractId }}
          >
            {t('invoices.details.openContract', locale)}
          </Link>
        </div>
      )}

      {loading ? (
        <LoadingStatus className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('invoices.details.loading', locale)}
        </LoadingStatus>
      ) : receiptIssue ? (
        <section
          aria-labelledby="invoice-receipt-message"
          data-testid={error ? 'invoice-load-error' : undefined}
          className="rounded-xl border bg-card p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <ResultGlyph error={receiptIssue === 'load'} />
            <div className="min-w-0 space-y-1" role={error ? 'alert' : 'status'}>
              <h2 id="invoice-receipt-message" className="text-base font-semibold">
                {receiptIssue === 'ineligible'
                  ? receiptCopy.unavailable
                  : t(
                      receiptIssue === 'load'
                        ? 'invoices.details.error'
                        : 'invoices.details.notFound',
                      locale
                    )}
              </h2>
              {receiptIssue !== 'load' && (
                <p className="text-sm text-muted-foreground">
                  {receiptIssue === 'ineligible'
                    ? receiptCopy.checkInvoice
                    : receiptCopy.chooseInvoice}
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {receiptIssue === 'load' && (
              <Button
                type="button"
                onClick={() => {
                  heading.current?.focus({ preventScroll: true });
                  setReload((value) => value + 1);
                }}
              >
                {t('invoices.activity.retry', locale)}
              </Button>
            )}
            {backLink(buttonVariants({ variant: 'outline', className: 'min-h-11' }))}
          </div>
        </section>
      ) : error ? (
        <p className="text-destructive" role="alert" data-testid="invoice-load-error">
          {t(
            error === 'unavailable' ? 'invoices.details.notFound' : 'invoices.details.error',
            locale
          )}
          {error === 'load' && (
            <button
              type="button"
              className="ms-2 underline"
              onClick={() => setReload((value) => value + 1)}
            >
              {t('invoices.activity.retry', locale)}
            </button>
          )}
        </p>
      ) : details && ReceiptForm ? (
        <InvoiceReceiptEditor
          details={details}
          ReceiptForm={ReceiptForm}
          onRefreshDetails={refreshDetails}
          formatTimestamp={time.format}
        />
      ) : details ? (
        <InvoiceDetailsBody
          key={details.viewedInvoiceId}
          details={details}
          formatTimestamp={time.format}
          onRefreshDetails={refreshDetails}
        />
      ) : null}
    </div>
  );
}

function InvoiceDetailsBody({
  details,
  formatTimestamp,
  onRefreshDetails,
}: {
  details: CustomerInvoiceDetails;
  formatTimestamp: (value: string | null) => string;
  onRefreshDetails: () => Promise<void>;
}) {
  const locale = useLocale();
  const viewed = details.invoice;
  const original = details.chain.find((node) => node.invoiceId === details.originalInvoiceId);
  const linked = details.chain.filter((node) => node.invoiceId !== details.originalInvoiceId);

  return (
    <section aria-labelledby="invoice-chain-heading" className="space-y-3">
      <div>
        <h2 id="invoice-chain-heading" className="text-lg font-semibold text-foreground">
          {t('invoices.details.chain', locale)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('invoices.details.chainDescription', locale)}
        </p>
      </div>

      {original ? (
        <InvoiceCard
          formatTimestamp={formatTimestamp}
          node={original}
          heading={t('invoices.details.original', locale)}
          current={original.invoiceId === details.viewedInvoiceId}
        />
      ) : (
        <InvoiceCard
          formatTimestamp={formatTimestamp}
          node={viewed}
          heading={t(roleI18nKey(viewed.role), locale)}
          current
          showExplanation={viewed.role !== 'original'}
        />
      )}

      {linked.map((node) => (
        <InvoiceCard
          formatTimestamp={formatTimestamp}
          key={node.invoiceId}
          node={node}
          heading={t(roleI18nKey(node.role), locale)}
          current={node.invoiceId === details.viewedInvoiceId}
          showExplanation
        />
      ))}

      <InvoicePaymentSummary invoice={viewed} onRefreshDetails={onRefreshDetails} />
      <InvoiceActivity details={details} formatTimestamp={formatTimestamp} />
    </section>
  );
}

function InvoiceReceiptEditor({
  details,
  ReceiptForm,
  onRefreshDetails,
  formatTimestamp,
}: {
  details: CustomerInvoiceDetails;
  ReceiptForm: ComponentType<InvoiceBankReceiptUploadFormProps>;
  onRefreshDetails: () => Promise<void>;
  formatTimestamp: (value: string | null) => string;
}) {
  const locale = useLocale();
  const invoice = details.invoice;
  const progress = invoicePaymentProgress(invoice.totalAmount, invoice.paidAmount);
  const [showActivity, setShowActivity] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshPending = useRef(false);
  const refreshReceiptHistory = async () => {
    if (refreshPending.current) return;
    refreshPending.current = true;
    setShowActivity(true);
    setRefreshing(true);
    try {
      await onRefreshDetails();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      refreshPending.current = false;
      setRefreshing(false);
    }
  };
  return (
    <section aria-labelledby="invoice-receipt-heading" className="space-y-3">
      <dl className="grid gap-3 rounded-lg border bg-card px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('invoices.details.reference', locale)}</dt>
          <dd className="font-medium">
            <bdi className="break-all">{invoice.invoiceId}</bdi>
          </dd>
        </div>
        {progress && (
          <div>
            <dt className="text-muted-foreground">{t('invoices.payment.remaining', locale)}</dt>
            <dd className="font-semibold">
              <Currency amount={progress.remainingAmount} variant="small" locale={locale} />
            </dd>
          </div>
        )}
      </dl>
      <Suspense fallback={<LoadingStatus>{t('invoices.receipts.loading', locale)}</LoadingStatus>}>
        <ReceiptForm invoiceId={invoice.invoiceId} onSubmitted={refreshReceiptHistory} recordPage />
      </Suspense>
      {refreshing && (
        <LoadingStatus className="text-sm text-muted-foreground">
          {t('invoices.receipts.loading', locale)}
        </LoadingStatus>
      )}
      {refreshFailed && (
        <div className="text-sm text-destructive">
          {!refreshing && <p role="alert">{t('invoices.activity.refreshFailed', locale)}</p>}
          <button
            type="button"
            className="touch-action underline disabled:opacity-60"
            disabled={refreshing}
            onClick={() => void refreshReceiptHistory()}
          >
            {t('invoices.activity.retry', locale)}
          </button>
        </div>
      )}
      {showActivity && <InvoiceActivity details={details} formatTimestamp={formatTimestamp} />}
    </section>
  );
}

function InvoiceCard({
  node,
  heading,
  current,
  showExplanation = false,
  formatTimestamp,
}: {
  node: CustomerInvoiceNode;
  formatTimestamp: (value: string | null) => string;
  heading: string;
  current: boolean;
  showExplanation?: boolean;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const explanation = node.explanation;

  return (
    <article
      data-testid={`invoice-card-${node.invoiceId}`}
      data-role={node.role}
      aria-current={current ? 'page' : undefined}
      className={`rounded-lg border bg-card text-card-foreground p-4 shadow-sm ${
        current ? 'border-primary ring-1 ring-primary/20' : 'border-border'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">{heading}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('invoices.details.reference', locale)}:{' '}
            <bdi dir="ltr" className="break-all font-mono">
              {node.invoiceId}
            </bdi>
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{t(stateI18nKey(node.state), locale)}</p>
      </header>

      {showExplanation || explanation ? (
        <p
          data-testid={`invoice-explanation-${node.invoiceId}`}
          className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          <span className="font-medium">{t('invoices.details.explanation', locale)}: </span>
          {explanation ?? t('invoices.details.noExplanation', locale)}
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">{t('invoices.details.total', locale)}</dt>
          <dd className="font-medium text-foreground">{numbers.money(node.totalAmount)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('invoices.details.paid', locale)}</dt>
          <dd className="font-medium text-foreground">{numbers.money(node.paidAmount)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('invoices.details.issuedAt', locale)}</dt>
          <dd>{formatTimestamp(node.issuedAt)}</dd>
        </div>
        {node.periodStart && node.periodEnd ? (
          <div>
            <dt className="text-muted-foreground">{t('invoices.details.period', locale)}</dt>
            <dd>{formatInvoiceServicePeriod(node.periodStart, node.periodEnd, formatTimestamp)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">{t('invoices.details.dueAt', locale)}</dt>
          <dd>{formatTimestamp(node.dueAt)}</dd>
          {node.dueAtOverrideReason ? (
            <dd
              data-testid={`invoice-due-reason-${node.invoiceId}`}
              className="mt-1 text-foreground"
            >
              <span className="font-medium">{t('invoices.details.explanation', locale)}: </span>
              {node.dueAtOverrideReason}
            </dd>
          ) : null}
        </div>
      </dl>

      {node.lines.length > 0 ? (
        // Arrow keys operate this native scroll region; descendant controls keep their own keys.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          role="region"
          aria-label={`${t('invoices.details.lines', locale)} — ${heading} (${node.invoiceId})`}
          // Native horizontal scrolling needs keyboard focus, including Safari.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          onKeyDown={(event) => {
            const region = event.currentTarget;
            if (
              event.target !== region ||
              region.scrollWidth <= region.clientWidth ||
              (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
            )
              return;
            event.preventDefault();
            region.scrollBy({ left: event.key === 'ArrowLeft' ? -40 : 40 });
          }}
        >
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">{t('invoices.details.lines', locale)}</caption>
            <thead>
              <tr className="border-b text-start text-muted-foreground">
                <th scope="col" className="py-1 font-medium">
                  {t('invoices.details.line.description', locale)}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('invoices.details.line.quantity', locale)}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('invoices.details.line.unitPrice', locale)}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('invoices.details.line.lineTotal', locale)}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('invoices.details.line.vat', locale)}
                </th>
              </tr>
            </thead>
            <tbody>
              {node.lines.map((line, index) => (
                <tr key={`${node.invoiceId}-line-${index}`} className="border-b border-border">
                  <td className="py-1">{line.description}</td>
                  <td className="py-1">{numbers.number(line.quantity)}</td>
                  <td className="py-1">{numbers.money(line.unitPrice)}</td>
                  <td className="py-1">{numbers.money(line.lineTotal)}</td>
                  <td className="py-1">{numbers.money(line.vatAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!current ? (
        <p className="mt-3">
          <Link
            to="/invoices/$invoiceId"
            params={{ invoiceId: node.invoiceId }}
            className="touch-action text-sm text-foreground underline underline-offset-4"
          >
            {t('invoices.details.open', locale)}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
