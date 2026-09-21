import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Input,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest } from '../lib/documents.js';
import { contractBase } from '../lib/contracts.js';
import {
  validCancellationAmount,
  type CancellationStatus,
  type CancellationPreview,
  type CancellationIntent,
  type CancellationRefund,
} from '../lib/contract-cancellation.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractCancellationRequestPanel } from './ContractCancellationRequestPanel.js';

export function ContractCancellationPanel({
  id,
  versionId,
  staff,
  onChanged,
}: {
  id: string;
  versionId: string;
  staff: boolean;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const money = (value: string) => new Intl.NumberFormat(locale).format(BigInt(value));
  const [status, setStatus] = useState<CancellationStatus | null>(null),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [open, setOpen] = useState(false),
    [customerRequestId, setCustomerRequestId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setError(false);
    setOpen(false);
    setCustomerRequestId(null);
    void documentRequest<CancellationStatus>(`${contractBase(staff)}/${id}/cancellation-status`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, staff, reload]);
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('cancellationTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('cancellationTitle')}</h3>
        <Button variant="ghost" onClick={() => setReload((n) => n + 1)}>
          {word('refresh')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !status ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {!staff || status.canCancel ? (
            <ContractCancellationRequestPanel
              id={id}
              versionId={versionId}
              staff={staff}
              onChanged={onChanged}
              onReview={(request) => {
                setCustomerRequestId(request.id);
                setOpen(true);
              }}
            />
          ) : null}
          {status.state === 'Cancelled' ? (
            <>
              <p>{word('cancellationServiceEnded')}</p>
              <StatusBadge label={word('cancellation.' + status.financialStatus)} />
              <p className="text-sm">
                {word('cancellationReturned')}:{' '}
                <bdi>
                  {money(status.returnedAmount)} / {money(status.refundAmount)}
                </bdi>{' '}
                {word('irr')}
              </p>
              {status.financialStatus === 'needs_attention' ||
              status.financialStatus === 'unverified' ? (
                <p role="status">{word('cancellationSupport')}</p>
              ) : null}
              <ul className="divide-y">
                {status.refunds.map((refund) => (
                  <li
                    key={refund.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span>
                      <bdi>{money(refund.amount)}</bdi> {word('irr')} ·{' '}
                      {word('cancellation.' + refund.destination)}
                    </span>
                    <StatusBadge label={word('cancellation.refund.' + refund.state)} />
                  </li>
                ))}
              </ul>
            </>
          ) : status.canCancel && staff ? (
            <>
              <p className="text-sm text-muted-foreground">{word('cancellationNotice')}</p>
              <Button
                variant="outline"
                className="self-start"
                aria-expanded={open}
                onClick={() => {
                  setCustomerRequestId(null);
                  setOpen(!open);
                }}
              >
                {word('cancellationReview')}
              </Button>
              {open ? (
                <CancellationEditor
                  key={id + ':' + customerRequestId}
                  id={id}
                  customerRequestId={customerRequestId}
                  canChooseRefund={status.canChooseRefund === true}
                  onChanged={onChanged}
                />
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{word('cancellationNoAction')}</p>
          )}
        </>
      )}
    </section>
  );
}
function CancellationEditor({
  id,
  customerRequestId,
  canChooseRefund,
  onChanged,
}: {
  id: string;
  customerRequestId: string | null;
  canChooseRefund: boolean;
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
  const [reason, setReason] = useState(''),
    [custom, setCustom] = useState(false),
    [lines, setLines] = useState<
      Record<string, { amount: string; destination: 'wallet' | 'external_bank' }>
    >({});
  const [invalid, setInvalid] = useState(false),
    [action, setAction] = useState<TeamAction | null>(null),
    [phase, setPhase] = useState<'prepare' | 'execute'>('prepare');
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
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
        if (controller.signal.aborted) return;
        setPreview(snapshot);
        setIntent(
          customerRequestId && saved.intent?.customerRequestId !== customerRequestId
            ? null
            : saved.intent
        );
        setLines(
          Object.fromEntries(
            snapshot.invoices.map((i) => [
              i.id,
              { amount: i.availableRefundAmount, destination: 'wallet' as const },
            ])
          )
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, reload, customerRequestId]);
  function prepare(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    const refunds: CancellationRefund[] = [];
    if (!reason.trim() || preview.blockers.length) {
      setInvalid(true);
      return;
    }
    if (custom)
      for (const invoice of preview.invoices) {
        const line = lines[invoice.id];
        if (!line || !validCancellationAmount(line.amount, invoice.availableRefundAmount)) {
          setInvalid(true);
          return;
        }
        if (BigInt(line.amount) > 0n) refunds.push({ invoiceId: invoice.id, ...line });
      }
    setInvalid(false);
    setPhase('prepare');
    setAction({
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
    });
  }
  function execute() {
    if (!intent) return;
    setPhase('execute');
    const amount = intent.refundDecision.refunds
      .reduce((sum, line) => sum + BigInt(line.amount), 0n)
      .toString();
    setAction({
      title: word('cancellationConfirm'),
      description: `${word('cancellationIrreversible')} ${word('cancellationReturn')}: ${money(amount)} ${word('irr')}. ${intent.reason}`,
      path: `/api/admin/contracts/${id}/cancellations/execute`,
      method: 'POST',
      body: { intentId: intent.id, idempotencyKey: crypto.randomUUID() },
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
  return (
    <div className="flex flex-col gap-4 border-t pt-4">
      <Button variant="ghost" className="self-start" onClick={() => setReload((n) => n + 1)}>
        {word('cancellationRefresh')}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !preview ? (
        <PageLoading label={word('loading')} />
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
                <Button variant="destructive" className="self-start" onClick={execute}>
                  {word('cancellationConfirm')}
                </Button>
              ) : null}
              <Button
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
            <form className="flex flex-col gap-4" onSubmit={prepare}>
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
                          onChange={(e) =>
                            setLines((previous) => ({
                              ...previous,
                              [invoice.id]: {
                                destination: previous[invoice.id]?.destination ?? 'wallet',
                                amount: e.target.value,
                              },
                            }))
                          }
                        />
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
                          onChange={(e) =>
                            setLines((previous) => ({
                              ...previous,
                              [invoice.id]: {
                                amount: previous[invoice.id]?.amount ?? '0',
                                destination: e.target.value as 'wallet' | 'external_bank',
                              },
                            }))
                          }
                        >
                          <option value="wallet">{word('cancellation.wallet')}</option>
                          <option value="external_bank">
                            {word('cancellation.external_bank')}
                          </option>
                        </select>
                      </Field>
                    </div>
                  ))}
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="cancellation-reason">{word('cancellationReason')}</FieldLabel>
                <Textarea
                  id="cancellation-reason"
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-invalid={invalid}
                />
              </Field>
              {invalid ? <p role="alert">{word('cancellationInvalid')}</p> : null}
              <Button
                type="submit"
                className="self-start"
                disabled={
                  preview.blockers.length > 0 ||
                  (preview.serviceType !== 'electricity' &&
                    BigInt(preview.refundableAmount) > 0n &&
                    !canChooseRefund)
                }
              >
                {word('cancellationSave')}
              </Button>
            </form>
          )}
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            setAction(null);
            if (phase === 'execute') onChanged();
            else {
              setIntent(result as CancellationIntent);
              setDiscard(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
