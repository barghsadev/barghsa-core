import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { lifecycleFormText } from '@barghsa/i18n/profile-lifecycle-forms';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { withCsrf } from '../lib/csrf.js';
import {
  lifecyclePreview,
  lifecycleRequestReceipt,
  lifecycleExportReceipt,
  type LifecyclePreview,
  type LifecycleType,
} from '../lib/profile-lifecycle-form.js';
import { JobProgress } from './jobs/JobProgress.js';
export function ProfileLifecyclePanel() {
  const actor = useAccountUser(),
    revision = useProfileContextRevision(),
    current = useRef(actor);
  current.current = actor;
  return (
    <LifecyclePanel
      key={String(actor) + ':' + revision}
      authorized={() =>
        !!actor && current.current === actor && getProfileContextRevision() === revision
      }
    />
  );
}
interface Command {
  type: LifecycleType;
  profileId: string;
  body: { type: LifecycleType; idempotencyKey: string; locale: 'fa' | 'en' } | null;
  ticketId: string | null;
  jobId: string | null;
  stage: 'request' | 'export' | 'read';
}
function LifecyclePanel({ authorized }: { authorized: () => boolean }) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const [preview, setPreview] = useState<LifecyclePreview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'ownerOnly'>('loading');
  const [submitting, setSubmitting] = useState<LifecycleType | null>(null);
  const [submitError, setSubmitError] = useState(false),
    [pending, setPending] = useState(false);
  const command = useRef<Command | null>(null),
    busy = useRef(false),
    alive = useRef(true);
  const permitted = () => alive.current && authorized();
  function denied(response: Response) {
    if (![401, 403].includes(response.status) || !permitted()) return false;
    command.current = null;
    setPending(false);
    setPreview(null);
    setState('ownerOnly');
    return true;
  }
  async function refresh(signal?: AbortSignal): Promise<LifecyclePreview | null> {
    const response = await fetch('/api/tickets/lifecycle-preview', {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
    if (!permitted() || signal?.aborted) return null;
    if (denied(response)) return null;
    if (!response.ok) throw new Error('Preview unavailable');
    const data = lifecyclePreview(await response.json());
    if (!permitted() || signal?.aborted) return null;
    if (!data || (command.current && data.profileId !== command.current.profileId))
      throw new Error('Invalid preview');
    setPreview(data);
    setState('ready');
    return data;
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    if (!authorized()) setState('ownerOnly');
    else
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted && permitted()) setState('error');
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);
  async function run(next?: Command) {
    if (busy.current || !permitted() || (next && (command.current || state !== 'ready'))) return;
    if (next) command.current = next;
    const captured = command.current;
    if (!captured) return;
    busy.current = true;
    setSubmitting(captured.type);
    setSubmitError(false);
    try {
      if (captured.stage === 'request') {
        const response = await fetch('/api/tickets/lifecycle-requests', {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(captured.body),
        });
        if (!permitted() || denied(response)) return;
        if (response.status !== 201) throw new Error('Request failed');
        const receipt: unknown = await response.json();
        if (!permitted()) return;
        if (!lifecycleRequestReceipt(receipt, captured.profileId, captured.type))
          throw new Error('Invalid receipt');
        captured.ticketId = receipt.ticketId;
        captured.stage = captured.type === 'export' ? 'export' : 'read';
      }
      if (captured.stage === 'export') {
        const response = await fetch(
          `/api/tickets/lifecycle-requests/${captured.ticketId}/export`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf(),
          }
        );
        if (!permitted() || denied(response)) return;
        if (response.status !== 202) throw new Error('Export could not be queued');
        const receipt: unknown = await response.json();
        if (!permitted()) return;
        if (!lifecycleExportReceipt(receipt, captured.ticketId!))
          throw new Error('Invalid export receipt');
        captured.jobId = receipt.jobId;
        captured.stage = 'read';
      }
      const data = await refresh();
      if (!permitted() || !data) return;
      if (
        !data.requests.some(
          (r) =>
            r.ticketId === captured.ticketId &&
            r.type === captured.type &&
            (!captured.jobId || r.exportJobId === captured.jobId)
        )
      )
        throw new Error('Request not visible');
      command.current = null;
      setPending(false);
    } catch {
      if (permitted()) {
        setPending(true);
        setSubmitError(true);
      }
    } finally {
      busy.current = false;
      if (permitted()) setSubmitting(null);
    }
  }
  function request(type: LifecycleType) {
    if (!preview || command.current || busy.current || !permitted()) return;
    void run({
      type,
      profileId: preview.profileId,
      body: { type, idempotencyKey: crypto.randomUUID(), locale },
      ticketId: null,
      jobId: null,
      stage: 'request',
    });
  }
  function startExport(ticketId: string) {
    if (
      !preview ||
      command.current ||
      busy.current ||
      !permitted() ||
      !preview.requests.some(
        (r) => r.ticketId === ticketId && r.type === 'export' && !r.exportJobId
      )
    )
      return;
    void run({
      type: 'export',
      profileId: preview.profileId,
      body: null,
      ticketId,
      jobId: null,
      stage: 'export',
    });
  }
  return (
    <main
      data-slot="profile-lifecycle"
      className="container mx-auto max-w-3xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{t('settings.privacy.title', locale)}</h1>
      <p className="text-muted-foreground">{t('settings.privacy.intro', locale)}</p>
      {state === 'loading' && <p role="status">{t('settings.privacy.loading', locale)}</p>}
      {state === 'error' && (
        <div role="alert">
          <p>{t('settings.privacy.error', locale)}</p>
          <Button
            type="button"
            disabled={submitting !== null}
            onClick={() => {
              if (busy.current || !permitted()) return;
              busy.current = true;
              setSubmitting('closure');
              void refresh()
                .catch(() => {
                  if (permitted()) setState('error');
                })
                .finally(() => {
                  busy.current = false;
                  if (permitted()) setSubmitting(null);
                });
            }}
          >
            {lifecycleFormText('refresh', locale)}
          </Button>
        </div>
      )}
      {state === 'ownerOnly' && <p role="alert">{t('settings.privacy.ownerOnly', locale)}</p>}
      {state === 'ready' && preview && (
        <>
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="text-lg font-semibold">
                {t('settings.privacy.export.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.privacy.export.description', locale)}
              </p>
              <Button
                type="button"
                disabled={submitting !== null || pending}
                onClick={() => void request('export')}
              >
                {t('settings.privacy.export.action', locale)}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4 pt-6">
              <h2 className="text-lg font-semibold">
                {t('settings.privacy.closure.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.privacy.closure.description', locale)}
              </p>
              <ul className="space-y-2">
                {preview.blockers.map((blocker) => (
                  <li key={blocker.code} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>{t(`settings.privacy.blocker.${blocker.code}`, locale)}</strong>
                      <span
                        className={blocker.count > 0 ? 'text-destructive' : 'text-muted-foreground'}
                      >
                        {blocker.count > 0
                          ? t('settings.privacy.blocked', locale).replace(
                              '{count}',
                              numbers.number(blocker.count)
                            )
                          : t('settings.privacy.clear', locale)}
                      </span>
                    </div>
                    {blocker.count > 0 && (
                      <p className="mt-1 text-muted-foreground">
                        {t(`settings.privacy.owner.${blocker.owner}`, locale)} ·{' '}
                        {t(`settings.privacy.step.${blocker.nextStep}`, locale)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                disabled={submitting !== null || pending}
                onClick={() => void request('closure')}
              >
                {t('settings.privacy.closure.action', locale)}
              </Button>
            </CardContent>
          </Card>
          {submitError && (
            <p role="alert" className="text-destructive">
              {pending
                ? lifecycleFormText('uncertain', locale)
                : t('settings.privacy.submitError', locale)}
            </p>
          )}
          {pending && (
            <Button type="button" disabled={submitting !== null} onClick={() => void run()}>
              {lifecycleFormText('retry', locale)}
            </Button>
          )}
          {preview.requests.length > 0 && (
            <section className="space-y-2" aria-label={t('settings.privacy.requests', locale)}>
              <h2 className="text-lg font-semibold">{t('settings.privacy.requests', locale)}</h2>
              <ul className="space-y-2">
                {preview.requests.map((item) => (
                  <li key={item.ticketId} className="space-y-2 rounded-lg border p-3">
                    <a
                      className="text-primary underline underline-offset-2"
                      href={`/tickets?ticketId=${item.ticketId}`}
                    >
                      {t(`settings.privacy.${item.type}.title`, locale)} ·{' '}
                      {t(`tickets.${item.status}`, locale)}
                    </a>
                    {item.type === 'export' &&
                      item.exportJobId &&
                      (item.exportExpiresAt &&
                      new Date(item.exportExpiresAt).getTime() <= Date.now() ? (
                        <p className="text-sm text-muted-foreground">
                          {t('settings.privacy.export.expired', locale)}
                        </p>
                      ) : (
                        <JobProgress jobId={item.exportJobId} />
                      ))}
                    {item.type === 'export' && !item.exportJobId && (
                      <Button
                        type="button"
                        disabled={submitting !== null || pending}
                        onClick={() => {
                          startExport(item.ticketId);
                        }}
                      >
                        {t('settings.privacy.export.prepare', locale)}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
