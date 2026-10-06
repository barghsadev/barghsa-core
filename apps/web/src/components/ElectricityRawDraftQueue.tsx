import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Label, Textarea, TextCell, DateCell } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
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
    [action, setAction] = useState<(TeamAction & { draft: Draft; reason: string }) | null>(null),
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
        raw.data.refundAmount !== '0' ||
        !('createsContract' in raw.data) ||
        raw.data.createsContract !== false ||
        !('createsInvoice' in raw.data) ||
        raw.data.createsInvoice !== false ||
        !('changesSavedWizardProgress' in raw.data) ||
        raw.data.changesSavedWizardProgress !== false
      )
        throw new Error('Unbound draft review');
      if (live.current)
        setAction({
          draft: owned.row,
          reason: explanation,
          title: copy(owned.action),
          description: copy('summary'),
          path: '/api/staff/electricity/orders/' + owned.row.id + '/draft-terminal',
          method: 'POST',
          successStatus: 200,
          body: {
            action: owned.action,
            reason: explanation,
            expectedReviewHash: raw.hash,
            idempotencyKey: crypto.randomUUID(),
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
                </dl>
              }
              onClose={() => setAction(null)}
              onSuccess={async () => {
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
