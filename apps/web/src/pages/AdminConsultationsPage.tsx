import { useEffect, useState } from 'react';
import { Button, Label } from '@barghsa/ui';
import { tConsultation } from '@barghsa/i18n/consultation';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';

interface RequestRow {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  staff_owner_id: string | null;
  staff_team: string | null;
  submitted_at: string;
  priority: 'high' | 'normal';
}
interface Detail {
  request: RequestRow & {
    scope: string | null;
    deliverables: string | null;
    fee: string | null;
    invoice_id: string | null;
    offer_valid_until: string | null;
    expected_next_step: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer';
    reason: string | null;
    created_at: string;
  }>;
}

const statuses = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
] as const;

function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function AdminConsultationsPage() {
  const locale = useLocale();
  const copy = (key: string) => tConsultation(key, locale);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('');
  const [assignment, setAssignment] = useState('all');
  const [priority, setPriority] = useState('all');
  const [minAgeDays, setMinAgeDays] = useState('0');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [fee, setFee] = useState('');
  const [scope, setScope] = useState('');
  const [deliverables, setDeliverables] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [offerReason, setOfferReason] = useState('');
  const [offerKey, setOfferKey] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/admin/consultations/teams', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('teams');
        return (await response.json()) as { teams: Array<{ name: string }> };
      })
      .then((result) => {
        if (!controller.signal.aborted) setTeams(result.teams.map((item) => item.name));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    const query = new URLSearchParams({ assignment, priority, minAgeDays });
    if (status) query.set('status', status);
    void fetch(`/api/admin/consultations/requests?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('queue');
        return (await response.json()) as { requests: RequestRow[] };
      })
      .then((result) => {
        if (!controller.signal.aborted) setRows(result.requests);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [status, assignment, priority, minAgeDays, revision]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/admin/consultations/requests/${encodeURIComponent(selectedId)}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('detail');
        return (await response.json()) as Detail;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setDetail(result);
          setFee(result.request.fee ?? '');
          setScope(result.request.scope ?? '');
          setDeliverables(result.request.deliverables ?? '');
          setValidUntil(localDateTime(result.request.offer_valid_until));
          setOfferReason('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [selectedId, revision]);

  function prepare(path: string, title: string, body: Record<string, unknown> = {}) {
    if (!selectedId) return;
    setAction({
      title,
      description: `${detail?.request.profile_name ?? ''} · ${title}`,
      path: `/api/admin/consultations/requests/${selectedId}/${path}`,
      method: 'POST',
      body,
      forbiddenMessage: copy('actionError'),
    });
  }

  const current = detail?.request;
  return (
    <main className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('staffTitle')}</h1>
          <p className="text-muted-foreground">{copy('staffIntro')}</p>
        </div>
        <Button variant="outline" onClick={refresh}>
          {copy('refresh')}
        </Button>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span>{copy('filterStatus')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{copy('openRequests')}</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {copy(`status_${item}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('filterAssignment')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={assignment}
            onChange={(event) => setAssignment(event.target.value)}
          >
            <option value="all">{copy('all')}</option>
            <option value="mine">{copy('mine')}</option>
            <option value="unassigned">{copy('unassigned')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('priority')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            <option value="all">{copy('all')}</option>
            <option value="high">{copy('high')}</option>
            <option value="normal">{copy('normal')}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{copy('age')}</span>
          <select
            className="w-full rounded-md border bg-background p-2"
            value={minAgeDays}
            onChange={(event) => setMinAgeDays(event.target.value)}
          >
            <option value="0">{copy('all')}</option>
            <option value="1">{copy('oneDay')}</option>
            <option value="7">{copy('sevenDays')}</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {copy('loadError')}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-label={copy('staffTitle')} className="space-y-2">
          {!rows.length && !error && <p className="text-muted-foreground">{copy('noWork')}</p>}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setSelectedId(row.id);
                setDetail(null);
                setReason('');
                setOfferKey(crypto.randomUUID());
              }}
              aria-pressed={selectedId === row.id}
              className={`w-full rounded-xl border bg-card p-4 text-start hover:border-primary ${selectedId === row.id ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <span className="block font-semibold" dir="auto">
                {row.product_snapshot.title[locale]}
              </span>
              <span className="mt-1 block text-sm" dir="auto">
                {row.profile_name}
              </span>
              <span className="mt-2 block text-sm text-muted-foreground">
                {copy(`status_${row.status}`)} · {copy(row.priority)} ·{' '}
                {new Intl.DateTimeFormat(locale).format(new Date(row.submitted_at))}
              </span>
            </button>
          ))}
        </section>
        <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={copy('details')}>
          {!current && <p className="text-muted-foreground">{copy('selectRequest')}</p>}
          {current && (
            <>
              <div>
                <h2 className="text-xl font-semibold" dir="auto">
                  {current.product_snapshot.title[locale]}
                </h2>
                <p>
                  {copy('customer')}: <span dir="auto">{current.profile_name}</span>
                </p>
                <p>
                  {copy('status')}: {copy(`status_${current.status}`)}
                </p>
                <p>
                  {copy('owner')}: {current.staff_owner_id ?? copy('unassigned')}
                </p>
                {current.staff_team && (
                  <p>
                    {copy('team')}: {current.staff_team}
                  </p>
                )}
              </div>
              {current.expected_next_step && (
                <p>
                  {copy('nextStep')}: <span dir="auto">{current.expected_next_step}</span>
                </p>
              )}
              {(current.status === 'under_review' || current.status === 'offer_pending') && (
                <div className="space-y-3 rounded-lg border p-4">
                  <h3 className="font-semibold">{copy('feeOffer')}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span>{copy('feeIrr')}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[1-9][0-9]*"
                        value={fee}
                        onChange={(event) => setFee(event.target.value)}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span>{copy('offerValidUntil')}</span>
                      <input
                        type="datetime-local"
                        value={validUntil}
                        onChange={(event) => setValidUntil(event.target.value)}
                        className="w-full rounded-md border bg-background p-2"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span>{copy('scope')}</span>
                    <textarea
                      value={scope}
                      onChange={(event) => setScope(event.target.value)}
                      maxLength={4000}
                      className="min-h-20 w-full rounded-md border bg-background p-2"
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>{copy('deliverables')}</span>
                    <textarea
                      value={deliverables}
                      onChange={(event) => setDeliverables(event.target.value)}
                      maxLength={4000}
                      className="min-h-20 w-full rounded-md border bg-background p-2"
                    />
                  </label>
                  {current.invoice_id && (
                    <label className="block space-y-1 text-sm">
                      <span>{copy('replaceReason')}</span>
                      <textarea
                        value={offerReason}
                        onChange={(event) => setOfferReason(event.target.value)}
                        maxLength={2000}
                        className="min-h-16 w-full rounded-md border bg-background p-2"
                      />
                    </label>
                  )}
                  <Button
                    disabled={
                      !/^[1-9][0-9]{0,18}$/.test(fee) ||
                      !scope.trim() ||
                      !deliverables.trim() ||
                      !validUntil ||
                      !Number.isFinite(new Date(validUntil).getTime()) ||
                      new Date(validUntil) <= new Date() ||
                      (!!current.invoice_id && !offerReason.trim())
                    }
                    onClick={() =>
                      prepare('fee', copy('issueFee'), {
                        idempotencyKey: offerKey,
                        fee,
                        scope: scope.trim(),
                        deliverables: deliverables.trim(),
                        validUntil: new Date(validUntil).toISOString(),
                        ...(current.invoice_id ? { reason: offerReason.trim() } : {}),
                      })
                    }
                  >
                    {copy(current.invoice_id ? 'replaceFee' : 'issueFee')}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => prepare('assign', copy('assignSelf'), { assignTo: 'self' })}
                >
                  {copy('assignSelf')}
                </Button>
                {current.status === 'submitted' && (
                  <Button onClick={() => prepare('review', copy('startReview'))}>
                    {copy('startReview')}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="consultation-team">{copy('team')}</Label>
                  <select
                    id="consultation-team"
                    value={team}
                    onChange={(event) => setTeam(event.target.value)}
                    className="w-full rounded-md border bg-background p-2"
                  >
                    <option value="">{copy('selectTeam')}</option>
                    {teams.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="outline"
                  disabled={!team.trim()}
                  onClick={() =>
                    prepare('assign', copy('assignTeam'), { assignTo: 'team', team: team.trim() })
                  }
                >
                  {copy('assignTeam')}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="consultation-reason">{copy('note')}</Label>
                <textarea
                  id="consultation-reason"
                  className="min-h-24 w-full rounded-md border bg-background p-2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={2000}
                />
                <div className="flex flex-wrap gap-2">
                  {current.status === 'under_review' && (
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() =>
                        prepare('request-info', copy('requestInfo'), { reason: reason.trim() })
                      }
                    >
                      {copy('requestInfo')}
                    </Button>
                  )}
                  {current.status === 'offer_accepted' && (
                    <Button
                      disabled={!reason.trim()}
                      onClick={() =>
                        prepare('complete', copy('complete'), { reason: reason.trim() })
                      }
                    >
                      {copy('complete')}
                    </Button>
                  )}
                  {!['completed', 'rejected', 'cancelled', 'offer_declined'].includes(
                    current.status
                  ) && (
                    <>
                      <Button
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => prepare('reject', copy('reject'), { reason: reason.trim() })}
                      >
                        {copy('reject')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => prepare('cancel', copy('cancel'), { reason: reason.trim() })}
                      >
                        {copy('cancel')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <section className="space-y-2">
                <h3 className="font-semibold">{copy('history')}</h3>
                <ol className="space-y-2 border-s-2 ps-3">
                  {detail.history.map((event, index) => (
                    <li key={`${event.created_at}-${index}`} className="rounded border p-2 text-sm">
                      <span className="font-medium">{copy(`status_${event.status}`)}</span> ·{' '}
                      {copy(`actor_${event.actor_type}`)}
                      <time
                        className="block text-xs text-muted-foreground"
                        dateTime={event.created_at}
                      >
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(event.created_at))}
                      </time>
                      {event.reason && <p dir="auto">{event.reason}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setReason('');
            setOfferKey(crypto.randomUUID());
            refresh();
          }}
        />
      )}
    </main>
  );
}
