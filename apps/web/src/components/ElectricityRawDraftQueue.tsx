import { Ban as TableBanIcon, X as TableXIcon } from 'lucide-react';
import { TableActionIcon } from './TableActionIcon.js';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { electricityDraftDecisionText } from '@barghsa/i18n/electricity-draft-decision';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import {
  Alert,
  AlertDescription,
  Button,
  DateCell,
  FinancialReviewSummary,
  Label,
  ListRefreshButton,
  Textarea,
  TextCell,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { OperationalQueueTable } from './OperationalQueueTable.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { existingDraftReturns } from '../lib/electricity-existing-returns.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
interface Draft {
  id: string;
  profileId: string;
  mode: 'simple' | 'advanced';
  createdAt: string;
  updatedAt: string;
}
type DraftReview = { row: Draft; action: 'reject' | 'cancel' };
type DraftAction = TeamAction & {
  reviewNumber: number;
  draft: Draft;
  reason: string;
  gift: ReturnType<typeof giftOutcome>;
  financial: ReturnType<typeof financialOutcome>;
  stage: 'approval' | 'execute';
  hash: string;
  target: 'rejected' | 'cancelled';
  body: {
    action: DraftReview['action'];
    reason: string;
    expectedReviewHash: string;
    idempotencyKey: string;
    approvalRequestId?: string;
  };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function giftOutcome(value: unknown, paid = false) {
  if (value === undefined || value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    !('giftCodeId' in value) ||
    typeof value.giftCodeId !== 'string' ||
    !uuid.test(value.giftCodeId) ||
    !('redemptionId' in value) ||
    typeof value.redemptionId !== 'string' ||
    !uuid.test(value.redemptionId) ||
    !('status' in value) ||
    !['consumed', 'released'].includes(String(value.status)) ||
    !('restoreOnCancel' in value) ||
    typeof value.restoreOnCancel !== 'boolean' ||
    (paid &&
      (!('restoreAfterPayment' in value) || typeof value.restoreAfterPayment !== 'boolean')) ||
    !('outcome' in value) ||
    value.outcome !==
      (value.status === 'released'
        ? 'already_released'
        : value.restoreOnCancel &&
            (!paid || ('restoreAfterPayment' in value && value.restoreAfterPayment))
          ? 'release'
          : 'retain')
  )
    throw new Error('Unbound draft gift outcome');
  return { id: value.giftCodeId, outcome: String(value.outcome) };
}
function financialOutcome(data: object) {
  const amount = 'refundAmount' in data ? data.refundAmount : null;
  if (
    typeof amount !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(amount) ||
    BigInt(amount) > 9223372036854775807n
  )
    throw new Error('Invalid draft return');
  const raw = 'invoices' in data ? data.invoices : [];
  if (!Array.isArray(raw)) throw new Error('Invalid draft invoices');
  const invoices = raw.map((line: unknown) => {
    if (
      !line ||
      typeof line !== 'object' ||
      !('id' in line) ||
      typeof line.id !== 'string' ||
      !uuid.test(line.id) ||
      !('refundableAmount' in line) ||
      typeof line.refundableAmount !== 'string' ||
      !/^(0|[1-9][0-9]{0,18})$/.test(line.refundableAmount) ||
      BigInt(line.refundableAmount) > 9223372036854775807n
    )
      throw new Error('Invalid draft invoice');
    return { id: line.id, amount: line.refundableAmount };
  });
  if (
    new Set(invoices.map((i) => i.id)).size !== invoices.length ||
    invoices.reduce((sum, i) => sum + BigInt(i.amount), 0n).toString() !== amount
  )
    throw new Error('Unbound draft return');
  const required = 'approvalRequired' in data ? data.approvalRequired : false;
  if (typeof required !== 'boolean') throw new Error('Invalid draft approval');
  const existing = existingDraftReturns(
    'existingReturns' in data ? data.existingReturns : undefined
  );
  if (
    new Set(existing.map((r) => r.invoiceId)).size !== existing.length ||
    existing.some((r) => !invoices.some((i) => i.id === r.invoiceId && i.amount === r.amount))
  )
    throw new Error('Unbound adopted draft return');
  return { amount, invoices, required, existing };
}
function approvalOutcome(raw: object) {
  const value = 'approval' in raw ? raw.approval : null;
  if (value === null || value === undefined) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    !('status' in value) ||
    !['pending', 'approved', 'rejected', 'cancelled'].includes(String(value.status))
  )
    throw new Error('Unbound draft approval');
  return { id: value.id, status: String(value.status) };
}
function queue(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('drafts' in value) ||
    !Array.isArray(value.drafts) ||
    !('nextAfter' in value) ||
    (value.nextAfter !== null &&
      (typeof value.nextAfter !== 'string' || !uuid.test(value.nextAfter)))
  )
    throw new Error('Invalid draft queue');
  const drafts = value.drafts.map((row: unknown): Draft => {
    if (
      !row ||
      typeof row !== 'object' ||
      !('orderId' in row) ||
      typeof row.orderId !== 'string' ||
      !uuid.test(row.orderId) ||
      !('profileId' in row) ||
      typeof row.profileId !== 'string' ||
      !uuid.test(row.profileId) ||
      !('mode' in row) ||
      (row.mode !== 'simple' && row.mode !== 'advanced') ||
      !('createdAt' in row) ||
      typeof row.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(row.createdAt)) ||
      !('updatedAt' in row) ||
      typeof row.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.updatedAt))
    )
      throw new Error('Invalid draft');
    return {
      id: row.orderId,
      profileId: row.profileId,
      mode: row.mode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
  return { drafts, nextAfter: value.nextAfter };
}
function DraftReferences({ draft, copy }: { draft: Draft; copy: (key: string) => string }) {
  return (
    <dl className="grid min-w-0 gap-2.5 rounded-lg border bg-muted/25 px-3 py-2.5 text-sm sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-muted-foreground">{copy('order')}</dt>
        <dd className="wrap-anywhere">
          <bdi dir="ltr">{draft.id}</bdi>
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{copy('profile')}</dt>
        <dd className="wrap-anywhere">
          <bdi dir="ltr">{draft.profileId}</bdi>
        </dd>
      </div>
    </dl>
  );
}

function DraftDecisionReview({ action, recovery }: { action: DraftAction; recovery: ReactNode }) {
  const locale = useLocale();
  const copy = (key: string) => t('electricity.rawDraft.' + key, locale);
  const numbers = useNumberFormatting(locale);
  const { financial, gift } = action;
  const approval = action.body.approvalRequestId
    ? electricityDraftDecisionText('approvalRecorded', locale)
    : copy(financial.required ? 'approvalRequired' : 'approvalNotRequired');
  return (
    <div className="min-w-0 space-y-3">
      {recovery}
      {financial.invoices.length ? (
        <FinancialReviewSummary
          compact
          title={electricityDraftDecisionText('financialReview', locale)}
          rows={financial.invoices.map((invoice) => ({
            id: invoice.id,
            label: copy('invoice'),
            value: (
              <span className="inline-flex flex-wrap justify-end gap-x-2 gap-y-1">
                <span className="min-w-0 wrap-anywhere" dir="ltr">
                  {invoice.id}
                </span>
                <span>{numbers.money(invoice.amount)}</span>
              </span>
            ),
          }))}
          total={{ label: copy('walletReturn'), value: numbers.money(financial.amount) }}
          notice={approval}
        />
      ) : (
        <p className="rounded-lg border bg-muted/25 px-3 py-2.5 text-sm font-medium">
          {electricityDraftDecisionText('noWalletReturn', locale)}
        </p>
      )}
      {financial.existing.map((refund) => (
        <section key={refund.id} className="space-y-1.5 rounded-lg border px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">{copy('existingReturn')}</h3>
            <span className="rounded-md bg-muted px-2 py-1 text-xs">
              {t('invoices.activity.state.' + refund.state, locale)}
            </span>
          </div>
          <p className="wrap-anywhere text-muted-foreground">
            <bdi dir="ltr">{refund.id}</bdi>
          </p>
          <p>{copy(refund.exhausted ? 'manualRetryRequired' : 'retryPreserved')}</p>
        </section>
      ))}
      <DraftReferences draft={action.draft} copy={copy} />
      <dl className="grid gap-3 text-sm">
        <div className="rounded-lg border px-3 py-2.5">
          <dt className="text-muted-foreground">{copy('reason')}</dt>
          <dd className="whitespace-pre-wrap wrap-anywhere">{action.reason}</dd>
        </div>
        {gift && (
          <div className="rounded-lg border px-3 py-2.5">
            <dt className="text-muted-foreground">{copy('gift')}</dt>
            <dd>{copy('gift.' + gift.outcome)}</dd>
            <dd className="wrap-anywhere text-muted-foreground">
              <bdi dir="ltr">{gift.id}</bdi>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Queue() {
  const read = useStaffQueryRead('orders');
  const locale = useLocale(),
    copy = (key: string) => t('electricity.rawDraft.' + key, locale);
  const time = useAccountTime(locale);
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Draft[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [listFailed, setListFailed] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<DraftReview | null>(null),
    [reason, setReason] = useState(''),
    [action, setAction] = useState<DraftAction | null>(null),
    [recovery, setRecovery] = useState<DraftAction | null>(null),
    [busy, setBusy] = useState(false),
    [invalid, setInvalid] = useState(false);
  const live = useRef(true),
    previewRequest = useRef<AbortController | null>(null),
    reviewNumber = useRef(0),
    reasonInput = useRef<HTMLTextAreaElement>(null),
    rowAction = useRef<HTMLButtonElement | null>(null),
    reviewButton = useRef<HTMLButtonElement>(null);
  const scope = JSON.stringify([after, revision, locale]);
  const [accepted, setAccepted] = useState<string | null>(null);
  const canUseRows = accepted === scope && !loading && !listFailed;
  useEffect(() => {
    if (selected) reasonInput.current?.focus();
  }, [selected]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      previewRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setListFailed(false);
    void read(
      '/api/staff/electricity/orders/drafts' + (after ? '?after=' + encodeURIComponent(after) : ''),
      'list',
      abort.signal,
      async (response) => queue(await staffQueryJson(response)),
      revision
    )
      .then((data) => {
        if (!abort.signal.aborted) {
          setRows(data.drafts);
          setNext(data.nextAfter);
          setAccepted(scope);
        }
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return;
        setListFailed(true);
        if (failure instanceof ServerQueryError && [401, 403].includes(failure.status)) {
          deny();
        } else setError(copy('failed'));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, after, revision, locale, read, scope]);
  const reload = () => {
    setError('');
    setAfter(null);
    setRevision((v) => v + 1);
  };
  function deny() {
    previewRequest.current?.abort();
    setRows([]);
    setNext(null);
    setAccepted(null);
    setAction(null);
    setRecovery(null);
    setSelected(null);
    setReason('');
    setError(copy('denied'));
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (!selected || recovery || action || !canUseRows) return;
    const explanation = reason.trim();
    if (!explanation || explanation.length > 1000) {
      setInvalid(true);
      reasonInput.current?.focus();
      return;
    }
    void reviewDraft(selected, explanation);
  }
  async function reviewDraft(owned: DraftReview, explanation: string, captured?: DraftAction) {
    if (previewRequest.current) return;
    const controller = new AbortController();
    previewRequest.current = controller;
    setBusy(true);
    setError('');
    try {
      const path = '/api/staff/electricity/orders/' + owned.row.id + '/draft-terminal';
      const { status, raw } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(path + '/review', {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: owned.action, reason: explanation }),
          signal,
        });
        return {
          status: response.status,
          raw: response.ok ? ((await response.json()) as unknown) : null,
        };
      });
      if (!live.current || controller.signal.aborted) return;
      if (status === 401 || status === 403) {
        deny();
        return;
      }
      if (captured && (status === 404 || status === 409)) {
        setAction(null);
        setRecovery(null);
        setSelected(null);
        setReason('');
        reload();
        setError(copy('changed'));
        return;
      }
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('hash' in raw) ||
        typeof raw.hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(raw.hash) ||
        !('scope' in raw) ||
        !raw.scope ||
        typeof raw.scope !== 'object' ||
        !('resourceId' in raw.scope) ||
        raw.scope.resourceId !== owned.row.id ||
        !('profileId' in raw.scope) ||
        raw.scope.profileId !== owned.row.profileId ||
        !('action' in raw.scope) ||
        raw.scope.action !== 'electricity.draft-terminal.' + owned.action ||
        !('data' in raw) ||
        !raw.data ||
        typeof raw.data !== 'object' ||
        !('action' in raw.data) ||
        raw.data.action !== owned.action ||
        !('reason' in raw.data) ||
        raw.data.reason !== explanation ||
        !('fromState' in raw.data) ||
        raw.data.fromState !== 'draft' ||
        !('toState' in raw.data) ||
        raw.data.toState !== (owned.action === 'reject' ? 'rejected' : 'cancelled') ||
        !('mode' in raw.data) ||
        raw.data.mode !== owned.row.mode ||
        !('collectsPayment' in raw.data) ||
        raw.data.collectsPayment !== false ||
        !('stateFingerprint' in raw.data) ||
        typeof raw.data.stateFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(raw.data.stateFingerprint) ||
        !('refundAmount' in raw.data) ||
        !('createsContract' in raw.data) ||
        raw.data.createsContract !== false ||
        !('createsInvoice' in raw.data) ||
        raw.data.createsInvoice !== false ||
        !('changesSavedWizardProgress' in raw.data) ||
        raw.data.changesSavedWizardProgress !== false
      )
        throw new Error('Unbound draft review');
      const financial = financialOutcome(raw.data),
        approval = approvalOutcome(raw),
        stage = financial.required && approval?.status !== 'approved' ? 'approval' : 'execute';
      if (financial.required && approval?.status === 'pending') {
        setRecovery(null);
        setAction(null);
        setError(copy('awaitingApproval'));
        return;
      }
      const gift = giftOutcome(
        'gift' in raw.data ? raw.data.gift : null,
        'paidOrder' in raw.data && raw.data.paidOrder === true
      );
      const approvalRequestId =
        financial.required && approval?.status === 'approved' ? approval.id : undefined;
      const retryKey =
        captured?.hash === raw.hash &&
        captured.stage === stage &&
        captured.body.approvalRequestId === approvalRequestId
          ? captured.body.idempotencyKey
          : undefined;
      setRecovery(null);
      setAction({
        reviewNumber: ++reviewNumber.current,
        draft: owned.row,
        reason: explanation,
        gift,
        financial,
        stage,
        hash: raw.hash,
        target: owned.action === 'reject' ? 'rejected' : 'cancelled',
        risk: 'both',
        title: copy(stage === 'approval' ? 'requestApproval' : owned.action),
        description: copy(stage === 'approval' ? 'approvalSummary' : 'summary'),
        path: path + (stage === 'approval' ? '/approval' : ''),
        method: 'POST',
        successStatus: stage === 'approval' ? 201 : 200,
        body: {
          action: owned.action,
          reason: explanation,
          expectedReviewHash: raw.hash,
          idempotencyKey: retryKey ?? crypto.randomUUID(),
          ...(approvalRequestId ? { approvalRequestId } : {}),
        },
        conflictMessage: copy('changed'),
        forbiddenMessage: copy('denied'),
      });
    } catch {
      if (live.current && !controller.signal.aborted) setError(copy('failed'));
    } finally {
      if (previewRequest.current === controller) {
        previewRequest.current = null;
        if (live.current) setBusy(false);
      }
    }
  }
  const recoveryButton = recovery && (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={() =>
        void reviewDraft(
          { row: recovery.draft, action: recovery.body.action },
          recovery.reason,
          recovery
        )
      }
    >
      {copy('retry')}
    </Button>
  );
  const recoveryHelp = recovery && (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-muted/25 px-3 py-2.5">
      <p className="text-sm">{electricityDraftDecisionText('recoveryHelp', locale)}</p>
      {recoveryButton}
      {error && action && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <details
      className="rounded-xl border bg-card px-4 py-2.5 sm:px-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (nextOpen === open) return;
        if (nextOpen) setAccepted(null);
        else previewRequest.current?.abort();
        setOpen(nextOpen);
      }}
    >
      <summary className="min-h-11 min-w-11 cursor-pointer content-center font-medium">
        {copy('title')}
      </summary>
      {open ? (
        <div className="space-y-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{copy('description')}</p>
            {!recovery && (
              <ListRefreshButton
                label={copy('retry')}
                disabled={loading || busy || !!action}
                onClick={reload}
              />
            )}
          </div>
          {error && (!selected || (recovery && !action)) ? <p role="alert">{error}</p> : null}
          {recovery && !action && (
            <div className="space-y-2">
              <p role="alert">{confirmationText('unconfirmed', locale)}</p>
              {recoveryHelp}
            </div>
          )}
          <OperationalQueueTable
            locale={locale}
            rows={rows}
            caption={copy('title')}
            scrollLabel={copy('title')}
            nameHeader={copy('order')}
            renderName={(row) => <TextCell value={row.id} />}
            fields={[
              {
                id: 'profile',
                label: copy('profile'),
                render: (row) => <TextCell value={row.profileId} />,
              },
              {
                id: 'mode',
                label: copy('mode'),
                render: (row) => <TextCell value={copy(row.mode)} />,
              },
              {
                id: 'created',
                label: copy('created'),
                render: (row) => (
                  <DateCell value={row.createdAt} format={(value) => time.format(value)} />
                ),
              },
            ]}
            actionHeader={copy('actions')}
            renderActions={(row) => (
              <div className="flex flex-wrap gap-2">
                {(['reject', 'cancel'] as const).map((choice) => (
                  <Button
                    key={choice}
                    size="sm"
                    variant="outline"
                    disabled={busy || !!action || !!recovery || !canUseRows}
                    onClick={(event) => {
                      rowAction.current = event.currentTarget;
                      setSelected({ row, action: choice });
                      setReason('');
                      setInvalid(false);
                      setError('');
                    }}
                    aria-expanded={selected?.row.id === row.id && selected.action === choice}
                    data-table-action-tooltip={copy(choice)}
                  >
                    <TableActionIcon icon={choice === 'reject' ? TableBanIcon : TableXIcon}>
                      {copy(choice)}
                    </TableActionIcon>
                  </Button>
                ))}
              </div>
            )}
            loading={loading}
            emptyMessage={copy('empty')}
            tableClassName="min-w-[36rem]"
          />
          {next ? (
            <Button
              variant="outline"
              disabled={busy || !!action || !!recovery || !canUseRows}
              onClick={() => {
                setSelected(null);
                setReason('');
                setError('');
                setAfter(next);
              }}
            >
              {copy('next')}
            </Button>
          ) : null}
          {selected ? (
            <form
              onSubmit={review}
              noValidate
              className={recordEditorSurface}
              aria-labelledby="raw-draft-decision-heading"
            >
              <div className="flex items-center justify-between gap-2 border-b bg-muted/25 px-4 py-2 sm:px-6">
                <h3 id="raw-draft-decision-heading" className="text-base font-semibold">
                  {copy(selected.action)}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={electricityDraftDecisionText('dismissDecision', locale)}
                  disabled={busy || !!action || !!recovery}
                  onClick={() => {
                    setSelected(null);
                    setReason('');
                    setInvalid(false);
                    if (!listFailed) setError('');
                    rowAction.current?.focus();
                  }}
                >
                  <TableXIcon aria-hidden="true" />
                </Button>
              </div>
              <div className="space-y-3 px-4 py-3.5 sm:px-6">
                <DraftReferences draft={selected.row} copy={copy} />
                {error && !action && !recovery && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-1">
                  <Label htmlFor="raw-electricity-draft-reason">{copy('reason')}</Label>
                  <Textarea
                    id="raw-electricity-draft-reason"
                    ref={reasonInput}
                    rows={2}
                    className="min-h-16 scroll-mt-32"
                    placeholder={electricityDraftDecisionText('reasonExample', locale)}
                    value={reason}
                    maxLength={1000}
                    required
                    aria-required="true"
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? 'raw-draft-reason-error' : 'raw-draft-reason-help'}
                    disabled={busy || !!action || !!recovery}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setInvalid(false);
                    }}
                  />
                  {invalid ? (
                    <p
                      id="raw-draft-reason-error"
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {copy('reasonInvalid')}
                    </p>
                  ) : (
                    <p id="raw-draft-reason-help" className="text-sm text-muted-foreground">
                      {electricityDraftDecisionText('reasonHelp', locale)}
                    </p>
                  )}
                </div>
              </div>
              <RecordEditorActions>
                <Button
                  ref={reviewButton}
                  type="submit"
                  loading={busy && !action}
                  disabled={busy || !!action || !!recovery || !canUseRows}
                >
                  {copy('review')}
                </Button>
              </RecordEditorActions>
            </form>
          ) : null}
          {action ? (
            <TeamActionDialog
              key={action.reviewNumber}
              action={action}
              confirmationDisabled={busy || !!recovery}
              focusSummary
              finalFocus={reviewButton}
              summary={<DraftDecisionReview action={action} recovery={recoveryHelp} />}
              onClose={() => setAction(null)}
              onUnconfirmed={() => {
                setError('');
                setRecovery(action);
              }}
              onSuccess={async (result) => {
                if (!result || typeof result !== 'object') throw new Error('Unbound draft receipt');
                if (action.stage === 'approval') {
                  if (
                    !('approvalRequestId' in result) ||
                    typeof result.approvalRequestId !== 'string' ||
                    !uuid.test(result.approvalRequestId) ||
                    !('status' in result) ||
                    result.status !== 'pending' ||
                    !('reviewHash' in result) ||
                    result.reviewHash !== action.hash
                  )
                    throw new Error('Unbound draft approval receipt');
                  if (live.current) {
                    setAction(null);
                    setError(copy('awaitingApproval'));
                    return confirmationText('recorded', locale);
                  }
                  return;
                }
                if (
                  !('orderId' in result) ||
                  result.orderId !== action.draft.id ||
                  !('status' in result) ||
                  result.status !== action.target ||
                  !('refundId' in result)
                )
                  throw new Error('Unbound draft terminal receipt');
                const expected = action.financial.invoices.filter((i) => BigInt(i.amount) > 0n);
                if (action.financial.invoices.length) {
                  if (
                    !('refunds' in result) ||
                    !Array.isArray(result.refunds) ||
                    result.refunds.length !== expected.length ||
                    !('financiallyClosed' in result) ||
                    result.financiallyClosed !== (expected.length === 0)
                  )
                    throw new Error('Unbound draft obligations');
                  const ids = new Set<string>();
                  const invoices = new Map(expected.map((i) => [i.id, i.amount]));
                  for (const row of result.refunds) {
                    if (
                      !row ||
                      typeof row !== 'object' ||
                      !('id' in row) ||
                      typeof row.id !== 'string' ||
                      !uuid.test(row.id) ||
                      ids.has(row.id) ||
                      !('invoiceId' in row) ||
                      !('amount' in row) ||
                      !invoices.has(String(row.invoiceId)) ||
                      invoices.get(String(row.invoiceId)) !== row.amount
                    )
                      throw new Error('Unbound draft obligation');
                    const adopted = action.financial.existing.find(
                      (r) => r.invoiceId === row.invoiceId
                    );
                    if (adopted && row.id !== adopted.id)
                      throw new Error('Changed adopted refund identity');
                    ids.add(row.id);
                    invoices.delete(String(row.invoiceId));
                  }
                  if (
                    expected.length ? !ids.has(String(result.refundId)) : result.refundId !== null
                  )
                    throw new Error('Unbound draft primary refund');
                } else if (result.refundId !== null) throw new Error('Unbound draft refund');
                if (live.current) {
                  setAction(null);
                  setSelected(null);
                  setReason('');
                  reload();
                  return confirmationText('recorded', locale);
                }
                return;
              }}
              onDenied={deny}
            />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
export function ElectricityRawDraftQueue() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <Queue key={JSON.stringify([actor, revision])} />;
}
