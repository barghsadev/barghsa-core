import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Button,
  ListPage,
  ListRefreshButton,
  PageLoading,
  StatusBadge,
  buttonVariants,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { t } from '@barghsa/i18n/workspace';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { DocumentRequestError } from '../lib/documents.js';
import { contractRefundOperation } from '../lib/invoice-refund-route.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';

interface Obligation {
  id: string;
  contractId: string | null;
  invoiceId: string;
  amount: string;
  destination: 'wallet' | 'external_bank';
  state: string;
  bankReference: string | null;
  exhausted: boolean;
  orderId: string | null;
}

export function ContractRefundQueue({
  search = {},
  before = null,
}: {
  search?: Record<string, unknown>;
  before?: string | null;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedContractRefundQueue
      key={JSON.stringify([actor, revision, before])}
      search={search}
      before={before}
    />
  );
}

const recordLink = 'touch-action text-primary underline decoration-primary/35 underline-offset-4';
const referenceLink = recordLink + ' inline-flex items-baseline gap-1.5';
function OwnedContractRefundQueue({
  search,
  before,
}: {
  search: Record<string, unknown>;
  before: string | null;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(actor, revision, undefined, 'contract-refunds');
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => contractText(key, locale);
  const [rows, setRows] = useState<(Obligation & { pageBefore: string | null })[]>([]);
  const [cursor, setCursor] = useState(before);
  const [next, setNext] = useState<string | null>(null);
  const [revisionCount, setRevisionCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void readContract<{ obligations: Obligation[]; nextBefore: string | null }>(
      `/api/admin/wallet-refunds/contract-obligations${cursor ? '?before=' + encodeURIComponent(cursor) : ''}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(page.obligations) ||
          (page.nextBefore !== null && typeof page.nextBefore !== 'string')
        )
          throw new Error('Invalid refund queue');
        const pageRows = page.obligations.map((row) => ({ ...row, pageBefore: cursor }));
        setRows((previous) =>
          cursor !== before
            ? [...new Map([...previous, ...pageRows].map((row) => [row.id, row])).values()]
            : pageRows
        );
        setNext(page.nextBefore);
        setStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status)) {
          setRows([]);
          setNext(null);
          setStatus('denied');
        } else {
          setStatus('error');
        }
      });
    return () => controller.abort();
  }, [before, cursor, revisionCount, readContract]);

  function reload(resetPage: boolean) {
    setStatus('loading');
    if (resetPage) {
      setCursor(before);
      setNext(null);
    }
    setRevisionCount((value) => value + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Link to="/admin/contracts" search={search} className={recordLink}>
        {word('backToContracts')}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold" id="refund-obligations-heading">
          {word('cancellationQueue')}
        </h1>
        {status !== 'denied' && (
          <ListRefreshButton
            label={word('refresh')}
            refreshing={status === 'loading'}
            onClick={() => reload(true)}
          />
        )}
      </div>
      {status === 'denied' ? (
        <Alert variant="destructive">
          <AlertDescription>{word('denied')}</AlertDescription>
        </Alert>
      ) : (
        <section
          id="refund-obligations"
          aria-labelledby="refund-obligations-heading"
          className="space-y-3"
        >
          <p className="text-sm text-muted-foreground">{word('cancellationQueueNotice')}</p>
          <ListPage>
            <ListPage.Content
              loading={status === 'loading'}
              error={status === 'error'}
              empty={!rows.length}
              retainContent={!!rows.length}
              loadingView={<PageLoading label={word('loading')} />}
              errorView={
                <Alert variant="destructive">
                  <AlertDescription>{word('cancellationQueueError')}</AlertDescription>
                  <Button type="button" variant="outline" onClick={() => reload(false)}>
                    {word('retry')}
                  </Button>
                </Alert>
              }
              emptyView={
                <p className="rounded-xl border bg-card px-4 py-6 text-sm">
                  {word('cancellationQueueEmpty')}
                </p>
              }
            >
              <ul className="divide-y rounded-xl border bg-card">
                {rows.map((row) => {
                  const operation = contractRefundOperation(row, row.exhausted);
                  return (
                    <li
                      key={row.id}
                      className="grid min-w-0 gap-3 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <strong>{numbers.money(row.amount)}</strong>
                          <span className="text-sm text-muted-foreground">
                            {word('cancellation.' + row.destination)}
                          </span>
                          <StatusBadge label={word('cancellation.refund.' + row.state)} />
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                          {row.contractId && isInvoiceUuid(row.contractId) && (
                            <Link
                              to="/admin/contracts/$contractId/{-$action}/{-$item}"
                              params={{ contractId: row.contractId }}
                              search={search}
                              className={referenceLink}
                              title={row.contractId}
                            >
                              {word('cancellationQueueContract')}{' '}
                              <bdi>{row.contractId.slice(-8)}</bdi>
                            </Link>
                          )}
                          {isInvoiceUuid(row.invoiceId) && (
                            <Link
                              to="/admin/invoices/$invoiceId"
                              params={{ invoiceId: row.invoiceId }}
                              className={referenceLink}
                              title={row.invoiceId}
                            >
                              {word('cancellationInvoice')} <bdi>{row.invoiceId.slice(-8)}</bdi>
                            </Link>
                          )}
                          {row.orderId && isInvoiceUuid(row.orderId) && (
                            <Link
                              to="/admin/electricity-orders/$orderId"
                              params={{ orderId: row.orderId }}
                              className={referenceLink}
                              title={row.orderId}
                            >
                              {t('electricity.order.success.order', locale)}{' '}
                              <bdi>{row.orderId.slice(-8)}</bdi>
                            </Link>
                          )}
                        </div>
                        {row.state === 'Failed' && row.destination === 'wallet' && (
                          <p className="text-sm text-muted-foreground">
                            {word(
                              row.exhausted
                                ? 'cancellationQueueExhausted'
                                : 'cancellationQueueScheduled'
                            )}
                          </p>
                        )}
                        {row.state === 'Processing' && row.bankReference && (
                          <p className="break-all text-sm text-muted-foreground">
                            {word('cancellationBankReference')}{' '}
                            <bdi className="font-medium text-foreground">{row.bankReference}</bdi>
                          </p>
                        )}
                      </div>
                      {operation && isInvoiceUuid(row.id) && isInvoiceUuid(row.invoiceId) && (
                        <Link
                          to="/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}"
                          params={{
                            invoiceId: row.invoiceId,
                            action: 'refunds',
                            destination: row.destination === 'wallet' ? 'wallet' : 'bank',
                            view: row.id,
                            operation,
                          }}
                          state={{ contractRefundQueue: { before: row.pageBefore, search } }}
                          disabled={status !== 'ready'}
                          className={buttonVariants({
                            size: 'sm',
                            variant: 'outline',
                            className: 'min-h-11 w-fit',
                          })}
                        >
                          {word('cancellation.queue.' + operation)}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={!!next && status !== 'error'}
              loading={status === 'loading'}
              label={word('cancellationQueuePages')}
              nextLabel={word('next')}
              onNext={() => {
                if (next) {
                  setStatus('loading');
                  setCursor(next);
                }
              }}
            />
            {before && (
              <Link to="/admin/contracts/refunds" search={search} className={recordLink}>
                {word('firstRefundPage')}
              </Link>
            )}
          </ListPage>
        </section>
      )}
    </div>
  );
}
