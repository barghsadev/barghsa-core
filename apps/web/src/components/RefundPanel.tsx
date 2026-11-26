import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { contractText } from '@barghsa/i18n/contracts';
import { refundEditorMessages } from '@barghsa/i18n/refund-editor';
import { formatToman } from '@barghsa/i18n/numbers';
import { confirmationText } from '@barghsa/i18n/confirmation';
import {
  LoadingStatus,
  Button,
  Input,
  ListRefreshButton,
  Field,
  FieldLabel,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { SettingsValueSkeleton } from './CatalogueEditorFeedback.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import {
  contractRefundOperation,
  refundOperations,
  type InvoiceRefundDecision,
} from '../lib/invoice-refund-route.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { requestRefundReview, RefundReviewError } from '../lib/refund-review.js';
import { validRefundReceipt } from '../lib/refund-receipt.js';
import { toast } from '../lib/toast-api.js';
import {
  useRefundLookupForm,
  useRefundRequestForm,
  type RefundDecisionValues,
  type RefundOperation,
} from '../hooks/useRefundForm.js';
import { RefundDecisionControls, type RefundDecisionDraft } from './RefundDecisionControls.js';
import { RefundFieldFeedback, RefundFormAlert } from './RefundFormFeedback.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';

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

type PanelProps = {
  destination: 'wallet' | 'external_bank';
  selectedInvoiceId?: string;
  recordView?: 'request' | 'history' | 'decision';
  decision?: InvoiceRefundDecision | undefined;
  fromContractRefunds?: boolean;
  renderDecisionLink?: (
    refundId: string,
    operation: RefundOperation,
    label: string,
    disabled: boolean
  ) => React.ReactNode;
  onLocked?: (locked: boolean) => void;
};
export function RefundPanel(props: PanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <RefundWorkspace
      key={JSON.stringify([actor, revision, props.destination, props.selectedInvoiceId])}
      {...props}
    />
  );
}
function RefundWorkspace({
  destination,
  selectedInvoiceId = '',
  recordView,
  decision,
  fromContractRefunds,
  renderDecisionLink,
  onLocked,
}: PanelProps) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const word = (key: string) =>
    t(
      `admin.invoices.${destination === 'external_bank' && externalKeys.has(key) ? 'externalRefunds' : 'walletRefunds'}.${key}`,
      locale
    );
  const decisionWord = (key: string) =>
    fromContractRefunds
      ? key === 'bankReference'
        ? contractText('cancellationBankReference', locale)
        : ['record-transfer', 'reconcile', 'process'].includes(key)
          ? contractText('cancellation.queue.' + key, locale)
          : word(key)
      : word(key);
  const path = destination === 'wallet' ? 'wallet-refunds' : 'external-refunds';
  const fieldPrefix = destination === 'wallet' ? 'wallet-refund' : 'external-refund';
  const editorText = refundEditorMessages[locale];
  const lookup = useRefundLookupForm(selectedInvoiceId, word('invalidInvoiceId'));
  const [input, setInput] = lookup.field('invoiceId');
  const [invoiceId, setInvoiceId] = useState(
    isInvoiceUuid(selectedInvoiceId.trim()) ? selectedInvoiceId.trim().toLowerCase() : ''
  );
  const [invoice, setInvoice] = useState<InvoiceBalance | null>(null);
  const [refunds, setRefunds] = useState<WalletRefund[]>([]);
  const [loadedTarget, setLoadedTarget] = useState<string>();
  const decisionId = decision?.refundId;
  const targetCurrent = loadedTarget === decisionId;
  const [before, setBefore] = useState<string | null>(null),
    [nextBefore, setNextBefore] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'denied'>('idle');
  const draft = useRefundRequestForm(invoice?.availableAmount ?? '0');
  const [amount, setAmount] = draft.field('amount'),
    [reason, setReason] = draft.field('reason');
  const cachedDrafts = useRef<Record<string, RefundDecisionValues>>({});
  const decisionKey = decision && decision.refundId + ':' + decision.operation;
  const [recordedDecision, setRecordedDecision] = useState<string>();
  const [action, setAction] = useState<TeamAction | null>(null),
    [summary, setSummary] = useState<React.ReactNode>(null),
    [reviewBusy, setReviewBusy] = useState(false);
  const [heldRequest, setHeldRequest] = useState<{
    action: TeamAction;
    summary: React.ReactNode;
  } | null>(null);
  const [reviewError, setReviewError] = useState<'conflict' | 'forbidden' | 'error' | null>(null),
    [decisionError, setDecisionError] = useState<
      'conflict' | 'forbidden' | 'error' | 'unconfirmed' | null
    >(null);
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
  const historyRows = useRef<WalletRefund[]>([]);
  const selection = useRef<{ invoice: InvoiceBalance; refund?: WalletRefund } | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const busy = reviewBusy || !!action;
  const locked = busy || !!heldRequest || Boolean(recordView && draft.form.formState.isSubmitting);
  useEffect(() => {
    onLocked?.(locked);
    return () => onLocked?.(false);
  }, [locked, onLocked]);
  useEffect(() => {
    setDecisionError(null);
    setRecordedDecision(undefined);
  }, [decisionKey]);
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
    setHeldRequest(null);
    readController.current?.abort();
    accepted.current = { invoice: null, refunds: [] };
    historyRows.current = [];
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
    const query = new URLSearchParams({ invoiceId });
    if (decisionId) query.set('refundId', decisionId);
    else if (before) query.set('before', before);
    void readWithDeadline(controller.signal, (signal) =>
      documentRequest<RefundPage>(`/api/admin/${path}?${query}`, { signal, cache: 'no-store' })
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        if (!validPage(page, invoiceId, destination)) throw new Error('Invalid refund page');
        if (
          decisionId &&
          (page.nextBefore !== null ||
            page.refunds.length > 1 ||
            page.refunds.some((row) => row.id !== decisionId))
        )
          throw new Error('Invalid refund target');
        const previous = historyRows.current;
        const rows =
          !decisionId && before
            ? [
                ...previous.map((row) => page.refunds.find((item) => item.id === row.id) ?? row),
                ...page.refunds.filter((row) => !previous.some((old) => old.id === row.id)),
              ]
            : page.refunds;
        historyRows.current = decisionId
          ? previous.flatMap((row) => (row.id === decisionId ? rows : [row]))
          : rows;
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
        setLoadedTarget(decisionId);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentRequestError && [401, 403, 404].includes(error.status)) {
          deny();
        } else {
          if (decisionId !== loadedTarget) {
            accepted.current = { invoice: null, refunds: [] };
            setInvoice(null);
            setRefunds([]);
          }
          setStatus('error');
        }
        setLoadedTarget(decisionId);
      });
    return () => controller.abort();
  }, [invoiceId, before, revision, destination, path, decisionId]);
  function refresh() {
    readController.current?.abort();
    setStatus('loading');
    if (!decisionId) setBefore(null);
    setRevision((value) => value + 1);
  }
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      heldRequest ||
      pending.current !== null ||
      current.current ||
      lookup.form.isSubmissionPending()
    )
      return;
    void lookup.form.handleSubmit((values) => {
      if (!live.current || pending.current !== null || current.current) return;
      const id = values.invoiceId.trim().toLowerCase();
      if (id !== invoiceId) {
        close();
        setDecisionError(null);
        accepted.current = { invoice: null, refunds: [] };
        historyRows.current = [];
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
      heldRequest ||
      statusRef.current !== 'ready' ||
      !targetCurrent ||
      !accepted.current.invoice ||
      (refund && !accepted.current.refunds.includes(refund)) ||
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
            receipt: (result, replay) =>
              validRefundReceipt(
                result,
                { invoiceId: command.invoiceId, destination, amount: command.amount },
                replay
                  ? [
                      'Requested',
                      'Approved',
                      'Processing',
                      'Completed',
                      'Failed',
                      'Rejected',
                      'Cancelled',
                    ]
                  : ['Requested', 'Approved']
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
    receipt: (result: unknown, replay: boolean) => boolean;
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
            risk: operation === 'reject' ? 'both' : 'financial',
            title: decisionWord(operation),
            description: fromContractRefunds
              ? contractText(
                  operation === 'reconcile'
                    ? 'cancellationQueueReconcileNotice'
                    : 'cancellationQueueRetryNotice',
                  locale
                )
              : word('confirmDecision'),
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
              delete cachedDrafts.current[decision ? refund.id + ':' + operation : refund.id];
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
  const visibleStatus = targetCurrent ? status : 'loading';
  const unavailable = visibleStatus !== 'ready' || busy || !matches || !!heldRequest;
  const requestView = recordView === 'request';
  const focusedRefund =
    decision && targetCurrent && refunds.find((refund) => refund.id === decision.refundId);
  const queueOperation =
    focusedRefund && fromContractRefunds
      ? contractRefundOperation(focusedRefund, focusedRefund.retry?.exhausted)
      : undefined;
  const decisionOperations = focusedRefund
    ? fromContractRefunds
      ? queueOperation
        ? [queueOperation]
        : []
      : refundOperations(focusedRefund)
    : [];
  const decisionDraftKey = decision ? decision.refundId + ':' + decision.operation : '';
  const showReferenceInForm =
    decision?.operation === 'reconcile' && decisionOperations.includes('reconcile');
  const decisionMessage =
    decisionError === 'unconfirmed'
      ? confirmationText('unconfirmed', locale)
      : decisionError
        ? word(decisionError)
        : undefined;
  const amountField = draft.bind('amount');
  const reasonField = draft.bind('reason');
  const amountId = fieldPrefix + '-amount';
  const normalizedAmount = normalizeProfileDigits(amount);
  const equivalent =
    requestView && /^\d{1,19}$/.test(normalizedAmount) && BigInt(normalizedAmount) > 0n
      ? editorText.tomanEquivalent.replace(
          '{amount}',
          formatToman(normalizedAmount, locale, { numberStyle: numbers.numberStyle })
        )
      : null;
  const ReasonInput = requestView ? Textarea : Input;
  return (
    <section
      id={destination === 'wallet' ? 'wallet-refunds-panel' : 'external-refunds-panel'}
      className={recordEditorSurface}
      aria-label={word('title')}
    >
      <div className="min-w-0 space-y-2.5 border-b px-4 py-4 sm:px-6">
        {!recordView && (
          <header className="space-y-1">
            <h2 className="text-base font-semibold">{word('title')}</h2>
            <p className="text-sm text-muted-foreground">{word('description')}</p>
          </header>
        )}
        {requestView && (
          <p className="text-sm text-muted-foreground">
            {t(
              destination === 'wallet'
                ? 'admin.invoices.refunds.walletDestination'
                : 'admin.invoices.refunds.bankDestination',
              locale
            )}
          </p>
        )}
        {recordView === 'history' && (
          <p className="text-sm text-muted-foreground">{word('description')}</p>
        )}
        {!recordView && (
          <form
            onSubmit={load}
            noValidate
            aria-busy={lookup.form.formState.isSubmitting || undefined}
            className="space-y-2"
          >
            <Field className="min-w-0 gap-1">
              <FieldLabel htmlFor={fieldPrefix + '-invoice'}>{word('invoiceId')}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id={fieldPrefix + '-invoice'}
                  dir="ltr"
                  value={input}
                  {...lookup.bind('invoiceId')}
                  disabled={busy || !!heldRequest || lookup.form.formState.isSubmitting}
                  onChange={(event) => setInput(event.target.value)}
                />
                <Button
                  type="submit"
                  disabled={busy || !!heldRequest || lookup.form.formState.isSubmitting}
                >
                  {lookup.form.formState.isSubmitting && (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                    />
                  )}
                  {word('load')}
                </Button>
              </div>
              <RefundFieldFeedback
                id={lookup.errorId('invoiceId')}
                error={lookup.errors.invoiceId}
                message={word('invalidInvoiceId')}
              />
            </Field>
            <RefundFormAlert message={lookup.errors.root?.validation?.message} />
          </form>
        )}
        {visibleStatus === 'loading' &&
          (invoice ? (
            <LoadingStatus>{word('loading')}</LoadingStatus>
          ) : (
            <SettingsValueSkeleton label={word('loading')} count={decision ? 1 : 2} />
          ))}
        <RefundFormAlert
          message={
            visibleStatus === 'error'
              ? word('error')
              : visibleStatus === 'denied'
                ? word('forbidden')
                : undefined
          }
        />
        {visibleStatus === 'error' &&
          (requestView ||
            (recordView === 'history' && !invoice) ||
            (decision && !focusedRefund)) && (
            <Button type="button" variant="outline" disabled={busy} onClick={refresh}>
              {word('refresh')}
            </Button>
          )}
        {targetCurrent && invoice && !matches && (
          <RefundFormAlert message={contractText('refundLoadInvoice', locale)} />
        )}
        {!decision && targetCurrent && invoice && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="text-muted-foreground">{word('available')}</dt>
              <dd className="min-w-0 break-words text-lg font-semibold tabular-nums">
                {numbers.money(invoice.availableAmount)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-muted-foreground">{word('state')}</dt>
              <dd>{appText(`invoices.state.${invoice.state}`, locale)}</dd>
            </div>
            {(['paid', 'refunded', 'reserved'] as const).map((key) => (
              <div key={key} className="min-w-0">
                <dt className="text-muted-foreground">{word(key)}</dt>
                <dd className="break-words tabular-nums">
                  {numbers.money(invoice[`${key}Amount`])}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {decision && focusedRefund && (
          <div className="space-y-2">
            <div className="rounded-lg bg-muted/40 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <dl className="min-w-0">
                  <dt className="text-sm text-muted-foreground">{editorText.refundAmount}</dt>
                  <dd className="break-words text-lg font-semibold tabular-nums">
                    {numbers.money(focusedRefund.amount)}
                  </dd>
                </dl>
                <div className="flex items-center gap-2">
                  <StatusBadge label={word(`state.${focusedRefund.state}`)} />
                  <ListRefreshButton
                    label={word('refresh')}
                    refreshing={visibleStatus === 'loading'}
                    onClick={refresh}
                  />
                </div>
              </div>
              {focusedRefund.bankReference && !showReferenceInForm && (
                <dl className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 border-t pt-2">
                  <dt className="text-sm text-muted-foreground">{word('recordedReference')}</dt>
                  <dd className="break-all text-sm font-medium" dir="auto">
                    {focusedRefund.bankReference}
                  </dd>
                </dl>
              )}
            </div>
            <RefundFormAlert message={decisionMessage} />
          </div>
        )}
        {decision &&
          visibleStatus === 'ready' &&
          !decisionOperations.includes(decision.operation) && (
            <div className="space-y-2">
              <p role="status" className="text-sm text-muted-foreground">
                {recordedDecision === decisionKey
                  ? contractText('refundUpdateRecorded', locale)
                  : editorText.decisionUnavailable}
              </p>
              {focusedRefund && renderDecisionLink && (
                <div className="flex flex-wrap gap-2">
                  {decisionOperations.map((operation) =>
                    renderDecisionLink(
                      focusedRefund.id,
                      operation,
                      decisionWord(operation),
                      unavailable
                    )
                  )}
                </div>
              )}
            </div>
          )}
      </div>
      {decision && focusedRefund && decisionOperations.includes(decision.operation) && (
        <RefundDecisionControls
          key={decisionDraftKey}
          row={focusedRefund}
          operation={decision.operation}
          prefix={fieldPrefix}
          word={decisionWord}
          disabled={unavailable}
          initial={cachedDrafts.current[decisionDraftKey] ?? { reason: '', bankReference: '' }}
          saveDraft={(values) => {
            cachedDrafts.current[decisionDraftKey] = values;
          }}
          onChoose={(operation, form) => decide(focusedRefund, operation, form)}
        />
      )}
      {!decision && targetCurrent && invoice && (
        <>
          {heldRequest && !action && (
            <div className="space-y-2 px-4 py-3 sm:px-6">
              <RefundFormAlert message={confirmationText('unconfirmed', locale)} />
              <Button
                type="button"
                variant="outline"
                disabled={status !== 'ready' || !matches || busy}
                onClick={() => {
                  if (current.current) return;
                  const captured = { ...heldRequest.action };
                  current.current = captured;
                  setAction(captured);
                  setSummary(heldRequest.summary);
                }}
              >
                {word('retryRequest')}
              </Button>
            </div>
          )}
          {recordView !== 'history' &&
            (invoice.requestable ? (
              <form
                noValidate
                onSubmit={request}
                aria-busy={reviewBusy || draft.form.formState.isSubmitting || undefined}
              >
                <RecordEditorSection title={refundEditorMessages[locale].requestDetails}>
                  <div className={requestView ? 'min-w-0 space-y-3' : recordEditorGrid}>
                    <Field className={requestView ? 'min-w-0 gap-1 sm:max-w-sm' : 'min-w-0 gap-1'}>
                      <div className="flex flex-wrap items-center justify-between gap-x-2">
                        <FieldLabel htmlFor={amountId}>
                          {word('requestAmount')}{' '}
                          <span className="font-normal text-muted-foreground">
                            ({editorText.amountUnit})
                          </span>
                        </FieldLabel>
                        {requestView && invoice.availableAmount !== '0' && (
                          <Button
                            type="button"
                            variant="link"
                            className="px-0"
                            disabled={unavailable}
                            onClick={() => setAmount(invoice.availableAmount)}
                          >
                            {editorText.useAvailable}
                          </Button>
                        )}
                      </div>
                      <Input
                        id={amountId}
                        dir="ltr"
                        inputMode="numeric"
                        value={amount}
                        {...amountField}
                        aria-describedby={
                          equivalent
                            ? [amountId + '-equivalent', amountField['aria-describedby']]
                                .filter(Boolean)
                                .join(' ')
                            : amountField['aria-describedby']
                        }
                        disabled={unavailable}
                        onChange={(event) => setAmount(event.target.value)}
                      />
                      {equivalent && (
                        <p
                          id={amountId + '-equivalent'}
                          className="break-words text-sm tabular-nums text-muted-foreground"
                        >
                          {equivalent}
                        </p>
                      )}
                      <RefundFieldFeedback
                        id={draft.errorId('amount')}
                        error={draft.errors.amount}
                        message={contractText('refundAmountInvalid', locale)}
                        reserveSpace={!requestView}
                      />
                    </Field>
                    <Field className="min-w-0 gap-1">
                      <FieldLabel htmlFor={fieldPrefix + '-reason'}>{word('reason')}</FieldLabel>
                      {requestView && (
                        <p
                          id={fieldPrefix + '-reason-help'}
                          className="text-sm text-muted-foreground"
                        >
                          {editorText.reasonHelp}
                        </p>
                      )}
                      <ReasonInput
                        id={fieldPrefix + '-reason'}
                        maxLength={1000}
                        rows={requestView ? 2 : undefined}
                        dir={requestView ? 'auto' : undefined}
                        className={
                          requestView
                            ? `min-h-12 ${locale === 'fa' ? 'placeholder:text-right' : ''}`
                            : undefined
                        }
                        placeholder={editorText.reasonExample}
                        value={reason}
                        {...reasonField}
                        aria-describedby={
                          requestView
                            ? [fieldPrefix + '-reason-help', reasonField['aria-describedby']]
                                .filter(Boolean)
                                .join(' ')
                            : reasonField['aria-describedby']
                        }
                        disabled={unavailable}
                        onChange={(event) => setReason(event.target.value)}
                      />
                      <RefundFieldFeedback
                        id={draft.errorId('reason')}
                        error={draft.errors.reason}
                        message={contractText('cancellationReasonInvalid', locale)}
                        reserveSpace={!requestView}
                      />
                    </Field>
                  </div>
                  <RefundFormAlert
                    message={
                      draft.errors.root?.validation?.message ??
                      (reviewError ? word(reviewError) : undefined)
                    }
                  />
                </RecordEditorSection>
                <RecordEditorActions>
                  <Button type="submit" disabled={unavailable}>
                    {draft.form.formState.isSubmitting && (
                      <span
                        aria-hidden="true"
                        className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {word('request')}
                  </Button>
                </RecordEditorActions>
              </form>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground sm:px-6" role="status">
                {word('notRequestable')}
              </p>
            ))}
          {recordView !== 'request' && (
            <div className="space-y-2.5 px-4 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">{word('requests')}</h3>
                <ListRefreshButton
                  label={word('refresh')}
                  refreshing={status === 'loading'}
                  onClick={refresh}
                />
              </div>
              <RefundFormAlert message={decisionMessage} />
              {!refunds.length && status === 'ready' && (
                <p className="text-sm text-muted-foreground">{word('empty')}</p>
              )}
              <ul className="grid gap-3">
                {refunds.map((refund) => (
                  <li key={refund.id} className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-lg tabular-nums">
                        {numbers.money(refund.amount)}
                      </strong>
                      <StatusBadge label={word(`state.${refund.state}`)} />
                    </div>
                    <p className="break-all border-t pt-2 font-mono text-xs text-muted-foreground">
                      <bdi>{refund.id}</bdi>
                    </p>
                    {destination === 'external_bank' && refund.bankReference && (
                      <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">{word('recordedReference')}</dt>
                        <dd className="break-all font-medium">
                          <bdi>{refund.bankReference}</bdi>
                        </dd>
                      </dl>
                    )}
                    {refund.approvalRequestId && (
                      <a
                        className="text-primary underline"
                        href={
                          '/admin/approval-requests/' + encodeURIComponent(refund.approvalRequestId)
                        }
                      >
                        {word('approval')}
                      </a>
                    )}
                    {renderDecisionLink ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {refundOperations(refund).map((operation) =>
                          renderDecisionLink(refund.id, operation, word(operation), unavailable)
                        )}
                      </div>
                    ) : (
                      <RefundDecisionControls
                        row={refund}
                        prefix={fieldPrefix}
                        word={word}
                        disabled={unavailable}
                        initial={
                          cachedDrafts.current[refund.id] ?? { reason: '', bankReference: '' }
                        }
                        saveDraft={(values) => {
                          cachedDrafts.current[refund.id] = values;
                        }}
                        onChoose={(operation, form) => decide(refund, operation, form)}
                      />
                    )}
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
            </div>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          risk="financial"
          action={action}
          summary={
            <>
              {heldRequest && <p>{confirmationText('unconfirmed', locale)}</p>}
              {summary}
            </>
          }
          confirmationDisabled={status !== 'ready'}
          finalFocus={() =>
            decision
              ? document.querySelector<HTMLElement>('[data-refund-decision-submit]')
              : document.getElementById(fieldPrefix + '-amount')
          }
          onClose={() => {
            if (current.current === action) close();
          }}
          onDenied={() => {
            if (live.current && current.current === action) deny();
          }}
          onUnconfirmed={() => {
            if (!live.current || current.current !== action) return;
            if (!selection.current?.refund) {
              setHeldRequest({ action, summary });
              return;
            }
            close();
            setDecisionError('unconfirmed');
            refresh();
          }}
          onValidationError={(fields) =>
            live.current && current.current === action && !!actionTools.current?.apply(fields)
          }
          onSuccess={async (result) => {
            if (!live.current || current.current !== action) return;
            const tools = actionTools.current;
            if (!tools?.receipt(result, !!heldRequest))
              throw new Error('Refund acknowledgement mismatch');
            toast.success(contractText('refundUpdateRecorded', locale));
            if (decisionKey) setRecordedDecision(decisionKey);
            setHeldRequest(null);
            tools.reset();
            close();
            refresh();
          }}
        />
      )}
    </section>
  );
}
