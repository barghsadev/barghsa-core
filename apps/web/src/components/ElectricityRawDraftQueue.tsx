import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Label, Textarea, TextCell, DateCell } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { OperationalQueueTable } from './OperationalQueueTable.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
interface Draft {
  id: string;
  profileId: string;
  mode: 'simple' | 'advanced';
  createdAt: string;
  updatedAt: string;
}
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
  return { amount, invoices, required };
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
function Queue() {
  const locale = useLocale(),
    copy = (key: string) => t('electricity.rawDraft.' + key, locale);
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Draft[]>([]),
    [after, setAfter] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [selected, setSelected] = useState<{ row: Draft; action: 'reject' | 'cancel' } | null>(
      null
    ),
    [reason, setReason] = useState(''),
    [action, setAction] = useState<
      | (TeamAction & {
          draft: Draft;
          reason: string;
          gift: ReturnType<typeof giftOutcome>;
          financial: ReturnType<typeof financialOutcome>;
          stage: 'approval' | 'execute';
          hash: string;
          target: 'rejected' | 'cancelled';
        })
      | null
    >(null),
    [busy, setBusy] = useState(false),
    [invalid, setInvalid] = useState(false);
  const live = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setLoading(true);
    setError('');
    setRows([]);
    void fetch(
      '/api/staff/electricity/orders/drafts' + (after ? '?after=' + encodeURIComponent(after) : ''),
      { signal: abort.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('Draft queue denied');
        return queue(await response.json());
      })
      .then((data) => {
        if (!abort.signal.aborted) {
          setRows(data.drafts);
          setNext(data.nextAfter);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(copy('failed'));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, after, revision, locale]);
  const reload = () => {
    setAfter(null);
    setRevision((v) => v + 1);
  };
  async function review(event: FormEvent) {
    event.preventDefault();
    if (!selected || pending.current) return;
    const explanation = reason.trim();
    if (!explanation || explanation.length > 1000) {
      setInvalid(true);
      return;
    }
    const owned = selected;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        '/api/staff/electricity/orders/' + owned.row.id + '/draft-terminal/review',
        {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: owned.action, reason: explanation }),
        }
      );
      if (!response.ok) throw new Error('Draft review unavailable');
      const raw: unknown = await response.json();
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
        if (live.current) setError(copy('awaitingApproval'));
        return;
      }
      const gift = giftOutcome(
        'gift' in raw.data ? raw.data.gift : null,
        'paidOrder' in raw.data && raw.data.paidOrder === true
      );
      if (live.current)
        setAction({
          draft: owned.row,
          reason: explanation,
          gift,
          financial,
          stage,
          hash: raw.hash,
          target: owned.action === 'reject' ? 'rejected' : 'cancelled',
          title: copy(stage === 'approval' ? 'requestApproval' : owned.action),
          description: copy(stage === 'approval' ? 'approvalSummary' : 'summary'),
          path:
            '/api/staff/electricity/orders/' +
            owned.row.id +
            '/draft-terminal' +
            (stage === 'approval' ? '/approval' : ''),
          method: 'POST',
          successStatus: stage === 'approval' ? 201 : 200,
          body: {
            action: owned.action,
            reason: explanation,
            expectedReviewHash: raw.hash,
            idempotencyKey: crypto.randomUUID(),
            ...(financial.required && approval?.status === 'approved'
              ? { approvalRequestId: approval.id }
              : {}),
          },
          conflictMessage: copy('changed'),
          forbiddenMessage: copy('denied'),
        });
    } catch {
      if (live.current) setError(copy('failed'));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <details
      className="rounded-md border p-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">{copy('title')}</summary>
      {open ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">{copy('description')}</p>
          {error ? <p role="alert">{error}</p> : null}
          <Button variant="outline" disabled={busy || !!action} onClick={reload}>
            {copy('retry')}
          </Button>
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
                    disabled={busy || !!action}
                    onClick={() => {
                      setSelected({ row, action: choice });
                      setReason('');
                      setInvalid(false);
                      setError('');
                    }}
                  >
                    {copy(choice)}
                  </Button>
                ))}
              </div>
            )}
            loading={loading}
            emptyMessage={copy('empty')}
            tableClassName="min-w-[36rem]"
          />
          {next ? (
            <Button variant="outline" disabled={busy || !!action} onClick={() => setAfter(next)}>
              {copy('next')}
            </Button>
          ) : null}
          {selected ? (
            <form onSubmit={review} className="space-y-3 rounded-md border p-4">
              <h3 className="font-medium">{copy(selected.action)}</h3>
              <p className="break-all text-sm" dir="ltr">
                {selected.row.id}
              </p>
              <Label htmlFor="raw-electricity-draft-reason">{copy('reason')}</Label>
              <Textarea
                id="raw-electricity-draft-reason"
                value={reason}
                maxLength={1000}
                required
                aria-invalid={invalid}
                aria-describedby={invalid ? 'raw-draft-reason-error' : undefined}
                disabled={busy || !!action}
                onChange={(event) => {
                  setReason(event.target.value);
                  setInvalid(false);
                }}
              />
              {invalid ? (
                <p id="raw-draft-reason-error" role="alert">
                  {copy('reasonInvalid')}
                </p>
              ) : null}
              <Button type="submit" disabled={busy || !!action}>
                {copy('review')}
              </Button>
            </form>
          ) : null}
          {action ? (
            <TeamActionDialog
              action={action}
              summary={
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt>{copy('order')}</dt>
                    <dd className="break-all" dir="ltr">
                      {action.draft.id}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy('profile')}</dt>
                    <dd className="break-all" dir="ltr">
                      {action.draft.profileId}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy('reason')}</dt>
                    <dd className="whitespace-pre-wrap break-words">{action.reason}</dd>
                  </div>
                  {action.gift ? (
                    <div>
                      <dt>{copy('gift')}</dt>
                      <dd className="break-all" dir="ltr">
                        {action.gift.id}
                      </dd>
                      <dd>{copy('gift.' + action.gift.outcome)}</dd>
                    </div>
                  ) : null}
                  {action.financial.invoices.length ? (
                    <>
                      <div>
                        <dt>{copy('walletReturn')}</dt>
                        <dd>{numbers.money(action.financial.amount)}</dd>
                      </div>
                      {action.financial.invoices.map((line) => (
                        <div key={line.id}>
                          <dt>{copy('invoice')}</dt>
                          <dd className="break-all" dir="ltr">
                            {line.id}
                          </dd>
                          <dd>{numbers.money(line.amount)}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>{copy('approval')}</dt>
                        <dd>
                          {copy(
                            action.financial.required ? 'approvalRequired' : 'approvalNotRequired'
                          )}
                        </dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              }
              onClose={() => setAction(null)}
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
                }
              }}
              onDenied={() => {
                setRows([]);
                setAction(null);
                setSelected(null);
                setError(copy('denied'));
              }}
            />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
export function ElectricityRawDraftQueue() {
  const actor = useAccountUser();
  return <Queue key={actor ?? 'signed-out'} />;
}
