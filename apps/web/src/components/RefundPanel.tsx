import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { contractText } from '@barghsa/i18n/contracts';
import { Button, Card, CardContent, Input, Field, FieldLabel, StatusBadge } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { requestRefundReview, RefundReviewError } from '../lib/refund-review.js';
import { validRefundReceipt } from '../lib/refund-receipt.js';
import {
  useRefundLookupForm,
  useRefundRequestForm,
  type RefundDecisionValues,
  type RefundOperation,
} from '../hooks/useRefundForm.js';
import { RefundDecisionControls, type RefundDecisionDraft } from './RefundDecisionControls.js';
import { RefundFieldFeedback, RefundFormAlert } from './RefundFormFeedback.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const loadRefundSummary = () => import('./RefundFinancialReviewSummary.js');
interface InvoiceBalance {
  invoiceId: string;
  profileId: string;
  state: string;
  paidAmount: string;
  refundedAmount: string;
  reservedAmount: string;
  availableAmount: string;
  requestable: boolean;
}
interface WalletRefund {
  id: string;
  invoiceId: string;
  amount: string;
  state: string;
  destination: 'wallet' | 'external_bank';
  bankReference: string | null;
  reconciliationStatus: string | null;
  approvalRequestId: string | null;
  retry: { nextAttemptAt: string | null; exhausted: boolean } | null;
}
interface RefundPage {
  invoice: InvoiceBalance;
  refunds: WalletRefund[];
  nextBefore: string | null;
}

function validPage(
  value: unknown,
  invoiceId: string,
  destination: 'wallet' | 'external_bank'
): value is RefundPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as RefundPage;
  const invoice = page.invoice;
  return (
    invoice?.invoiceId === invoiceId &&
    typeof invoice.profileId === 'string' &&
    typeof invoice.state === 'string' &&
    ['paidAmount', 'refundedAmount', 'reservedAmount', 'availableAmount'].every((key) =>
      /^\d{1,19}$/.test(invoice[key as keyof InvoiceBalance] as string)
    ) &&
    typeof invoice.requestable === 'boolean' &&
    Array.isArray(page.refunds) &&
    page.refunds.every(
      (refund) =>
        typeof refund.id === 'string' &&
        refund.invoiceId === invoiceId &&
        refund.destination === destination &&
        /^\d{1,19}$/.test(refund.amount) &&
        typeof refund.state === 'string' &&
        (refund.bankReference === null || typeof refund.bankReference === 'string') &&
        (refund.reconciliationStatus === null || typeof refund.reconciliationStatus === 'string') &&
        (refund.approvalRequestId === null || typeof refund.approvalRequestId === 'string')
    ) &&
    (page.nextBefore === null || typeof page.nextBefore === 'string')
  );
}

const externalKeys = new Set([
  'title',
  'description',
  'request',
  'confirmRequest',
  'requests',
  'empty',
  'bankReference',
  'recordedReference',
  'record-transfer',
  'reconcile',
  'secondReviewer',
]);

type PanelProps = { destination: 'wallet' | 'external_bank'; selectedInvoiceId?: string };
export function RefundPanel(props: PanelProps) {
  return (
    <RefundWorkspace key={props.destination + ':' + (props.selectedInvoiceId ?? '')} {...props} />
  );
}
function RefundWorkspace({ destination, selectedInvoiceId = '' }: PanelProps) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const word = (key: string) =>
    t(
      `admin.invoices.${destination === 'external_bank' && externalKeys.has(key) ? 'externalRefunds' : 'walletRefunds'}.${key}`,
      locale
    );
  const path = destination === 'wallet' ? 'wallet-refunds' : 'external-refunds';
  const fieldPrefix = destination === 'wallet' ? 'wallet-refund' : 'external-refund';
  const lookup = useRefundLookupForm(selectedInvoiceId, word('invalidInvoiceId'));
  const [input, setInput] = lookup.field('invoiceId');
  const [invoiceId, setInvoiceId] = useState(
    isInvoiceUuid(selectedInvoiceId.trim()) ? selectedInvoiceId.trim().toLowerCase() : ''
  );
  const [invoice, setInvoice] = useState<InvoiceBalance | null>(null);
  const [refunds, setRefunds] = useState<WalletRefund[]>([]);
  const [before, setBefore] = useState<string | null>(null),
    [nextBefore, setNextBefore] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'denied'>('idle');
  const draft = useRefundRequestForm(invoice?.availableAmount ?? '0');
  const [amount, setAmount] = draft.field('amount'),
    [reason, setReason] = draft.field('reason');
  const cachedDrafts = useRef<Record<string, RefundDecisionValues>>({});
  const [action, setAction] = useState<TeamAction | null>(null),
    [summary, setSummary] = useState<React.ReactNode>(null),
    [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<'conflict' | 'forbidden' | 'error' | null>(null),
    [decisionError, setDecisionError] = useState<'conflict' | 'forbidden' | 'error' | null>(null);
  const live = useRef(false),
    generation = useRef(0),
    current = useRef<TeamAction | null>(null),
    pending = useRef<number | null>(null),
    reviewController = useRef<AbortController | null>(null),
    readController = useRef<AbortController | null>(null);
  const accepted = useRef<{ invoice: InvoiceBalance | null; refunds: WalletRefund[] }>({
    invoice: null,
    refunds: [],
  });
  const selection = useRef<{ invoice: InvoiceBalance; refund?: WalletRefund } | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = reviewBusy || !!action;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      reviewController.current?.abort();
    };
  }, []);
  function close() {
    generation.current++;
    current.current = null;
    pending.current = null;
    selection.current = null;
    reviewController.current?.abort();
    setReviewBusy(false);
    setAction(null);
    setSummary(null);
  }
  function deny() {
    close();
    readController.current?.abort();
    accepted.current = { invoice: null, refunds: [] };
    cachedDrafts.current = {};
    setInvoice(null);
    setRefunds([]);
    setNextBefore(null);
    setStatus('denied');
    lookup.form.reset({ invoiceId: '' });
    draft.form.reset({ amount: '', reason: '' });
  }
  useEffect(() => {
    if (!invoiceId) return;
    const controller = new AbortController();
    readController.current = controller;
    setStatus('loading');
    void documentRequest<RefundPage>(
      `/api/admin/${path}?invoiceId=${encodeURIComponent(invoiceId)}${before ? '&before=' + encodeURIComponent(before) : ''}`,
      { signal: controller.signal }
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (!validPage(page, invoiceId, destination)) throw new Error('Invalid refund page');
        const rows = before
          ? [
              ...accepted.current.refunds.map(
                (row) => page.refunds.find((item) => item.id === row.id) ?? row
              ),
              ...page.refunds.filter(
                (row) => !accepted.current.refunds.some((old) => old.id === row.id)
              ),
            ]
          : page.refunds;
        const selected = selection.current;
        if (
          selected &&
          (JSON.stringify(page.invoice) !== JSON.stringify(selected.invoice) ||
            (selected.refund &&
              !rows.some((row) => JSON.stringify(row) === JSON.stringify(selected.refund))))
        )
          close();
        accepted.current = { invoice: page.invoice, refunds: rows };
        setInvoice(page.invoice);
        setRefunds(rows);
        setNextBefore(page.nextBefore);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status)) deny();
        else setStatus('error');
      });
    return () => controller.abort();
  }, [invoiceId, before, revision, destination, path]);
  function refresh() {
    setBefore(null);
    setRevision((value) => value + 1);
  }
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current !== null || current.current || lookup.form.isSubmissionPending()) return;
    void lookup.form.handleSubmit((values) => {
      if (!live.current || pending.current !== null || current.current) return;
      const id = values.invoiceId.trim().toLowerCase();
      if (id !== invoiceId) {
        close();
        accepted.current = { invoice: null, refunds: [] };
        cachedDrafts.current = {};
        setInvoice(null);
        setRefunds([]);
        draft.form.reset({ amount: '', reason: '' });
      }
      setInvoiceId(id);
      setBefore(null);
      setRevision((value) => value + 1);
    })(event);
  }
  function claim(refund?: WalletRefund) {
    if (
      pending.current !== null ||
      current.current ||
      statusRef.current !== 'ready' ||
      !accepted.current.invoice ||
      lookup.form.getValues('invoiceId').trim().toLowerCase() !== invoiceId
    )
      return null;
    const owner = ++generation.current;
    pending.current = owner;
    selection.current = { invoice: accepted.current.invoice, ...(refund ? { refund } : {}) };
    setReviewBusy(true);
    return owner;
  }
  function owns(owner: number) {
    return live.current && owner === generation.current && pending.current === owner;
  }
  function failure(
    error: unknown,
    owner: number,
    apply: (fields: unknown[]) => boolean,
    decision: boolean
  ) {
    if (!owns(owner)) return;
    if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status)) {
      deny();
      return;
    }
    if (error instanceof RefundReviewError && error.fields && apply(error.fields)) return;
    (decision ? setDecisionError : setReviewError)(
      error instanceof DocumentRequestError && error.status === 409 ? 'conflict' : 'error'
    );
    if (error instanceof DocumentRequestError && error.status === 409) refresh();
  }
  function finish(owner: number) {
    if (owns(owner)) {
      pending.current = null;
      setReviewBusy(false);
      if (!current.current) selection.current = null;
    }
  }
  function request(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice?.requestable || draft.form.isSubmissionPending()) return;
    const owner = claim();
    if (owner === null) return;
    setReviewError(null);
    void draft.form
      .handleSubmit(async (values) => {
        if (!owns(owner) || statusRef.current !== 'ready') return;
        const selected = selection.current!.invoice;
        const command = {
          invoiceId: selected.invoiceId,
          amount: BigInt(normalizeProfileDigits(values.amount)).toString(),
          reason: values.reason.trim(),
        };
        const controller = new AbortController();
        reviewController.current = controller;
        try {
          const value = await requestRefundReview(
            `/api/admin/${path}/review`,
            command,
            controller.signal
          );
          const { parseRefundRequestReview } = await import('@barghsa/shared/finance');
          if (!owns(owner)) return;
          const review = parseRefundRequestReview(value);
          if (
            !review ||
            review.scope.resourceId !== command.invoiceId ||
            review.data.refund.destination !== destination ||
            review.data.refund.amount !== command.amount ||
            review.data.refund.reason !== command.reason
          )
            throw new Error('Invalid refund review');
          const { default: RefundFinancialReviewSummary } = await loadRefundSummary();
          if (!owns(owner)) return;
          const chosen: TeamAction = {
            title: word('request'),
            description: word('confirmRequest'),
            path: `/api/admin/${path}`,
            method: 'POST',
            body: {
              ...command,
              idempotencyKey: crypto.randomUUID(),
              expectedReviewHash: review.hash,
            },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('forbidden'),
          };
          current.current = chosen;
          setAction(chosen);
          setSummary(<RefundFinancialReviewSummary review={review} word={word} />);
          actionTools.current = {
            apply: draft.applyServerErrors,
            reset: () => draft.form.reset({ amount: '', reason: '' }),
            receipt: (result) =>
              validRefundReceipt(
                result,
                { invoiceId: command.invoiceId, destination, amount: command.amount },
                ['Requested', 'Approved']
              ),
          };
        } catch (error) {
          failure(error, owner, draft.applyServerErrors, false);
        }
      })(event)
      .finally(() => finish(owner));
  }
  const actionTools = useRef<{
    apply: (fields: unknown[]) => boolean;
    reset: () => void;
    receipt: (result: unknown) => boolean;
  } | null>(null);
  function decide(refund: WalletRefund, operation: RefundOperation, form: RefundDecisionDraft) {
    const owner = claim(refund);
    if (owner === null) return;
    form.operation.current = operation;
    setDecisionError(null);
    const apply = (fields: unknown[]) =>
      fields.every((field) =>
        ['reject', 'cancel'].includes(operation)
          ? field === 'reason'
          : ['record-transfer', 'reconcile'].includes(operation) && field === 'bankReference'
      ) && form.applyServerErrors(fields);
    void form.form
      .handleSubmit(async (values) => {
        if (!owns(owner) || statusRef.current !== 'ready') return;
        const body = ['record-transfer', 'reconcile'].includes(operation)
          ? { bankReference: values.bankReference.trim() }
          : ['reject', 'cancel'].includes(operation)
            ? { reason: values.reason.trim() }
            : {};
        const actionPath = `/api/admin/${path}/${encodeURIComponent(refund.id)}/${operation}`;
        const controller = new AbortController();
        reviewController.current = controller;
        try {
          const value = await requestRefundReview(actionPath + '/review', body, controller.signal);
          const { parseRefundDecisionReview } = await import('@barghsa/shared/finance');
          if (!owns(owner)) return;
          const review = parseRefundDecisionReview(value);
          if (
            !review ||
            review.scope.resourceId !== refund.id ||
            review.data.invoice.id !== refund.invoiceId ||
            review.data.refund.destination !== destination ||
            review.data.refund.amount !== refund.amount ||
            review.data.refund.state !== refund.state ||
            review.data.decision.action !== operation ||
            review.data.decision.reason !== (body.reason ?? null) ||
            review.data.decision.bankReference !== (body.bankReference ?? null)
          )
            throw new Error('Invalid refund decision review');
          const { default: RefundFinancialReviewSummary } = await loadRefundSummary();
          if (!owns(owner)) return;
          const chosen: TeamAction = {
            title: word(operation),
            description: word('confirmDecision'),
            path: actionPath,
            method: 'POST',
            body: { ...body, expectedReviewHash: review.hash },
            conflictMessage: word('conflict'),
            forbiddenMessage: word('forbidden'),
          };
          current.current = chosen;
          setAction(chosen);
          setSummary(<RefundFinancialReviewSummary review={review} word={word} />);
          actionTools.current = {
            apply,
            reset: () => {
              delete cachedDrafts.current[refund.id];
              form.form.reset({ reason: '', bankReference: '' });
            },
            receipt: (result) =>
              validRefundReceipt(
                result,
                refund,
                operation === 'process'
                  ? ['Processing', 'Completed', 'Failed']
                  : [review.data.decision.targetState],
                body.bankReference,
                operation
              ),
          };
        } catch (error) {
          failure(error, owner, apply, true);
        }
      })()
      .finally(() => finish(owner));
  }
  const matches = input.trim().toLowerCase() === invoiceId;
  const unavailable = status !== 'ready' || busy || !matches;
  return (
    <section
      id={destination === 'wallet' ? 'wallet-refunds-panel' : 'external-refunds-panel'}
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-label={word('title')}
    >
      <h2 className="text-lg font-semibold">{word('title')}</h2>
      <p className="text-sm text-muted-foreground">{word('description')}</p>
      <form
        onSubmit={load}
        noValidate
        aria-busy={lookup.form.formState.isSubmitting || undefined}
        className="flex flex-wrap items-end gap-3"
      >
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={fieldPrefix + '-invoice'}>{word('invoiceId')}</FieldLabel>
          <Input
            id={fieldPrefix + '-invoice'}
            dir="ltr"
            value={input}
            {...lookup.bind('invoiceId')}
            disabled={busy || lookup.form.formState.isSubmitting}
            onChange={(event) => setInput(event.target.value)}
          />
          <RefundFieldFeedback
            id={lookup.errorId('invoiceId')}
            error={lookup.errors.invoiceId}
            message={word('invalidInvoiceId')}
          />
        </Field>
        <Button type="submit" disabled={busy || lookup.form.formState.isSubmitting}>
          {lookup.form.formState.isSubmitting && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          )}
          {word('load')}
        </Button>
        <RefundFormAlert message={lookup.errors.root?.validation?.message} />
      </form>
      {status === 'loading' && <p role="status">{word('loading')}</p>}
      <RefundFormAlert
        message={
          status === 'error' ? word('error') : status === 'denied' ? word('forbidden') : undefined
        }
      />
      {invoice && !matches && (
        <RefundFormAlert message={contractText('refundLoadInvoice', locale)} />
      )}
      {invoice && (
        <>
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm">
              <p>
                {word('state')}: {appText(`invoices.state.${invoice.state}`, locale)}
              </p>
              {(['paid', 'refunded', 'reserved', 'available'] as const).map((key) => (
                <p key={key} className={key === 'available' ? 'font-semibold' : undefined}>
                  {word(key)}:{' '}
                  {numbers.money(
                    invoice[
                      key === 'paid'
                        ? 'paidAmount'
                        : key === 'refunded'
                          ? 'refundedAmount'
                          : key === 'reserved'
                            ? 'reservedAmount'
                            : 'availableAmount'
                    ]
                  )}
                </p>
              ))}
            </CardContent>
          </Card>
          {invoice.requestable ? (
            <form
              noValidate
              onSubmit={request}
              aria-busy={reviewBusy || draft.form.formState.isSubmitting || undefined}
              className="space-y-3"
            >
              <Field>
                <FieldLabel htmlFor={fieldPrefix + '-amount'}>{word('requestAmount')}</FieldLabel>
                <Input
                  id={fieldPrefix + '-amount'}
                  dir="ltr"
                  inputMode="numeric"
                  value={amount}
                  {...draft.bind('amount')}
                  disabled={unavailable}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <RefundFieldFeedback
                  id={draft.errorId('amount')}
                  error={draft.errors.amount}
                  message={contractText('refundAmountInvalid', locale)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={fieldPrefix + '-reason'}>{word('reason')}</FieldLabel>
                <Input
                  id={fieldPrefix + '-reason'}
                  maxLength={1000}
                  value={reason}
                  {...draft.bind('reason')}
                  disabled={unavailable}
                  onChange={(event) => setReason(event.target.value)}
                />
                <RefundFieldFeedback
                  id={draft.errorId('reason')}
                  error={draft.errors.reason}
                  message={contractText('cancellationReasonInvalid', locale)}
                />
              </Field>
              <RefundFormAlert
                message={
                  draft.errors.root?.validation?.message ??
                  (reviewError ? word(reviewError) : undefined)
                }
              />
              <Button type="submit" disabled={unavailable}>
                {draft.form.formState.isSubmitting && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {word('request')}
              </Button>
            </form>
          ) : (
            <p role="status">{word('notRequestable')}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">{word('requests')}</h3>
            <Button variant="outline" disabled={status === 'loading'} onClick={refresh}>
              {word('refresh')}
            </Button>
          </div>
          <RefundFormAlert message={decisionError ? word(decisionError) : undefined} />
          {!refunds.length && status === 'ready' && <p>{word('empty')}</p>}
          <ul className="space-y-3">
            {refunds.map((refund) => (
              <li key={refund.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{numbers.money(refund.amount)}</strong>
                  <StatusBadge label={word(`state.${refund.state}`)} />
                </div>
                <p className="break-all text-xs text-muted-foreground">{refund.id}</p>
                {destination === 'external_bank' && refund.bankReference && (
                  <p className="break-all text-sm">
                    {word('recordedReference')}: {refund.bankReference}
                  </p>
                )}
                {refund.approvalRequestId && (
                  <a
                    className="text-primary underline"
                    href={
                      '/admin/approval-requests?requestId=' +
                      encodeURIComponent(refund.approvalRequestId)
                    }
                  >
                    {word('approval')}
                  </a>
                )}
                <RefundDecisionControls
                  row={refund}
                  prefix={fieldPrefix}
                  word={word}
                  disabled={unavailable}
                  initial={cachedDrafts.current[refund.id] ?? { reason: '', bankReference: '' }}
                  saveDraft={(values) => {
                    cachedDrafts.current[refund.id] = values;
                  }}
                  onChoose={(operation, form) => decide(refund, operation, form)}
                />
                {destination === 'wallet' && refund.state === 'Failed' && (
                  <p role="status">
                    {refund.retry?.exhausted ? word('retryExhausted') : word('retryScheduled')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {nextBefore && (
            <Button
              variant="outline"
              disabled={status === 'loading' || status === 'error'}
              onClick={() => setBefore(nextBefore)}
            >
              {word('more')}
            </Button>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={summary}
          confirmationDisabled={status !== 'ready'}
          finalFocus={() => document.getElementById(fieldPrefix + '-amount')}
          onClose={() => {
            if (current.current === action) close();
          }}
          onDenied={() => {
            if (live.current && current.current === action) deny();
          }}
          onValidationError={(fields) =>
            live.current && current.current === action && !!actionTools.current?.apply(fields)
          }
          onSuccess={async (result) => {
            if (!live.current || current.current !== action) return;
            const tools = actionTools.current;
            if (!tools?.receipt(result)) throw new Error('Refund acknowledgement mismatch');
            tools.reset();
            close();
            refresh();
          }}
        />
      )}
    </section>
  );
}
