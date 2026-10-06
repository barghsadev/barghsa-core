import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Input } from '@barghsa/ui';
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
import { useTicketFormFeedback } from '../hooks/useTicketFormFeedback.js';
import { withCsrf } from '../lib/csrf.js';
import { securityStepUpReceipt } from '../lib/security-settings-form.js';
import {
  closurePreview,
  closureReceipt,
  type ClosurePreview,
  type ClosureValues,
} from '../lib/profile-lifecycle-form.js';
import type { TicketCoordination } from '../lib/ticket-form.js';
interface Props {
  ticketId: string;
  locale: 'fa' | 'en';
  onCompleted: () => void;
  coordination?: TicketCoordination | undefined;
  disabled?: boolean;
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
  authorized,
}: Props & { authorized: () => boolean }) {
  const [preview, setPreview] = useState<ClosurePreview | null>(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<'' | 'failure' | 'unknown' | 'changed'>('');
  const [pending, setPending] = useState<ClosurePreview | null>(null);
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
      const schema = await import('../lib/contract-review-signature-form-schemas.js');
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
  async function refresh(signal?: AbortSignal) {
    if (!permitted() || coordination?.isLocked('closure')) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/staff/tickets/${ticketId}/closure-preview`, {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      });
      if (!permitted() || signal?.aborted || denied(response)) return;
      if (response.status !== 200) throw new Error('Preview unavailable');
      const data = closurePreview(await response.json(), ticketId);
      if (!permitted() || signal?.aborted) return;
      if (!data) throw new Error('Invalid closure preview');
      setPreview(data);
      setError('');
      version.current = data.previewVersion;
      form.reset({ ...form.getValues(), confirmed: false });
    } catch {
      if (!signal?.aborted && permitted()) setError('failure');
    } finally {
      if (!signal?.aborted && permitted()) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      alive.current = false;
      controller.abort();
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
      complete(receipt);
    } catch {
      if (permitted()) {
        if (writing && !settled) {
          setPending(source);
          setError('unknown');
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
  return (
    <section
      data-slot="profile-closure-review"
      className="space-y-3 rounded border p-4"
      aria-label={label('review')}
    >
      <fieldset disabled={locked} className="contents">
        <h3 className="font-semibold">{label('review')}</h3>
        {loading && <p role="status">{t('settings.privacy.loading', locale)}</p>}
        {error && (
          <p role="alert">
            {error === 'unknown'
              ? copy('uncertain')
              : error === 'changed'
                ? copy('changed')
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
                        <p className="text-sm text-muted-foreground">
                          {t(`settings.privacy.owner.${item.owner}`, locale)} ·{' '}
                          {t(`settings.privacy.step.${item.nextStep}`, locale)}
                        </p>
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
                  disabled={busy || !!pending}
                  onClick={() => void reviewRefresh()}
                >
                  {label('refresh')}
                </Button>
                {preview.eligible && error !== 'changed' && (
                  <Form {...form}>
                    <form
                      key={preview.previewVersion}
                      ref={feedback.element}
                      onSubmit={execute}
                      noValidate
                      className="space-y-3"
                      aria-busy={busy}
                    >
                      <FormField
                        control={form.control}
                        name="confirmed"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-start gap-2">
                              <FormControl>
                                <input
                                  id="closure-confirmed"
                                  type="checkbox"
                                  name={field.name}
                                  ref={field.ref}
                                  checked={field.value}
                                  disabled={!!pending}
                                  onBlur={field.onBlur}
                                  onChange={(event) => field.onChange(event.target.checked)}
                                />
                              </FormControl>
                              <FormLabel htmlFor="closure-confirmed">{label('confirm')}</FormLabel>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel htmlFor="closure-password">{label('password')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                id="closure-password"
                                type="password"
                                autoComplete="current-password"
                                data-ticket-command-retry={pending ? true : undefined}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" disabled={busy || !!pending}>
                        {label('execute')}
                      </Button>
                    </form>
                  </Form>
                )}
              </>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
}
