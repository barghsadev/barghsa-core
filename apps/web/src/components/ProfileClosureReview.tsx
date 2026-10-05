import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { withCsrf } from '../lib/csrf.js';
import type { TicketCoordination } from '../lib/ticket-form.js';

interface ClosurePreview {
  eligible: boolean;
  completedAt: string | null;
  anonymizeProfile: boolean;
  blockers: { code: string; count: number }[];
  retained: Record<string, number>;
  exportTicketId: string | null;
  previewVersion: string;
}

export function ProfileClosureReview({
  ticketId,
  locale,
  onCompleted,
  coordination,
  disabled = false,
}: {
  ticketId: string;
  locale: 'fa' | 'en';
  onCompleted: () => void;
  coordination?: TicketCoordination | undefined;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const inFlight = useRef(false),
    current = useRef(ticketId),
    alive = useRef(true);
  current.current = ticketId;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const permitted = () =>
    alive.current && current.current === ticketId && (!coordination || coordination.isCurrent());
  async function refresh(signal?: AbortSignal) {
    if (coordination?.isLocked('closure')) return;
    setLoading(true);
    setError(false);
    setConfirmed(false);
    try {
      const response = await fetch(`/api/staff/tickets/${ticketId}/closure-preview`, {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
      if (
        coordination &&
        !signal?.aborted &&
        permitted() &&
        [401, 403, 404].includes(response.status)
      ) {
        coordination.denied();
        return;
      }
      if (!response.ok) throw new Error();
      const data = (await response.json()) as ClosurePreview;
      if (!signal?.aborted && permitted()) setPreview(data);
    } catch {
      if (!signal?.aborted && permitted()) setError(true);
    } finally {
      if (!signal?.aborted && permitted()) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [ticketId]);
  async function reviewRefresh() {
    if (
      disabled ||
      inFlight.current ||
      !permitted() ||
      (coordination && !coordination.claim('closure'))
    )
      return;
    inFlight.current = true;
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      coordination?.release('closure');
    }
  }
  async function execute(event: FormEvent) {
    event.preventDefault();
    if (
      !preview?.eligible ||
      !confirmed ||
      !password ||
      busy ||
      disabled ||
      inFlight.current ||
      !permitted() ||
      (coordination && !coordination.claim('closure'))
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const stepUp = await fetch('/api/auth/step-up', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      if (!permitted()) return;
      setPassword('');
      if (coordination && stepUp.status === 401) {
        coordination.denied();
        return;
      }
      if (!stepUp.ok) throw new Error();
      const response = await fetch(`/api/staff/tickets/${ticketId}/execute-closure`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          previewVersion: preview.previewVersion,
          confirmation: 'CLOSE_PROFILE',
        }),
      });
      if (!permitted()) return;
      if (coordination && [401, 403, 404].includes(response.status)) {
        coordination.denied();
        return;
      }
      if (!response.ok) throw new Error();
      await refresh();
      if (permitted()) onCompleted();
    } catch {
      if (permitted()) setError(true);
    } finally {
      inFlight.current = false;
      if (permitted()) setBusy(false);
      coordination?.release('closure');
    }
  }
  const label = (key: string) => t(`tickets.closure.${key}`, locale);
  return (
    <section className="space-y-3 rounded border p-4" aria-label={label('review')}>
      <fieldset disabled={disabled || busy} className="contents">
        <h3 className="font-semibold">{label('review')}</h3>
        {loading && <p role="status">{t('settings.privacy.loading', locale)}</p>}
        {error && <p role="alert">{label('failure')}</p>}
        {preview && !loading && (
          <>
            {preview.completedAt && <p role="status">{label('completed')}</p>}
            <p>{label('consequences')}</p>
            <p>{label(preview.anonymizeProfile ? 'redacted' : 'retainedIdentity')}</p>
            <h4 className="font-medium">{label('retained')}</h4>
            <ul className="list-disc ps-5">
              <li>{label('supportHistory')}</li>
              {Object.entries(preview.retained)
                .filter(([, count]) => count > 0)
                .map(([key, count]) => (
                  <li key={key}>
                    {label(`record.${key}`)}: {count}
                  </li>
                ))}
            </ul>
            {preview.exportTicketId ? (
              <a
                className="text-primary underline underline-offset-2"
                href={`/admin/tickets?ticketId=${encodeURIComponent(preview.exportTicketId)}`}
              >
                {label('export')} · {preview.exportTicketId}
              </a>
            ) : (
              <p>{label('noExport')}</p>
            )}
            {preview.blockers.filter((item) => item.count > 0 && item.code !== 'securityReview')
              .length > 0 && (
              <div role="alert" className="space-y-1">
                <p>{label('blocked')}</p>
                <ul className="list-disc ps-5">
                  {preview.blockers
                    .filter((item) => item.count > 0 && item.code !== 'securityReview')
                    .map((item) => (
                      <li key={item.code}>
                        {t(`settings.privacy.blocker.${item.code}`, locale)}: {item.count}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {!preview.completedAt && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reviewRefresh()}
                >
                  {label('refresh')}
                </Button>
                {preview.eligible && (
                  <form onSubmit={(event) => void execute(event)} className="space-y-3">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      {label('confirm')}
                    </label>
                    <div>
                      <Label htmlFor="closure-password">{label('password')}</Label>
                      <Input
                        id="closure-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={busy || !confirmed || !password}>
                      {label('execute')}
                    </Button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
