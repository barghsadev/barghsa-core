import { sendToast, toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  LoadingStatus,
  PageHeader,
} from '@barghsa/ui';
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
  warned?: boolean;
}
function LifecyclePanel({ authorized }: { authorized: () => boolean }) {
  const client = useQueryClient();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const reader = useId();
  const readSequence = useRef(0);
  const reads = useRef(new Set<AbortController>());
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
  const commandRequest = useRef<AbortController | null>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
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
    const controller = new AbortController();
    const attempt = ++readSequence.current;
    const key = queryKeys.tickets.detail(
      { context: 'account', ownerId: actor ?? 'current-session', accountId: actor, revision },
      JSON.stringify([reader, 'lifecycle-preview', attempt])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    const abort = () => controller.abort();
    controller.signal.addEventListener('abort', cancel, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    reads.current.add(controller);
    try {
      if (!permitted() || signal?.aborted) throw new Error('Obsolete preview');
      const { response, raw } = await client.fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal: querySignal }) =>
          readWithDeadline(querySignal, async (transport) => {
            const response = await fetch('/api/tickets/lifecycle-preview', {
              credentials: 'include',
              signal: transport,
            });
            return { response, raw: response.ok ? ((await response.json()) as unknown) : null };
          }),
      });
      if (controller.signal.aborted || readSequence.current !== attempt) return null;
      if (!permitted() || signal?.aborted) return null;
      if (denied(response)) return null;
      if (!response.ok) throw new Error('Preview unavailable');
      const data = lifecyclePreview(raw);
      if (!permitted() || signal?.aborted) return null;
      if (!data || (command.current && data.profileId !== command.current.profileId))
        throw new Error('Invalid preview');
      setPreview(data);
      setState('ready');
      return data;
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      signal?.removeEventListener('abort', abort);
      reads.current.delete(controller);
    }
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
      commandRequest.current?.abort();
      for (const read of reads.current) read.abort();
      reads.current.clear();
    };
  }, []);
  useEffect(() => {
    if (submitError && !submitting) retryButton.current?.focus();
  }, [submitError, submitting]);
  async function run(next?: Command) {
    if (busy.current || !permitted() || (next && (command.current || state !== 'ready'))) return;
    if (next) command.current = next;
    const captured = command.current;
    if (!captured) return;
    const request = new AbortController();
    commandRequest.current = request;
    const post = (path: string, status: number, body?: string) =>
      readWithDeadline(request.signal, async (signal) => {
        const response = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          signal,
          headers:
            body === undefined ? withCsrf() : withCsrf({ 'Content-Type': 'application/json' }),
          ...(body === undefined ? {} : { body }),
        });
        const receipt: unknown = response.status === status ? await response.json() : null;
        return { response, receipt };
      });
    busy.current = true;
    setSubmitting(captured.type);
    setSubmitError(false);
    try {
      if (captured.stage === 'request') {
        const { response, receipt } = await post(
          '/api/tickets/lifecycle-requests',
          201,
          JSON.stringify(captured.body)
        );
        if (!permitted() || denied(response)) return;
        if (response.status !== 201) throw new Error('Request failed');
        if (!lifecycleRequestReceipt(receipt, captured.profileId, captured.type))
          throw new Error('Invalid receipt');
        captured.ticketId = receipt.ticketId;
        captured.stage = captured.type === 'export' ? 'export' : 'read';
      }
      if (captured.stage === 'export') {
        const { response, receipt } = await post(
          `/api/tickets/lifecycle-requests/${captured.ticketId}/export`,
          202
        );
        if (!permitted() || denied(response)) return;
        if (response.status !== 202) throw new Error('Export could not be queued');
        if (!lifecycleExportReceipt(receipt, captured.ticketId!))
          throw new Error('Invalid export receipt');
        captured.jobId = receipt.jobId;
        captured.stage = 'read';
      }
      const data = await refresh(request.signal);
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
      toast.success(confirmationText('recorded', locale));
    } catch {
      if (permitted()) {
        setPending(true);
        setSubmitError(true);
        if (!captured.warned) {
          captured.warned = true;
          sendToast('warning', lifecycleFormText('uncertain', locale));
        }
      }
    } finally {
      commandRequest.current = null;
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
  const blockers = preview?.blockers.filter((blocker) => blocker.count > 0) ?? [];
  const clearChecks = preview?.blockers.filter((blocker) => blocker.count === 0) ?? [];
  return (
    <div
      data-slot="profile-lifecycle"
      className="mx-auto flex max-w-5xl flex-col gap-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <PageHeader
        title={t('settings.privacy.title', locale)}
        description={t('settings.privacy.intro', locale)}
      />
      {state === 'loading' && (
        <LoadingStatus>{t('settings.privacy.loading', locale)}</LoadingStatus>
      )}
      {state === 'error' && (
        <Alert variant="destructive">
          <AlertDescription>{t('settings.privacy.error', locale)}</AlertDescription>
          <Button
            type="button"
            variant="outline"
            disabled={submitting !== null}
            onClick={() => {
              if (busy.current || !permitted()) return;
              busy.current = true;
              setState('loading');
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
        </Alert>
      )}
      {state === 'ownerOnly' && (
        <Alert>
          <AlertDescription>{t('settings.privacy.ownerOnly', locale)}</AlertDescription>
        </Alert>
      )}
      {state === 'ready' && preview && (
        <>
          {pending && (
            <div className="space-y-3 rounded-lg border bg-card p-4">
              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {lifecycleFormText('uncertain', locale)}
                </p>
              )}
              <Button
                ref={retryButton}
                type="button"
                variant="outline"
                loading={submitting !== null}
                onClick={() => void run()}
              >
                {lifecycleFormText('retry', locale)}
              </Button>
            </div>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-2">
            <div className="min-w-0 space-y-5">
              <Card>
                <CardContent className="space-y-3">
                  <h2 className="text-lg font-semibold">
                    {t('settings.privacy.export.title', locale)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.privacy.export.description', locale)}
                  </p>
                  <Button
                    type="button"
                    disabled={submitting !== null || pending}
                    loading={submitting === 'export' && !pending && !!command.current?.body}
                    onClick={() => void request('export')}
                  >
                    {t('settings.privacy.export.action', locale)}
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3">
                  <h2 id="profile-lifecycle-requests" className="text-lg font-semibold">
                    {t('settings.privacy.requests', locale)}
                  </h2>
                  {preview.requests.length ? (
                    <ul className="space-y-2" aria-labelledby="profile-lifecycle-requests">
                      {preview.requests.map((item) => (
                        <li key={item.ticketId} className="space-y-3 rounded-lg border p-3">
                          <a
                            className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-sm"
                            href={`/tickets?ticketId=${item.ticketId}`}
                          >
                            <span className="text-sm text-primary underline underline-offset-4">
                              {t(`settings.privacy.${item.type}.title`, locale)}
                            </span>
                            <Badge>{t(`tickets.${item.status}`, locale)}</Badge>
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
                              loading={
                                submitting === 'export' &&
                                !pending &&
                                command.current?.body === null &&
                                command.current.ticketId === item.ticketId
                              }
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
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {lifecycleFormText('noRequests', locale)}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardContent className="space-y-4">
                <h2 className="text-lg font-semibold">
                  {t('settings.privacy.closure.title', locale)}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('settings.privacy.closure.description', locale)}
                </p>
                {blockers.length > 0 ? (
                  <ul className="space-y-2">
                    {blockers.map((blocker) => (
                      <li key={blocker.code} className="space-y-2 rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong>{t(`settings.privacy.blocker.${blocker.code}`, locale)}</strong>
                          <Badge variant="warning">
                            {t('settings.privacy.blocked', locale).replace(
                              '{count}',
                              numbers.number(blocker.count)
                            )}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground">
                          {t(`settings.privacy.owner.${blocker.owner}`, locale)}
                        </p>
                        <p>{t(`settings.privacy.step.${blocker.nextStep}`, locale)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('settings.privacy.clear', locale)}
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting !== null || pending}
                  loading={submitting === 'closure' && !pending}
                  onClick={() => void request('closure')}
                >
                  {t('settings.privacy.closure.action', locale)}
                </Button>
                {clearChecks.length > 0 && (
                  <details className="rounded-lg border text-sm">
                    <summary className="min-h-11 cursor-pointer px-3 py-2.5 font-medium">
                      {lifecycleFormText('clearChecks', locale).replace(
                        '{count}',
                        numbers.number(clearChecks.length)
                      )}
                    </summary>
                    <ul className="divide-y border-t px-3">
                      {clearChecks.map((blocker) => (
                        <li key={blocker.code} className="py-2 text-muted-foreground">
                          {t(`settings.privacy.blocker.${blocker.code}`, locale)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
