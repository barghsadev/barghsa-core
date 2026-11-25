import { confirmationText } from '@barghsa/i18n/confirmation';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  FinancialReviewSummary,
  Input,
  ListRefreshButton,
  NativeSelect,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { cancellationEditorMessages } from '@barghsa/i18n/cancellation-editor';
import { useLocale } from '../hooks/useLocale.js';
import {
  useCancellationDecisionForm,
  type CancellationValues,
} from '../hooks/useCancellationForm.js';
import { DocumentRequestError } from '../lib/documents.js';
import type {
  CancellationPreview,
  CancellationIntent,
  CancellationRefund,
} from '../lib/contract-cancellation.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorGrid,
  recordEditorSurface,
} from './RecordEditorLayout.js';

const isIrr = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value);

export default function CancellationEditor(props: Parameters<typeof OwnedCancellationEditor>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedCancellationEditor key={JSON.stringify([actor, revision])} {...props} />;
}
function OwnedCancellationEditor({
  id,
  terminalAction = 'cancel',
  customerRequestId,
  canChooseRefund,
  onChanged,
  unavailable,
  versionId,
  onLocked,
}: {
  id: string;
  terminalAction?: 'cancel' | 'reject';
  customerRequestId: string | null;
  canChooseRefund: boolean;
  unavailable: boolean;
  onChanged: () => void;
  versionId?: string | undefined;
  onLocked?: ((locked: boolean) => void) | undefined;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([id, terminalAction, customerRequestId])
  );
  const locale = useLocale(),
    word = (key: string) =>
      contractText(
        terminalAction === 'reject' &&
          [
            'cancellationBlocked',
            'cancellationSave',
            'cancellationConfirm',
            'cancellationPrepareNotice',
            'cancellationIrreversible',
            'cancellationReason',
            'cancellationElectricity',
            'cancellationFinancialReview',
          ].includes(key)
          ? key.replace('cancellation', 'rejection')
          : key,
        locale
      ),
    money = (raw: string) => new Intl.NumberFormat(locale).format(BigInt(raw));
  const [preview, setPreview] = useState<CancellationPreview | null>(null),
    [intent, setIntent] = useState<CancellationIntent | null>(null);
  const [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [discard, setDiscard] = useState(false);
  const draft = useCancellationDecisionForm(preview);
  const [reason, setReason] = draft.field('reason');
  const [custom, setCustom] = draft.field('custom');
  const lines = draft.values.lines;
  const [action, setAction] = useState<TeamAction | null>(null),
    [review, setReview] = useState<{
      snapshot: CancellationPreview;
      decision: CancellationIntent['refundDecision'];
      reason: string;
    } | null>(null),
    [phase, setPhase] = useState<'prepare' | 'execute'>('prepare');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const live = useRef(false),
    generation = useRef(0),
    current = useRef<TeamAction | null>(null);
  const currentBasis = useRef('');
  const unconfirmed = useRef<{ action: TeamAction; basis: string } | null>(null);
  const notifyChanged = useRef(onChanged);
  notifyChanged.current = onChanged;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const canChooseRef = useRef(canChooseRefund);
  canChooseRef.current = canChooseRefund;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      current.current = null;
    };
  }, []);
  function close() {
    current.current = null;
    setAction(null);
    setReview(null);
  }
  function deny() {
    generation.current++;
    close();
    unconfirmed.current = null;
    setNeedsRead(false);
    setPreview(null);
    setIntent(null);
    setDenied(true);
    draft.form.reset({ reason: '', custom: false, lines: {} });
  }
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  const busy = unavailable || loading || !!action || draft.form.formState.isSubmitting;
  const submitting = !!action || draft.form.formState.isSubmitting;
  useEffect(() => {
    if (!onLocked) return;
    onLocked(submitting);
    return () => onLocked(false);
  }, [onLocked, submitting]);
  const permitted =
    !!preview &&
    !preview.blockers.length &&
    (preview.serviceType === 'electricity' ||
      BigInt(preview.refundableAmount) === 0n ||
      canChooseRefund);
  useEffect(() => {
    const controller = new AbortController();
    const owner = ++generation.current;
    setLoading(true);
    setError(false);
    void Promise.all([
      readContract<CancellationPreview>(
        `/api/admin/contracts/${id}/cancellation-preview${terminalAction === 'reject' ? '?terminalAction=reject' : ''}`,
        {
          signal: controller.signal,
        }
      ),
      readContract<{ intent: CancellationIntent | null }>(
        `/api/admin/contracts/${id}/cancellations${terminalAction === 'reject' ? '?terminalAction=reject' : ''}`,
        {
          signal: controller.signal,
        }
      ),
    ])
      .then(([snapshot, saved]) => {
        if (controller.signal.aborted || owner !== generation.current) return;
        const stored = saved.intent;
        if (
          snapshot.contractId !== id ||
          (snapshot.terminalAction ?? 'cancel') !== terminalAction ||
          (terminalAction === 'reject' && snapshot.serviceType !== 'electricity') ||
          typeof snapshot.versionId !== 'string' ||
          (versionId !== undefined && snapshot.versionId !== versionId) ||
          typeof snapshot.fingerprint !== 'string' ||
          !Array.isArray(snapshot.blockers) ||
          !Array.isArray(snapshot.invoices) ||
          !isIrr(snapshot.refundableAmount) ||
          !snapshot.invoices.every(
            (invoice) =>
              invoice &&
              typeof invoice.id === 'string' &&
              [
                invoice.paidAmount,
                invoice.refundedAmount,
                invoice.availableRefundAmount,
                invoice.refundableAmount,
              ].every(isIrr)
          ) ||
          (stored !== null &&
            (!stored ||
              stored.contractId !== id ||
              (stored.terminalAction ?? 'cancel') !== terminalAction ||
              !['ready', 'awaiting_approval', 'rejected', 'executed'].includes(stored.status) ||
              !Array.isArray(stored.refundDecision?.refunds) ||
              !stored.refundDecision.refunds.every(
                (line) =>
                  line &&
                  typeof line.invoiceId === 'string' &&
                  isIrr(line.amount) &&
                  ['wallet', 'external_bank'].includes(line.destination)
              )))
        )
          throw new Error('Unbound cancellation snapshot');
        const pending = unconfirmed.current;
        if (
          pending?.action.path.endsWith('/execute') &&
          stored?.status === 'executed' &&
          stored.id === (pending.action.body as { intentId: string }).intentId
        ) {
          unconfirmed.current = null;
          notifyChanged.current();
        }
        setPreview(snapshot);
        setLoading(false);
        setNeedsRead(false);
        setDenied(false);
        const currentIntent =
          customerRequestId && stored?.customerRequestId !== customerRequestId ? null : stored;
        if (pending && currentIntent && currentIntent.id !== intent?.id) setDiscard(false);
        setIntent(currentIntent);
        const values = draft.form.getValues();
        draft.form.reset({
          ...values,
          lines: Object.fromEntries(
            snapshot.invoices.map((invoice) => [
              invoice.id,
              values.lines[invoice.id] ?? {
                amount: invoice.availableRefundAmount,
                destination: 'wallet' as const,
              },
            ])
          ),
        });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || owner !== generation.current) return;
        setLoading(false);
        if (failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status))
          deny();
        else setError(true);
      });
    return () => controller.abort();
  }, [id, reload, customerRequestId, terminalAction, readContract, versionId]);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || needsRead || error || denied || !permitted || draft.form.isSubmissionPending())
      return;
    const captured = preview;
    const owner = generation.current;
    void draft.form.handleSubmit((values) => {
      if (
        !live.current ||
        unavailableRef.current ||
        owner !== generation.current ||
        captured !== previewRef.current ||
        !captured ||
        current.current
      )
        return;
      if (
        captured.serviceType !== 'electricity' &&
        BigInt(captured.refundableAmount) > 0n &&
        !canChooseRef.current
      )
        return;
      openPreparation(captured, values);
    })(event);
  }
  function openCommand(proposal: TeamAction & { body: Record<string, unknown> }) {
    const basis = JSON.stringify([proposal.path, proposal.body]);
    const pending = unconfirmed.current;
    const command =
      pending?.basis === basis
        ? pending.action
        : { ...proposal, body: { ...proposal.body, idempotencyKey: crypto.randomUUID() } };
    currentBasis.current = basis;
    current.current = command;
    setAction(command);
  }
  function openPreparation(
    preview: CancellationPreview,
    { reason, custom, lines }: CancellationValues
  ) {
    const refunds: CancellationRefund[] = custom
      ? preview.invoices.flatMap((invoice) =>
          BigInt(lines[invoice.id]!.amount) > 0n
            ? [{ invoiceId: invoice.id, ...lines[invoice.id]! }]
            : []
        )
      : [];
    setPhase('prepare');
    setReview({
      snapshot: preview,
      decision: custom
        ? { mode: 'custom', refunds }
        : {
            mode: 'full_wallet',
            refunds: preview.invoices
              .filter((invoice) => BigInt(invoice.refundableAmount) > 0n)
              .map((invoice) => ({
                invoiceId: invoice.id,
                amount: invoice.refundableAmount,
                destination: 'wallet',
              })),
          },
      reason: reason.trim(),
    });
    openCommand({
      risk: 'financial',
      title: word('cancellationSave'),
      description: word('cancellationPrepareNotice'),
      path: `/api/admin/contracts/${id}/cancellations`,
      method: 'POST',
      body: {
        ...(terminalAction === 'reject' ? { terminalAction } : {}),
        expectedVersionId: preview.versionId,
        expectedFingerprint: preview.fingerprint,
        reason: reason.trim(),
        ...(customerRequestId ? { customerRequestId } : {}),
        refundDecision: custom ? { mode: 'custom', refunds } : { mode: 'full_wallet' },
      },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  function execute() {
    if (
      busy ||
      needsRead ||
      error ||
      denied ||
      !permitted ||
      !intent ||
      intent.status !== 'ready' ||
      !preview ||
      intent.versionId !== preview.versionId ||
      intent.financialFingerprint !== preview.fingerprint
    )
      return;
    setPhase('execute');
    setReview({ snapshot: preview, decision: intent.refundDecision, reason: intent.reason });
    const amount = intent.refundDecision.refunds
      .reduce((sum, line) => sum + BigInt(line.amount), 0n)
      .toString();
    openCommand({
      risk: 'both',
      title: word('cancellationConfirm'),
      description: `${word('cancellationIrreversible')} ${word('cancellationReturn')}: ${money(amount)} ${word('irr')}. ${intent.reason}`,
      path: `/api/admin/contracts/${id}/cancellations/execute`,
      method: 'POST',
      body: { intentId: intent.id },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const saved = intent && !discard ? intent : null;
  const stale = !!(
    saved &&
    preview &&
    (saved.versionId !== preview.versionId || saved.financialFingerprint !== preview.fingerprint)
  );
  const copy = cancellationEditorMessages[locale];
  const refresh = () => setReload((n) => n + 1);
  return (
    <div
      className={
        versionId ? 'flex min-w-0 flex-col gap-3' : 'flex min-w-0 flex-col gap-3 border-t pt-3'
      }
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-2${versionId && preview ? ' rounded-xl border bg-card px-4 py-2.5 sm:px-6' : ''}`}
      >
        {preview && (
          <dl
            className={
              versionId ? 'min-w-0 text-sm' : 'min-w-0 rounded-lg bg-muted/45 px-3 py-2 text-sm'
            }
          >
            <dt className="text-muted-foreground">{word('cancellationAvailable')}</dt>
            <dd className="break-words text-lg font-semibold tabular-nums">
              <bdi>{money(preview.refundableAmount)}</bdi> {word('irr')}
            </dd>
          </dl>
        )}
        {needsRead ? (
          <Button disabled={busy} variant="outline" onClick={refresh}>
            {confirmationText('checkStatus', locale)}
          </Button>
        ) : (
          <ListRefreshButton
            label={word('cancellationRefresh')}
            disabled={busy}
            onClick={refresh}
          />
        )}
      </div>
      {needsRead && (
        <Alert variant="destructive">
          <AlertDescription>{confirmationText('unconfirmed', locale)}</AlertDescription>
        </Alert>
      )}
      {denied ? <p role="status">{word('denied')}</p> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : null}
      {!preview ? (
        !error && !denied ? (
          <PageLoading label={word('loading')} />
        ) : null
      ) : (
        <>
          {preview.blockers.length ? (
            <Alert variant="destructive">
              <AlertDescription>
                {word('cancellationBlocked')}
                <ul>
                  {preview.blockers.map((blocker) => (
                    <li key={blocker}>{word('cancellation.blocker.' + blocker)}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {saved ? (
            <>
              <p className="whitespace-pre-wrap">{saved.reason}</p>
              <StatusBadge
                label={word(stale ? 'cancellation.stale' : 'cancellation.' + saved.status)}
              />
              <ul>
                {saved.refundDecision.refunds.map((line) => (
                  <li key={line.invoiceId}>
                    <bdi>{money(line.amount)}</bdi> {word('irr')} ·{' '}
                    {word('cancellation.' + line.destination)}
                  </li>
                ))}
              </ul>
              {saved.status === 'awaiting_approval' ? (
                <p>{word('cancellationApprovalNotice')}</p>
              ) : null}
              {saved.status === 'ready' && !stale && !preview.blockers.length ? (
                <Button
                  disabled={busy || needsRead || error || !permitted}
                  variant="destructive"
                  className="self-start"
                  onClick={execute}
                >
                  {word('cancellationConfirm')}
                </Button>
              ) : null}
              <Button
                disabled={busy || needsRead || error}
                variant="outline"
                className="self-start"
                onClick={() => {
                  setDiscard(true);
                  setReload((n) => n + 1);
                }}
              >
                {word('cancellationNewDecision')}
              </Button>
            </>
          ) : (
            <form
              className={recordEditorSurface}
              noValidate
              aria-busy={!!action || draft.form.formState.isSubmitting || undefined}
              onSubmit={prepare}
            >
              <RecordEditorSection title={copy.refundPlan}>
                {preview.serviceType !== 'electricity' && canChooseRefund ? (
                  <label className="touch-label flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-primary"
                      disabled={busy || needsRead || error}
                      checked={custom}
                      onChange={(e) => setCustom(e.target.checked)}
                    />
                    {word('cancellationCustom')}
                  </label>
                ) : null}
                {preview.serviceType === 'electricity' ? (
                  <p className="text-sm text-muted-foreground">{word('cancellationElectricity')}</p>
                ) : canChooseRefund ? (
                  <p className="text-sm text-muted-foreground">
                    {custom ? copy.customAmounts : copy.defaultWallet}
                  </p>
                ) : !permitted ? (
                  <p className="text-sm text-muted-foreground">{word('cancellationFinance')}</p>
                ) : null}
                {custom ? (
                  <div className="space-y-2.5">
                    {preview.invoices.map((invoice, index) => {
                      const amountField = `lines.${invoice.id}.amount` as const;
                      const destinationField = `lines.${invoice.id}.destination` as const;
                      const availableId = `available-${invoice.id}`;
                      const amountInput = draft.bind(amountField);
                      const amountError = draft.form.getFieldState(amountField).error;
                      const destinationError = draft.form.getFieldState(destinationField).error;
                      return (
                        <fieldset key={invoice.id} className="min-w-0 rounded-lg border p-3">
                          <legend className="px-1 text-sm font-medium">
                            {word('cancellationInvoice')} {index + 1}
                          </legend>
                          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <bdi className="break-all">{invoice.id}</bdi>
                            <p id={availableId}>
                              {word('cancellationAvailable')}{' '}
                              <bdi className="font-semibold text-foreground">
                                {money(invoice.availableRefundAmount)} {word('irr')}
                              </bdi>
                            </p>
                          </div>
                          <div className={recordEditorGrid}>
                            <Field className="min-w-0 gap-1">
                              <FieldLabel htmlFor={'return-' + invoice.id}>
                                {word('amount')} ({word('irr')})
                              </FieldLabel>
                              <Input
                                id={'return-' + invoice.id}
                                dir="ltr"
                                inputMode="numeric"
                                value={lines[invoice.id]?.amount ?? ''}
                                {...amountInput}
                                aria-describedby={[availableId, amountInput['aria-describedby']]
                                  .filter(Boolean)
                                  .join(' ')}
                                disabled={busy || needsRead || error}
                                aria-required="true"
                                onChange={(e) => draft.field(amountField)[1](e.target.value)}
                              />
                              <p
                                id={draft.errorId(amountField)}
                                role={amountError ? 'alert' : undefined}
                                aria-hidden={!amountError || undefined}
                                className={`text-sm text-destructive${amountError ? '' : ' invisible'}`}
                              >
                                {amountError?.message ?? word('cancellationAmountInvalid')}
                              </p>
                            </Field>
                            <Field className="min-w-0 gap-1">
                              <FieldLabel htmlFor={'destination-' + invoice.id}>
                                {word('cancellationDestination')}
                              </FieldLabel>
                              <NativeSelect
                                id={'destination-' + invoice.id}
                                className="w-full min-w-0"
                                value={lines[invoice.id]?.destination ?? 'wallet'}
                                {...draft.bind(destinationField)}
                                disabled={busy || needsRead || error}
                                aria-required="true"
                                onChange={(e) =>
                                  draft.field(destinationField)[1](
                                    e.target.value as 'wallet' | 'external_bank'
                                  )
                                }
                              >
                                <option value="wallet">{word('cancellation.wallet')}</option>
                                <option value="external_bank">
                                  {word('cancellation.external_bank')}
                                </option>
                              </NativeSelect>
                              <p
                                id={draft.errorId(destinationField)}
                                role={destinationError ? 'alert' : undefined}
                                aria-hidden={!destinationError || undefined}
                                className={`text-sm text-destructive${destinationError ? '' : ' invisible'}`}
                              >
                                {destinationError?.message ??
                                  word('cancellationDestinationInvalid')}
                              </p>
                            </Field>
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                ) : null}
              </RecordEditorSection>
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <Field className="min-w-0 gap-1">
                  <FieldLabel htmlFor="cancellation-reason">
                    {word('cancellationReason')}
                  </FieldLabel>
                  <Textarea
                    {...draft.bind('reason')}
                    disabled={busy || needsRead || error}
                    required
                    aria-required="true"
                    id="cancellation-reason"
                    maxLength={1000}
                    rows={2}
                    dir="auto"
                    placeholder={
                      terminalAction === 'reject' ? copy.rejectionExample : copy.decisionExample
                    }
                    className={`min-h-14 max-h-48 ${locale === 'fa' ? 'placeholder:text-right' : ''}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <p
                    id={draft.errorId('reason')}
                    role={draft.errors.reason ? 'alert' : undefined}
                    aria-hidden={!draft.errors.reason || undefined}
                    hidden={!draft.errors.reason}
                    className="text-sm text-destructive"
                  >
                    {draft.errors.reason?.message ?? word('cancellationReasonInvalid')}
                  </p>
                </Field>
                {draft.errors.root?.validation ? (
                  <Alert variant="destructive">
                    <AlertDescription>{draft.errors.root.validation.message}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <RecordEditorActions>
                <Button
                  type="submit"
                  className="h-auto min-h-11 max-w-full whitespace-normal text-start"
                  disabled={busy || needsRead || error || !permitted}
                >
                  {draft.form.formState.isSubmitting && (
                    <span
                      aria-hidden="true"
                      className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                    />
                  )}
                  {word('cancellationSave')}
                </Button>
              </RecordEditorActions>
            </form>
          )}
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          toastErrors={false}
          confirmationDisabled={unavailable || loading || error || denied || !permitted}
          summary={
            review ? (
              <CancellationFinancialReview terminalAction={terminalAction} {...review} />
            ) : null
          }
          finalFocus={() => document.getElementById('cancellation-reason')}
          onClose={() => {
            if (current.current === action) close();
          }}
          onDenied={() => {
            if (live.current && current.current === action) deny();
          }}
          onUnconfirmed={() => {
            if (!live.current || current.current !== action) return;
            unconfirmed.current = { action, basis: currentBasis.current };
            setNeedsRead(true);
            close();
          }}
          onValidationError={(fields) =>
            live.current &&
            current.current === action &&
            phase === 'prepare' &&
            !!review &&
            draft.applyServerErrors(
              fields,
              review.decision.refunds.map((line) => line.invoiceId)
            )
          }
          onSuccess={async (result) => {
            if (!live.current || current.current !== action || !review) return;
            if (phase === 'execute') {
              const receipt = result as {
                contractId?: string;
                versionId?: string;
                intentId?: string;
                state?: string;
              } | null;
              if (
                !receipt ||
                receipt.contractId !== id ||
                receipt.versionId !== review.snapshot.versionId ||
                receipt.intentId !== intent?.id ||
                receipt.state !== (terminalAction === 'reject' ? 'Rejected' : 'Cancelled')
              )
                throw new Error('Cancellation execution acknowledgement mismatch');
              unconfirmed.current = null;
              close();
              onChanged();
            } else {
              const receipt = result as CancellationIntent | null;
              if (
                !receipt ||
                !receipt.id ||
                receipt.contractId !== id ||
                receipt.versionId !== review.snapshot.versionId ||
                receipt.financialFingerprint !== review.snapshot.fingerprint ||
                receipt.reason !== review.reason ||
                (receipt.terminalAction ?? 'cancel') !== terminalAction ||
                (receipt.customerRequestId ?? null) !== customerRequestId ||
                !['ready', 'awaiting_approval'].includes(receipt.status) ||
                !sameRefundDecision(receipt.refundDecision, review.decision)
              )
                throw new Error('Cancellation decision acknowledgement mismatch');
              unconfirmed.current = null;
              close();
              setIntent(receipt);
              setDiscard(false);
              draft.form.reset({ reason: '', custom: false, lines: draft.form.getValues('lines') });
            }
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </div>
  );
}

function CancellationFinancialReview({
  snapshot,
  decision,
  reason,
  terminalAction = 'cancel',
}: {
  terminalAction?: 'cancel' | 'reject';
  snapshot: CancellationPreview;
  decision: CancellationIntent['refundDecision'];
  reason: string;
}) {
  const locale = useLocale();
  const word = (key: string) =>
    contractText(
      terminalAction === 'reject' &&
        ['cancellationFinancialReview', 'cancellationReason'].includes(key)
        ? key.replace('cancellation', 'rejection')
        : key,
      locale
    );
  const money = useFinancialFormatting(locale).reviewMoney;
  const total = decision.refunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n);
  return (
    <FinancialReviewSummary
      title={word('cancellationFinancialReview')}
      rows={[
        { id: 'contract', label: word('contractReference'), value: snapshot.contractId },
        { id: 'profile', label: word('profile'), value: snapshot.profileId },
        { id: 'version', label: word('version'), value: snapshot.versionId },
        { id: 'service', label: word('serviceType'), value: word(snapshot.serviceType) },
        ...snapshot.invoices.flatMap((invoice, index) => [
          {
            id: `${invoice.id}-id`,
            label: `${word('cancellationInvoice')} ${index + 1}`,
            value: invoice.id,
          },
          {
            id: `${invoice.id}-paid`,
            label: `${word('cancellationInvoice')} ${index + 1} · ${word('cancellationPaid')}`,
            value: money(invoice.paidAmount),
          },
          {
            id: `${invoice.id}-returned`,
            label: `${word('cancellationInvoice')} ${index + 1} · ${word('cancellationAlreadyReturned')}`,
            value: money(invoice.refundedAmount),
          },
          {
            id: `${invoice.id}-available`,
            label: `${word('cancellationInvoice')} ${index + 1} · ${word('cancellationAvailable')}`,
            value: money(invoice.availableRefundAmount),
          },
        ]),
        ...decision.refunds.map((refund) => ({
          id: `refund-${refund.invoiceId}`,
          label: `${word('cancellationInvoice')} ${snapshot.invoices.findIndex((invoice) => invoice.id === refund.invoiceId) + 1} · ${word('cancellationReturn')}`,
          value: `${money(refund.amount)} · ${word(`cancellation.${refund.destination}`)}`,
        })),
      ]}
      total={{ label: word('cancellationReturn'), value: money(total.toString()) }}
      notice={`${word('cancellationReason')}: ${reason}`}
    />
  );
}

function sameRefundDecision(
  actual: CancellationIntent['refundDecision'] | undefined,
  expected: CancellationIntent['refundDecision']
) {
  return (
    actual?.mode === expected.mode &&
    Array.isArray(actual.refunds) &&
    actual.refunds.length === expected.refunds.length &&
    expected.refunds.every((line) =>
      actual.refunds.some(
        (candidate) =>
          candidate.invoiceId === line.invoiceId &&
          candidate.amount === line.amount &&
          candidate.destination === line.destination
      )
    )
  );
}
