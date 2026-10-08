import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, ListPage, PageLoading, StatusBadge } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { RefundDecisionControls, type RefundDecisionDraft } from './RefundDecisionControls.js';
import { RefundFormAlert } from './RefundFormFeedback.js';
import { requestRefundReview, RefundReviewError } from '../lib/refund-review.js';
import { validRefundReceipt } from '../lib/refund-receipt.js';
import type { RefundDecisionValues, RefundOperation } from '../hooks/useRefundForm.js';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
const loadRefundSummary = () => import('./RefundFinancialReviewSummary.js');
interface Obligation {
  id: string;
  contractId: string | null;
  invoiceId: string;
  amount: string;
  destination: 'wallet' | 'external_bank';
  state: string;
  bankReference: string | null;
  nextAttemptAt: string | null;
  exhausted: boolean;
  orderId: string | null;
}
export function ContractRefundQueue() {
  useEffect(() => {
    if (window.location.hash === '#refund-obligations')
      document.getElementById('refund-obligations')?.scrollIntoView();
  }, []);
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [rows, setRows] = useState<Obligation[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false);
  const acceptedRows = useRef<Obligation[]>([]),
    selected = useRef<Obligation | null>(null),
    accessDenied = useRef(false),
    generation = useRef(0);
  const drafts = useRef<Record<string, RefundDecisionValues>>({});
  const [action, setAction] = useState<TeamAction | null>(null),
    [reviewBusy, setReviewBusy] = useState(false),
    [reviewError, setReviewError] = useState<string | null>(null),
    [summary, setSummary] = useState<React.ReactNode>(null);
  const pending = useRef<number | null>(null),
    current = useRef<TeamAction | null>(null),
    reviewController = useRef<AbortController | null>(null),
    readController = useRef<AbortController | null>(null);
  const actionTools = useRef<{
    apply: (fields: unknown[]) => boolean;
    receipt: (result: unknown) => boolean;
    reset: () => void;
  } | null>(null);
  const financialWord = (key: string) =>
    adminText(
      `admin.invoices.${key === 'bankReference' ? 'externalRefunds' : 'walletRefunds'}.${key}`,
      locale
    );
  const formWord = (key: string) =>
    key === 'bankReference' ? word('cancellationBankReference') : word('cancellation.queue.' + key);
  useEffect(
    () => () => {
      ++generation.current;
      reviewController.current?.abort();
    },
    []
  );
  useEffect(() => {
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setError(false);
    void documentRequest<{ obligations: Obligation[]; nextBefore: string | null }>(
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
        const old = acceptedRows.current;
        const items = cursor
          ? [
              ...old.map((row) => page.obligations.find((item) => item.id === row.id) ?? row),
              ...page.obligations.filter((row) => !old.some((existing) => existing.id === row.id)),
            ]
          : page.obligations;
        if (
          selected.current &&
          !items.some((row) => JSON.stringify(row) === JSON.stringify(selected.current))
        )
          clearAction();
        acceptedRows.current = items;
        accessDenied.current = false;
        setDenied(false);
        setRows(items);
        setNext(page.nextBefore);
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          deny();
        else setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, reload]);
  function refresh() {
    setCursor(null);
    setNext(null);
    setReload((value) => value + 1);
  }
  function clearAction() {
    ++generation.current;
    selected.current = null;
    current.current = null;
    pending.current = null;
    reviewController.current?.abort();
    setReviewBusy(false);
    setAction(null);
    setSummary(null);
  }
  function deny() {
    accessDenied.current = true;
    readController.current?.abort();
    acceptedRows.current = [];
    clearAction();
    drafts.current = {};
    setRows([]);
    setNext(null);
    setDenied(true);
    setLoading(false);
  }
  function choose(row: Obligation, command: RefundOperation, form: RefundDecisionDraft) {
    if (
      loading ||
      error ||
      accessDenied.current ||
      pending.current !== null ||
      current.current ||
      !(command === 'process'
        ? row.destination === 'wallet' && row.state === 'Failed' && row.exhausted
        : row.destination === 'external_bank' &&
          row.state === (command === 'record-transfer' ? 'Approved' : 'Processing'))
    )
      return;
    const owner = ++generation.current;
    pending.current = owner;
    selected.current = row;
    setReviewBusy(true);
    setReviewError(null);
    form.operation.current = command;
    if (command === 'reconcile') form.form.setValue('bankReference', row.bankReference ?? '');
    const owns = () =>
      !accessDenied.current && owner === generation.current && pending.current === owner;
    const apply = (fields: unknown[]) =>
      command === 'record-transfer' && form.applyServerErrors(fields);
    void form.form
      .handleSubmit(async (values) => {
        if (!owns()) return;
        const body = command === 'process' ? {} : { bankReference: values.bankReference.trim() };
        const actionPath = `/api/admin/${row.destination === 'wallet' ? 'wallet-refunds' : 'external-refunds'}/${row.id}/${command}`;
        const controller = new AbortController();
        reviewController.current = controller;
        try {
          const value = await requestRefundReview(actionPath + '/review', body, controller.signal);
          const { parseRefundDecisionReview } = await import('@barghsa/shared/finance');
          if (!owns()) return;
          const review = parseRefundDecisionReview(value);
          if (
            !review ||
            review.scope.resourceId !== row.id ||
            review.data.invoice.id !== row.invoiceId ||
            review.data.refund.destination !== row.destination ||
            review.data.refund.amount !== row.amount ||
            review.data.refund.state !== row.state ||
            review.data.decision.action !== command ||
            review.data.decision.bankReference !== (body.bankReference ?? null) ||
            review.data.decision.reason !== null
          )
            throw new Error('Invalid obligation review');
          const { default: RefundFinancialReviewSummary } = await loadRefundSummary();
          if (!owns()) return;
          const chosen: TeamAction = {
            title: word('cancellation.queue.' + command),
            description: word(
              command === 'reconcile'
                ? 'cancellationQueueReconcileNotice'
                : 'cancellationQueueRetryNotice'
            ),
            path: actionPath,
            method: 'POST',
            body: { ...body, expectedReviewHash: review.hash },
            conflictMessage: word('cancellationConflict'),
            forbiddenMessage: word('denied'),
          };
          current.current = chosen;
          setAction(chosen);
          setSummary(<RefundFinancialReviewSummary review={review} word={financialWord} />);
          actionTools.current = {
            apply,
            reset: () => {
              delete drafts.current[row.id];
              form.form.reset({ reason: '', bankReference: '' });
            },
            receipt: (result) =>
              validRefundReceipt(
                result,
                row,
                command === 'process'
                  ? ['Processing', 'Completed', 'Failed']
                  : [review.data.decision.targetState],
                body.bankReference,
                command
              ),
          };
        } catch (failure) {
          if (!owns()) return;
          if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)) {
            deny();
            return;
          }
          if (failure instanceof RefundReviewError && failure.fields && apply(failure.fields))
            return;
          setReviewError(
            word(
              failure instanceof DocumentRequestError && failure.status === 409
                ? 'cancellationConflict'
                : 'cancellationQueueError'
            )
          );
          if (failure instanceof DocumentRequestError && failure.status === 409) refresh();
        }
      })()
      .finally(() => {
        if (owns()) {
          pending.current = null;
          setReviewBusy(false);
          if (!current.current) selected.current = null;
        }
      });
  }
  const actionGeneration = generation.current;
  const controls = (row: Obligation) => (
    <RefundDecisionControls
      row={row}
      referenceOnly
      prefix="contract-refund"
      word={formWord}
      disabled={loading || error || reviewBusy || !!action}
      initial={
        drafts.current[row.id] ?? {
          reason: '',
          bankReference: row.state === 'Processing' ? (row.bankReference ?? '') : '',
        }
      }
      saveDraft={(values) => {
        drafts.current[row.id] = values;
      }}
      onChoose={(operation, form) => choose(row, operation, form)}
    />
  );
  if (denied) return null;
  return (
    <section
      id="refund-obligations"
      className="flex flex-col gap-4 rounded-xl border bg-card p-5"
      aria-label={word('cancellationQueue')}
    >
      <ListPage>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{word('cancellationQueue')}</h2>
            <Button variant="ghost" disabled={loading} onClick={refresh}>
              {word('refresh')}
            </Button>
          </div>
        </ListPage.Toolbar>
        <p className="text-sm text-muted-foreground">{word('cancellationQueueNotice')}</p>
        <RefundFormAlert message={reviewError ?? undefined} />
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!rows.length}
          retainContent={!!rows.length}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            <Alert variant="destructive">
              <AlertDescription>{word('cancellationQueueError')}</AlertDescription>
              <Button
                type="button"
                variant="outline"
                onClick={() => setReload((value) => value + 1)}
              >
                {word('retry')}
              </Button>
            </Alert>
          }
          emptyView={<p>{word('cancellationQueueEmpty')}</p>}
        >
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    <bdi>{new Intl.NumberFormat(locale).format(BigInt(row.amount))}</bdi>{' '}
                    {word('irr')} · {word('cancellation.' + row.destination)}
                  </p>
                  <StatusBadge label={word('cancellation.refund.' + row.state)} />
                </div>
                {row.contractId ? (
                  <p className="break-all text-xs text-muted-foreground">
                    {word('cancellationQueueContract')}: <bdi>{row.contractId}</bdi>
                  </p>
                ) : null}
                {row.orderId && (
                  <p className="break-all text-xs text-muted-foreground">
                    {t('electricity.order.success.order', locale)}: <bdi>{row.orderId}</bdi>
                  </p>
                )}
                <p className="break-all text-xs text-muted-foreground">
                  {word('cancellationInvoice')}: <bdi>{row.invoiceId}</bdi>
                </p>
                {row.destination === 'wallet' &&
                  row.state === 'Failed' &&
                  (row.exhausted ? (
                    <>
                      <p className="text-sm">{word('cancellationQueueExhausted')}</p>
                      {controls(row)}
                    </>
                  ) : (
                    <p className="text-sm">{word('cancellationQueueScheduled')}</p>
                  ))}
                {row.destination === 'external_bank' &&
                  ['Approved', 'Processing'].includes(row.state) && (
                    <>
                      {row.state === 'Processing' && (
                        <p className="text-sm">
                          {word('cancellationBankReference')}: <bdi>{row.bankReference}</bdi>
                        </p>
                      )}
                      {controls(row)}
                    </>
                  )}
              </li>
            ))}
          </ul>
        </ListPage.Content>
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!next && !error}
          loading={loading}
          label={word('cancellationQueuePages')}
          nextLabel={word('next')}
          onNext={() => {
            if (next) setCursor(next);
          }}
        />
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          summary={summary}
          confirmationDisabled={loading || error || accessDenied.current}
          onClose={() => {
            if (actionGeneration === generation.current && current.current === action)
              clearAction();
          }}
          onDenied={() => {
            if (actionGeneration === generation.current && current.current === action) deny();
          }}
          onValidationError={(fields) =>
            actionGeneration === generation.current &&
            current.current === action &&
            !!actionTools.current?.apply(fields)
          }
          onSuccess={async (result) => {
            if (
              accessDenied.current ||
              actionGeneration !== generation.current ||
              current.current !== action
            )
              return;
            const tools = actionTools.current;
            if (!tools?.receipt(result))
              throw new Error('Refund obligation acknowledgement mismatch');
            tools.reset();
            clearAction();
            refresh();
          }}
        />
      )}
    </section>
  );
}
