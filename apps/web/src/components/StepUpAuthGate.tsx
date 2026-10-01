import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

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
  const text = (key: string) => t(`admin.stepUp.${key}`, locale);
  const [challenge, setChallenge] = useState<{
    id: string;
    channel: 'email' | 'sms';
    expires: number;
  } | null>(null);
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState(0),
    [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    alive = useRef(false);
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
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/auth/step-up/otp/${send ? 'send' : 'verify'}`, {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(send ? {} : { challengeId: challenge!.id, code }),
      });
      const data: unknown = await response.json().catch(() => null);
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
        setError(text('denied'));
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
        setError(text('rateLimited'));
        return;
      }
      if (!response.ok) {
        setCode('');
        setError(text(send ? 'sendFailed' : 'invalid'));
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
      if (alive.current && !controller.signal.aborted) setError(text('unavailable'));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{text('required')}</p>
      <p className="text-sm text-muted-foreground">{text('help')}</p>
      {challenge && (
        <p role="status">{text(challenge.channel === 'email' ? 'sentEmail' : 'sentSms')}</p>
      )}
      {expired && <p role="alert">{text('expired')}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {delay > 0 && (
        <p role="status">{text('retryAfter').replace('{seconds}', numbers.number(delay))}</p>
      )}
      {challenge && (
        <form className="space-y-3" onSubmit={submit}>
          <Label htmlFor={id}>{text('code')}</Label>
          <Input
            id={id}
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            autoFocus
            value={code}
            disabled={disabled || busy || expired}
            onChange={(event) =>
              setCode(
                event.target.value
                  .replace(/[۰-۹٠-٩]/g, (digit) =>
                    String(digit.charCodeAt(0) - (digit >= '۰' ? 1776 : 1632))
                  )
                  .replace(/\D/g, '')
              )
            }
          />
          <Button
            type="submit"
            disabled={disabled || busy || !!delay || expired || code.length !== 6}
          >
            {text(busy ? 'working' : 'verify')}
          </Button>
        </form>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy || !!delay}
        onClick={(event) => void submit(event, true)}
      >
        {text(busy ? 'working' : challenge ? 'resend' : 'send')}
      </Button>
    </div>
  );
}
