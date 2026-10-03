import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  FinancialReviewSummary,
  Input,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import {
  useCancellationDecisionForm,
  type CancellationValues,
} from '../hooks/useCancellationForm.js';
import { documentRequest, DocumentRequestError } from '../lib/documents.js';
import type {
  CancellationPreview,
  CancellationIntent,
  CancellationRefund,
} from '../lib/contract-cancellation.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

export default function CancellationEditor({
  id,
  customerRequestId,
  canChooseRefund,
  onChanged,
  unavailable,
}: {
  id: string;
  customerRequestId: string | null;
  canChooseRefund: boolean;
  unavailable: boolean;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale),
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
  const live = useRef(false),
    generation = useRef(0),
    current = useRef<TeamAction | null>(null);
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
    setPreview(null);
    setIntent(null);
    setDenied(true);
    draft.form.reset({ reason: '', custom: false, lines: {} });
  }
  const unavailableRef = useRef(unavailable);
  unavailableRef.current = unavailable;
  const busy = unavailable || loading || !!action || draft.form.formState.isSubmitting;
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
      documentRequest<CancellationPreview>(`/api/admin/contracts/${id}/cancellation-preview`, {
        signal: controller.signal,
      }),
      documentRequest<{ intent: CancellationIntent | null }>(
        `/api/admin/contracts/${id}/cancellations`,
        {
          signal: controller.signal,
        }
      ),
    ])
      .then(([snapshot, saved]) => {
        if (controller.signal.aborted || owner !== generation.current) return;
        setPreview(snapshot);
        setLoading(false);
        setDenied(false);
        setIntent(
          customerRequestId && saved.intent?.customerRequestId !== customerRequestId
            ? null
            : saved.intent
        );
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
  }, [id, reload, customerRequestId]);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || error || denied || !permitted || draft.form.isSubmissionPending()) return;
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
    const command: TeamAction = {
      title: word('cancellationSave'),
      description: word('cancellationPrepareNotice'),
      path: `/api/admin/contracts/${id}/cancellations`,
      method: 'POST',
      body: {
        expectedVersionId: preview.versionId,
        expectedFingerprint: preview.fingerprint,
        reason: reason.trim(),
        ...(customerRequestId ? { customerRequestId } : {}),
        refundDecision: custom ? { mode: 'custom', refunds } : { mode: 'full_wallet' },
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    };
    current.current = command;
    setAction(command);
  }
  function execute() {
    if (
      busy ||
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
    const command: TeamAction = {
      title: word('cancellationConfirm'),
      description: `${word('cancellationIrreversible')} ${word('cancellationReturn')}: ${money(amount)} ${word('irr')}. ${intent.reason}`,
      path: `/api/admin/contracts/${id}/cancellations/execute`,
      method: 'POST',
      body: { intentId: intent.id, idempotencyKey: crypto.randomUUID() },
      conflictMessage: word('cancellationConflict'),
      forbiddenMessage: word('denied'),
    };
    current.current = command;
    setAction(command);
  }
  const saved = intent && !discard ? intent : null;
  const stale = !!(
    saved &&
    preview &&
    (saved.versionId !== preview.versionId || saved.financialFingerprint !== preview.fingerprint)
  );
  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <Button
        disabled={busy}
        variant="ghost"
        className="self-start"
        onClick={() => setReload((n) => n + 1)}
      >
        {word('cancellationRefresh')}
      </Button>
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
          <p className="font-medium">
            {word('cancellationAvailable')}: <bdi>{money(preview.refundableAmount)}</bdi>{' '}
            {word('irr')}
          </p>
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
                  disabled={busy || error || !permitted}
                  variant="destructive"
                  className="self-start"
                  onClick={execute}
                >
                  {word('cancellationConfirm')}
                </Button>
              ) : null}
              <Button
                disabled={busy || error}
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
              className="flex flex-col gap-4"
              noValidate
              aria-busy={!!action || draft.form.formState.isSubmitting || undefined}
              onSubmit={prepare}
            >
              <p className="text-sm">
                {word(
                  preview.serviceType === 'electricity'
                    ? 'cancellationElectricity'
                    : 'cancellationFinance'
                )}
              </p>
              {preview.serviceType !== 'electricity' && canChooseRefund ? (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={busy || error}
                    checked={custom}
                    onChange={(e) => setCustom(e.target.checked)}
                  />
                  {word('cancellationCustom')}
                </label>
              ) : null}
              {custom ? (
                <div className="flex flex-col gap-3">
                  {preview.invoices.map((invoice, index) => (
                    <div key={invoice.id} className="grid gap-3 rounded border p-3 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor={'return-' + invoice.id}>
                          {word('cancellationInvoice')} {index + 1} · {word('amount')} {word('irr')}
                        </FieldLabel>
                        <Input
                          id={'return-' + invoice.id}
                          dir="ltr"
                          inputMode="numeric"
                          value={lines[invoice.id]?.amount ?? ''}
                          {...draft.bind(`lines.${invoice.id}.amount`)}
                          disabled={busy || error}
                          onChange={(e) =>
                            draft.field(`lines.${invoice.id}.amount`)[1](e.target.value)
                          }
                        />
                        <p
                          id={draft.errorId(`lines.${invoice.id}.amount`)}
                          role={
                            draft.form.getFieldState(`lines.${invoice.id}.amount`).invalid
                              ? 'alert'
                              : undefined
                          }
                          aria-hidden={
                            !draft.form.getFieldState(`lines.${invoice.id}.amount`).invalid ||
                            undefined
                          }
                          className={`text-sm text-destructive${draft.form.getFieldState(`lines.${invoice.id}.amount`).invalid ? '' : ' invisible'}`}
                        >
                          {draft.form.getFieldState(`lines.${invoice.id}.amount`).error?.message ??
                            word('cancellationAmountInvalid')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {word('cancellationAvailable')}: {money(invoice.availableRefundAmount)}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                          <bdi>{invoice.id}</bdi>
                        </p>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={'destination-' + invoice.id}>
                          {word('cancellationDestination')}
                        </FieldLabel>
                        <select
                          id={'destination-' + invoice.id}
                          className="h-10 rounded-md border bg-background px-3 text-sm"
                          value={lines[invoice.id]?.destination ?? 'wallet'}
                          {...draft.bind(`lines.${invoice.id}.destination`)}
                          disabled={busy || error}
                          onChange={(e) =>
                            draft.field(`lines.${invoice.id}.destination`)[1](
                              e.target.value as 'wallet' | 'external_bank'
                            )
                          }
                        >
                          <option value="wallet">{word('cancellation.wallet')}</option>
                          <option value="external_bank">
                            {word('cancellation.external_bank')}
                          </option>
                        </select>
                        <p
                          id={draft.errorId(`lines.${invoice.id}.destination`)}
                          role={
                            draft.form.getFieldState(`lines.${invoice.id}.destination`).invalid
                              ? 'alert'
                              : undefined
                          }
                          aria-hidden={
                            !draft.form.getFieldState(`lines.${invoice.id}.destination`).invalid ||
                            undefined
                          }
                          className={`text-sm text-destructive${draft.form.getFieldState(`lines.${invoice.id}.destination`).invalid ? '' : ' invisible'}`}
                        >
                          {draft.form.getFieldState(`lines.${invoice.id}.destination`).error
                            ?.message ?? word('cancellationDestinationInvalid')}
                        </p>
                      </Field>
                    </div>
                  ))}
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="cancellation-reason">{word('cancellationReason')}</FieldLabel>
                <Textarea
                  {...draft.bind('reason')}
                  disabled={busy || error}
                  required
                  aria-required="true"
                  id="cancellation-reason"
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p
                  id={draft.errorId('reason')}
                  role={draft.errors.reason ? 'alert' : undefined}
                  aria-hidden={!draft.errors.reason || undefined}
                  className={`text-sm text-destructive${draft.errors.reason ? '' : ' invisible'}`}
                >
                  {draft.errors.reason?.message ?? word('cancellationReasonInvalid')}
                </p>
              </Field>
              {draft.errors.root?.validation ? (
                <Alert variant="destructive">
                  <AlertDescription>{draft.errors.root.validation.message}</AlertDescription>
                </Alert>
              ) : null}
              <Button type="submit" className="self-start" disabled={busy || error || !permitted}>
                {draft.form.formState.isSubmitting && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {word('cancellationSave')}
              </Button>
            </form>
          )}
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          confirmationDisabled={unavailable || loading || error || denied || !permitted}
          summary={review ? <CancellationFinancialReview {...review} /> : null}
          finalFocus={() => document.getElementById('cancellation-reason')}
          onClose={() => {
            if (current.current === action) close();
          }}
          onDenied={() => {
            if (live.current && current.current === action) deny();
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
                receipt.state !== 'Cancelled'
              )
                throw new Error('Cancellation execution acknowledgement mismatch');
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
                (receipt.customerRequestId ?? null) !== customerRequestId ||
                !['ready', 'awaiting_approval'].includes(receipt.status) ||
                !sameRefundDecision(receipt.refundDecision, review.decision)
              )
                throw new Error('Cancellation decision acknowledgement mismatch');
              close();
              setIntent(receipt);
              setDiscard(false);
              draft.form.reset({ reason: '', custom: false, lines: draft.form.getValues('lines') });
            }
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
}: {
  snapshot: CancellationPreview;
  decision: CancellationIntent['refundDecision'];
  reason: string;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const money = (value: string) =>
    `${new Intl.NumberFormat(locale).format(BigInt(value))} ${word('irr')}`;
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
