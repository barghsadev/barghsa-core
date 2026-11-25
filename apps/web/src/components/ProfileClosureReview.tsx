import { sendToast, toast } from '../lib/toast-api.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadingStatus } from '@barghsa/ui';
import { Archive, CircleCheck, TriangleAlert } from 'lucide-react';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { t } from '@barghsa/i18n/app';
import { lifecycleFormText } from '@barghsa/i18n/profile-lifecycle-forms';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useTicketFormFeedback } from '../hooks/useTicketFormFeedback.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { withCsrf } from '../lib/csrf.js';
import { securityStepUpReceipt } from '../lib/security-settings-form.js';
import {
  closurePreview,
  closureReceipt,
  type ClosurePreview,
  type ClosureValues,
} from '../lib/profile-lifecycle-form.js';
import type { TicketCoordination } from '../lib/ticket-form.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from './RecordEditorLayout.js';
interface Props {
  ticketId: string;
  locale: 'fa' | 'en';
  onCompleted: () => void;
  coordination?: TicketCoordination | undefined;
  disabled?: boolean;
  dedicated?: boolean;
}
export function ProfileClosureReview(props: Props) {
  const actor = useAccountUser(),
    scope = String(actor) + ':' + props.ticketId,
    current = useRef(scope);
  current.current = scope;
  return (
    <ClosureReview
      key={String(actor) + ':' + props.ticketId}
      {...props}
      authorized={() => !!actor && current.current === scope}
    />
  );
}
function ClosureReview({
  ticketId,
  locale,
  onCompleted,
  coordination,
  disabled = false,
  dedicated = false,
  authorized,
}: Props & { authorized: () => boolean }) {
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<'' | 'failure' | 'unknown' | 'changed' | 'read'>('');
  const [pending, setPending] = useState<ClosurePreview | null>(null);
  const read = useRef<AbortController | null>(null);
  const inFlight = useRef(false),
    held = useRef(false),
    alive = useRef(true),
    version = useRef('');
  const permitted = () =>
    alive.current && authorized() && (!coordination || coordination.isCurrent());
  const copy = (key: Parameters<typeof lifecycleFormText>[0]) => lifecycleFormText(key, locale);
  const locked = busy || (disabled && !held.current);
  const form = useZodForm<ClosureValues>(
    async () => {
      const token = version.current;
      const schema = await import('../lib/account-settings-form-schemas.js');
      return permitted() && version.current === token
        ? schema.profileClosureSchema(copy)
        : schema.inactiveClosureSchema;
    },
    {
      defaultValues: { confirmed: false, password: '' },
      validationUnavailableMessage: copy('validationUnavailable'),
    }
  );
  const feedback = useTicketFormFeedback(
    form,
    ticketId + ':' + version.current,
    locked,
    coordination,
    { confirmed: copy('confirmationRequired'), password: copy('passwordRequired') },
    copy('validationUnavailable')
  );
  function release() {
    held.current = false;
    coordination?.release('closure');
  }
  function denied(response: Response, stepUp = false) {
    if (!(stepUp ? [401] : [401, 403, 404]).includes(response.status) || !permitted()) return false;
    setPreview(null);
    setPending(null);
    form.reset({ confirmed: false, password: '' });
    setError('failure');
    release();
    coordination?.denied();
    return true;
  }
  function complete(receipt: ClosurePreview) {
    setPreview(receipt);
    setPending(null);
    setError('');
    version.current = receipt.previewVersion;
    form.reset({ confirmed: false, password: '' });
    release();
    onCompleted();
  }
  async function refresh() {
    if (!permitted() || coordination?.isLocked('closure')) return;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const { signal } = controller;
    setLoading(true);
    try {
      const data = await readWithDeadline(signal, async (transport) => {
        const response = await fetch(`/api/staff/tickets/${ticketId}/closure-preview`, {
          credentials: 'include',
          signal: transport,
        });
        if (!permitted() || transport.aborted || denied(response)) return null;
        if (response.status !== 200) throw new Error('Preview unavailable');
        const parsed = closurePreview(await response.json(), ticketId);
        if (!parsed) throw new Error('Invalid closure preview');
        return parsed;
      });
      if (!permitted() || signal.aborted || !data) return;
      setPreview(data);
      setError('');
      version.current = data.previewVersion;
      form.reset({ ...form.getValues(), confirmed: false });
    } catch {
      if (!signal.aborted && permitted()) {
        setPreview(null);
        setError('read');
      }
    } finally {
      if (read.current === controller) read.current = null;
      if (!signal.aborted && permitted()) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      read.current?.abort();
      if (held.current) release();
    };
  }, []);
  async function reviewRefresh() {
    if (
      disabled ||
      inFlight.current ||
      pending ||
      !permitted() ||
      (coordination && !coordination.claim('closure'))
    )
      return;
    held.current = true;
    inFlight.current = true;
    setBusy(true);
    try {
      await refresh();
    } finally {
      inFlight.current = false;
      release();
      if (permitted()) setBusy(false);
    }
  }
  async function send(source: ClosurePreview, password: string) {
    let writing = false,
      settled = false;
    try {
      const stepUp = await fetch('/api/auth/step-up', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password }),
      });
      if (!permitted() || denied(stepUp, true)) return;
      if (stepUp.status === 422)
        form.setError('password', { type: 'server', message: copy('passwordRejected') });
      if (stepUp.status !== 200 || !securityStepUpReceipt(await stepUp.json()))
        throw new Error('Step-up failed');
      if (!permitted()) return;
      form.clearErrors('password');
      writing = true;
      const response = await fetch(`/api/staff/tickets/${ticketId}/execute-closure`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          previewVersion: source.previewVersion,
          confirmation: 'CLOSE_PROFILE',
        }),
      });
      if (!permitted() || denied(response)) return;
      if (response.status === 409) {
        setPending(null);
        setError('changed');
        release();
        return;
      }
      if ([400, 422].includes(response.status)) {
        setPending(null);
        setError('failure');
        release();
        return;
      }
      if (response.status !== 200) throw new Error('Closure result unknown');
      const receipt = closureReceipt(await response.json(), source);
      if (!permitted()) return;
      if (!receipt) throw new Error('Invalid closure receipt');
      settled = true;
      if (!dedicated) toast.success(confirmationText('recorded', locale));
      complete(receipt);
    } catch {
      if (permitted()) {
        if (writing && !settled) {
          setPending(source);
          setError('unknown');
          if (!pending) sendToast('warning', copy('uncertain'));
        } else setError(pending ? 'unknown' : 'failure');
      }
    } finally {
      inFlight.current = false;
      if (permitted()) setBusy(false);
      if (!writing && !pending) release();
    }
  }
  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      disabled ||
      inFlight.current ||
      pending ||
      !preview?.eligible ||
      error === 'changed' ||
      !permitted() ||
      (coordination && !coordination.claim('closure'))
    )
      return;
    inFlight.current = true;
    held.current = true;
    setBusy(true);
    setError('');
    const raw = { ...form.getValues() },
      source = preview;
    let validated = false;
    try {
      await form.handleSubmit(async () => {
        if (
          !permitted() ||
          version.current !== source.previewVersion ||
          form.getValues('confirmed') !== raw.confirmed ||
          form.getValues('password') !== raw.password
        )
          return;
        validated = true;
        await send(source, raw.password);
      }, feedback.invalid)(event);
    } catch {
      if (permitted()) setError('failure');
    } finally {
      if (!validated) {
        inFlight.current = false;
        release();
        if (permitted()) setBusy(false);
      }
    }
  }
  async function retry() {
    if (!pending || inFlight.current || !permitted() || coordination?.isLocked('closure')) return;
    const password = form.getValues('password');
    if (!password) {
      setError('unknown');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    await send(pending, password);
  }
  const label = (key: string) => t(`tickets.closure.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const blockers =
    preview?.blockers.filter((item) => item.count > 0 && item.code !== 'securityReview') ?? [];
  return (
    <section
      data-slot="profile-closure-review"
      className={recordEditorSurface}
      aria-label={label('review')}
    >
      <fieldset disabled={locked} className="contents">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-primary">
              <Archive aria-hidden="true" className="size-4" />
            </span>
            {dedicated ? (
              <h2 className="text-base leading-snug font-semibold">{copy('reviewChecks')}</h2>
            ) : (
              <h3 className="text-base leading-snug font-semibold">{label('review')}</h3>
            )}
          </div>
          {!loading && (error === 'read' || (preview && !preview.completedAt)) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-w-full whitespace-normal"
              disabled={busy || !!pending}
              onClick={() => void reviewRefresh()}
            >
              {label('refresh')}
            </Button>
          )}
        </header>
        {(loading || error || pending) && (
          <div className="space-y-2 px-4 pt-3 pb-2">
            {loading && <LoadingStatus>{t('settings.privacy.loading', locale)}</LoadingStatus>}
            {error && (
              <p
                role="alert"
                className="rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive"
              >
                {error === 'unknown'
                  ? copy('uncertain')
                  : error === 'changed'
                    ? copy('changed')
                    : error === 'read'
                      ? t('settings.privacy.error', locale)
                      : label('failure')}
              </p>
            )}
            {pending && (
              <Button
                type="button"
                data-ticket-command-retry
                disabled={busy || !permitted()}
                onClick={() => void retry()}
              >
                {copy('retry')}
              </Button>
            )}
          </div>
        )}
        {preview && !loading && (
          <>
            <div className="space-y-3.5 px-4 py-4 text-sm sm:px-6">
              {preview.completedAt && (
                <p
                  role="status"
                  className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-success"
                >
                  <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                  {dedicated ? copy('completedReview') : label('completed')}
                </p>
              )}
              {dedicated &&
                preview.eligible &&
                !pending &&
                error !== 'changed' &&
                !preview.completedAt && (
                  <p className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 font-medium text-success">
                    <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
                    {copy('readyForConfirmation')}
                  </p>
                )}
              {dedicated && !preview.eligible && !preview.completedAt && blockers.length === 0 && (
                <p
                  role="alert"
                  className="rounded-lg bg-warning-soft px-3 py-2 font-medium text-warning"
                >
                  {copy('blockedClosure')}
                </p>
              )}
              {blockers.length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2.5"
                >
                  <p className="flex items-center gap-2 font-medium text-warning">
                    <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
                    {label('blocked')}
                  </p>
                  <ul className="mt-2 divide-y divide-warning/20">
                    {blockers.map((item) => (
                      <li key={item.code} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <strong className="font-medium">
                            {t(`settings.privacy.blocker.${item.code}`, locale)}
                          </strong>
                          <Badge variant="warning">{numbers.number(item.count)}</Badge>
                        </div>
                        <p>{t(`settings.privacy.step.${item.nextStep}`, locale)}</p>
                        <p className="text-xs text-muted-foreground">
                          {t(`settings.privacy.owner.${item.owner}`, locale)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className={dedicated ? 'grid gap-4 sm:grid-cols-2 sm:items-start' : 'space-y-3'}>
                <div className="space-y-1.5">
                  <h3 className="font-semibold">{copy('consequencesTitle')}</h3>
                  <p className="leading-relaxed text-muted-foreground">{label('consequences')}</p>
                  <p className="leading-relaxed text-muted-foreground">
                    {label(preview.anonymizeProfile ? 'redacted' : 'retainedIdentity')}
                  </p>
                </div>
                <div className="space-y-1.5 rounded-lg bg-muted/45 px-3 py-2.5">
                  <h3 className="font-semibold">{label('retained')}</h3>
                  <p className="text-muted-foreground">{label('supportHistory')}</p>
                  <dl className="empty:hidden">
                    {Object.entries(preview.retained)
                      .filter(([, count]) => count > 0)
                      .map(([key, count]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between gap-2 border-t py-1.5 first:mt-1 last:pb-0"
                        >
                          <dt>{label(`record.${key}`)}</dt>
                          <dd className="font-medium tabular-nums">{numbers.number(count)}</dd>
                        </div>
                      ))}
                  </dl>
                </div>
              </div>
              {preview.exportTicketId ? (
                <a
                  className="inline-flex min-h-9 flex-wrap items-center gap-x-2 text-primary underline underline-offset-2"
                  href={`/admin/tickets/${encodeURIComponent(preview.exportTicketId)}`}
                >
                  {label('export')}
                  <bdi className="break-all text-xs">{preview.exportTicketId}</bdi>
                </a>
              ) : (
                <p className="text-muted-foreground">{label('noExport')}</p>
              )}
            </div>
            {!preview.completedAt && preview.eligible && error !== 'changed' && (
              <Form {...form}>
                <form
                  key={preview.previewVersion}
                  ref={feedback.element}
                  onSubmit={execute}
                  noValidate
                  className="border-t"
                  aria-busy={busy}
                >
                  <RecordEditorSection
                    title={copy('confirmationTitle')}
                    description={copy('confirmationHelp')}
                  >
                    <FormField
                      control={form.control}
                      name="confirmed"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="touch-label flex min-h-11 items-center gap-2 rounded-lg bg-muted/45 px-3 py-2 leading-relaxed">
                            <FormControl>
                              <input
                                type="checkbox"
                                aria-required="true"
                                name={field.name}
                                ref={field.ref}
                                className="shrink-0"
                                checked={field.value}
                                disabled={!!pending}
                                onBlur={field.onBlur}
                                onChange={(event) => field.onChange(event.target.checked)}
                              />
                            </FormControl>
                            {label('confirm')}
                          </FormLabel>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem id="closure-password" className={`${recordEditorField} max-w-xs`}>
                          <FormLabel>{label('password')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              aria-required="true"
                              autoComplete="current-password"
                              data-ticket-command-retry={pending ? true : undefined}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </RecordEditorSection>
                  <RecordEditorActions>
                    <Button
                      type="submit"
                      variant="destructive"
                      className="h-auto min-h-11 min-w-0 whitespace-normal"
                      loading={busy && !pending}
                      disabled={busy || !!pending}
                    >
                      {label('execute')}
                    </Button>
                  </RecordEditorActions>
                </form>
              </Form>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
