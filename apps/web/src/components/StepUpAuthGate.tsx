import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Input, Label } from '@barghsa/ui';
import { stepUpText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';

/** Inline OTP form inside the existing sensitive-action dialog. */
export function StepUpAuthGate({
  disabled = false,
  onVerified,
  onDenied,
}: {
  disabled?: boolean;
  onVerified: () => Promise<void>;
  onDenied?: (status: 401 | 403) => void;
}) {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    id = useId();
  const text = (key: Parameters<typeof stepUpText>[0]) => stepUpText(key, locale);
  const [challenge, setChallenge] = useState<{
    id: string;
    channel: 'email' | 'sms';
    expires: number;
  } | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<'send' | 'verify' | null>(null);
  const [error, setError] = useState<
    'denied' | 'rateLimited' | 'sendFailed' | 'invalid' | 'unavailable' | null
  >(null);
  const busy = pending !== null;
  const [retryAt, setRetryAt] = useState(0),
    [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    alive = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<'code' | 'send' | null>(null);
  const allowed = useRef(!disabled);
  allowed.current = !disabled;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!retryAt && !challenge) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt, challenge]);
  const delay = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const expired = !!challenge && challenge.expires <= now;
  const feedback = expired ? 'expired' : error === 'rateLimited' && !delay ? null : error;
  useEffect(() => {
    if (busy || disabled || !returnFocus.current) return;
    if (returnFocus.current === 'code') codeInput.current?.focus();
    else sendButton.current?.focus();
    returnFocus.current = null;
  }, [busy, challenge, code, disabled, error]);
  async function submit(event: FormEvent, send = false) {
    event.preventDefault();
    if (
      disabled ||
      inFlight.current ||
      delay ||
      (!send && (!challenge || expired || !/^\d{6}$/.test(code)))
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    inFlight.current = true;
    setPending(send ? 'send' : 'verify');
    setError(null);
    try {
      const { response, data } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch(`/api/auth/step-up/otp/${send ? 'send' : 'verify'}`, {
          method: 'POST',
          credentials: 'include',
          signal,
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(send ? {} : { challengeId: challenge!.id, code }),
        });
        return { response, data: (await response.json().catch(() => null)) as unknown };
      });
      if (!alive.current || controller.signal.aborted || !allowed.current) return;
      const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const failure =
        typeof body.error === 'string'
          ? body.error
          : (body.error as { code?: string } | undefined)?.code;
      if (
        (response.status === 401 &&
          (failure === 'AUTH:UNAUTHENTICATED' || failure === 'AUTH:TOKEN_INVALID')) ||
        response.status === 403
      ) {
        setChallenge(null);
        setCode('');
        onDenied?.(response.status as 401 | 403);
        setError('denied');
        return;
      }
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const wait =
          typeof body.retryAfterMs === 'number' && Number.isFinite(body.retryAfterMs)
            ? body.retryAfterMs
            : raw && Number.isFinite(Number(raw))
              ? Number(raw) * 1000
              : raw
                ? Date.parse(raw) - Date.now()
                : 1000;
        setRetryAt(Date.now() + Math.max(1000, Number.isFinite(wait) ? wait : 1000));
        setNow(Date.now());
        setError('rateLimited');
        return;
      }
      if (!response.ok) {
        if (response.status === 408 || response.status >= 500) throw new Error('Unconfirmed OTP');
        setCode('');
        returnFocus.current = send ? 'send' : 'code';
        setError(send ? 'sendFailed' : 'invalid');
        return;
      }
      if (send) {
        const expires = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
        if (
          typeof body.challengeId !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(body.challengeId) ||
          !Number.isFinite(expires) ||
          expires <= Date.now() ||
          (body.channel !== 'email' && body.channel !== 'sms')
        )
          throw new Error('Invalid challenge');
        returnFocus.current = 'code';
        setChallenge({ id: body.challengeId, channel: body.channel, expires });
        setCode('');
        setNow(Date.now());
      } else {
        if (
          body.verified !== true ||
          typeof body.stepUpVerifiedAt !== 'string' ||
          !Number.isFinite(Date.parse(body.stepUpVerifiedAt))
        )
          throw new Error('Invalid proof');
        setCode('');
        await onVerified();
      }
    } catch {
      if (alive.current && allowed.current && !controller.signal.aborted) {
        // An unknown send may have replaced the code, and an unknown verify may have used it.
        setChallenge(null);
        setCode('');
        returnFocus.current = 'send';
        setError('unavailable');
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setPending(null);
    }
  }
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-xl border bg-muted/25 px-4 py-3"
    >
      <header className="space-y-1">
        <h3 id={`${id}-title`} className="flex items-start gap-2 text-sm font-semibold">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {text('required')}
        </h3>
        {challenge ? (
          <p id={`${id}-delivery`} role="status" className="text-sm text-muted-foreground">
            {text(challenge.channel === 'email' ? 'sentEmail' : 'sentSms')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{text('help')}</p>
        )}
      </header>
      <form className="space-y-3" onSubmit={submit}>
        {challenge && (
          <div className="space-y-1.5">
            <Label htmlFor={id}>{text('code')}</Label>
            <Input
              ref={codeInput}
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              aria-invalid={feedback === 'invalid' || undefined}
              aria-describedby={
                feedback === 'invalid' ? `${id}-delivery ${id}-error` : `${id}-delivery`
              }
              className="max-w-48 bg-background text-center font-mono tracking-[0.35em] tabular-nums"
              value={code}
              disabled={disabled || busy || expired}
              onChange={(event) => {
                setCode(
                  event.target.value
                    .replace(/[۰-۹٠-٩]/g, (digit) =>
                      String(digit.charCodeAt(0) - (digit >= '۰' ? 1776 : 1632))
                    )
                    .replace(/\D/g, '')
                );
                if (error === 'invalid') setError(null);
              }}
            />
          </div>
        )}
        {feedback && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {text(feedback)}
          </p>
        )}
        {delay > 0 && (
          <p className="text-xs text-muted-foreground">
            {text('retryAfter').replace('{seconds}', numbers.number(delay))}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            ref={sendButton}
            type="button"
            variant={challenge && !expired ? 'ghost' : 'default'}
            loading={pending === 'send'}
            disabled={disabled || busy || !!delay}
            onClick={(event) => void submit(event, true)}
          >
            {text(challenge ? 'resend' : 'send')}
          </Button>
          {challenge && !expired && (
            <Button
              type="submit"
              loading={pending === 'verify'}
              disabled={disabled || busy || !!delay || code.length !== 6}
            >
              {text('verify')}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
