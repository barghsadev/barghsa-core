import { maskDestination } from '../lib/mask-destination.js';
import { authResponseRecord, hasPasswordChangeAcknowledgement } from '../lib/auth-responses.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { rateLimitMessage, retryAfterSeconds } from '../lib/auth-errors.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { toast } from 'sonner';
import { Button, Input, Label, Alert, AlertDescription } from '@barghsa/ui';
import { AuthLayout } from '../components/AuthLayout.js';
import { PasswordField } from '../components/PasswordField.js';
import { useLocale } from '../hooks/useLocale.js';

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage });

// ─── Iranian mobile number helpers ──────────────────────────────────────

/** Regex: starts with 09, followed by exactly 9 digits (11 total) */
const IRANIAN_MOBILE_RE = /^09\d{9}$/;

/** Regex: basic email validation */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Regex: loose E.164 — starts with +, 7-15 digits */
const E164_RE = /^\+[1-9]\d{6,14}$/;

type UsernameType = 'email' | 'mobile' | 'international' | null;

interface NormalizationResult {
  type: UsernameType;
  normalized: string;
  formatted: string | null;
}

/**
 * Detect the type of the raw input and normalize it.
 * Returns { type, normalized, formatted }.
 * - type=null means invalid/unrecognised.
 * - formatted is the display-friendly version (e.g. "+98 912 123 4567").
 */
function normalizeUsername(raw: string): NormalizationResult {
  const trimmed = raw.trim();

  // Iranian mobile: 09121234567 → +989****4567
  if (IRANIAN_MOBILE_RE.test(trimmed)) {
    const e164 = `+98${trimmed.slice(1)}`;
    const groups = e164.match(/^(\+\d{2})(\d{3})(\d{3})(\d{4})$/);
    const formatted = groups ? `${groups[1]} ${groups[2]} ${groups[3]} ${groups[4]}` : e164;
    return { type: 'mobile', normalized: e164, formatted };
  }

  // International (already E.164)
  if (trimmed.startsWith('+')) {
    if (E164_RE.test(trimmed)) {
      return { type: 'international', normalized: trimmed, formatted: null };
    }
    return { type: null, normalized: trimmed, formatted: null };
  }

  // Email
  if (EMAIL_RE.test(trimmed)) {
    return { type: 'email', normalized: trimmed.toLowerCase(), formatted: null };
  }

  return { type: null, normalized: trimmed, formatted: null };
}

function ForgotPasswordPage() {
  const router = useRouter();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [username, setUsername] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0);
  const [attemptUntil, setAttemptUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const cooldown = Math.max(0, Math.ceil((resendUntil - now) / 1000));
  const attemptCooldown = Math.max(0, Math.ceil((attemptUntil - now) / 1000));
  function setCooldown(seconds: number) {
    const current = Date.now();
    setNow(current);
    setResendUntil(current + seconds * 1000);
  }
  function setAttemptCooldown(seconds: number) {
    const current = Date.now();
    setNow(current);
    setAttemptUntil(current + seconds * 1000);
  }
  const [authorization, setAuthorization] = useState<{ token: string; expiresAt: number } | null>(
    null
  );
  const pending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (authorization) document.getElementById('new-password')?.focus();
  }, [authorization]);
  const normalized = normalizeUsername(username);

  useEffect(() => {
    const until = Math.max(resendUntil, attemptUntil);
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendUntil, attemptUntil]);
  useEffect(() => {
    if (!authorization) return;
    const timer = setTimeout(
      () => {
        setAuthorization(null);
        setOtp('');
        setPassword('');
        setConfirmation('');
        setError(t('auth.otp.error.expired', locale));
      },
      Math.max(0, authorization.expiresAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [authorization, locale]);

  async function request(path: string, payload: unknown): Promise<Record<string, unknown> | null> {
    abort.current = new AbortController();
    const response = await fetch(`/api/auth/${path}`, {
      signal: abort.current.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
      body: JSON.stringify(payload),
    });
    const body = authResponseRecord(await response.json().catch(() => null));
    if (response.ok) {
      if (!body) throw new Error('Invalid recovery acknowledgement');
      return body;
    }
    const raw = body?.error;
    const code = typeof raw === 'string' ? raw : (raw as { code?: string } | undefined)?.code;
    const messages: Record<string, string> = {
      'AUTH:OTP:INVALID': 'auth.otp.error.invalid',
      'AUTH:OTP:EXPIRED': 'auth.otp.error.expired',
      'AUTH:OTP:CONSUMED': 'auth.otp.error.consumed',
      'AUTH:OTP:MAX_ATTEMPTS': 'auth.otp.error.maxAttempts',
      'AUTH:REGISTER:WEAK_PASSWORD': 'auth.register.passwordRequirements',
      'AUTH:LOGIN:PASSWORD_REUSED': 'auth.login.error.passwordReused',
      'AUTH:DELIVERY:UNAVAILABLE': 'auth.otp.error.deliveryUnavailable',
    };
    if (response.status === 429) {
      (path === 'forgot-password' ? setCooldown : setAttemptCooldown)(
        retryAfterSeconds(response) ?? 60
      );
      setError(rateLimitMessage(response, locale, numbers.numberStyle));
    } else {
      setError(t(messages[code ?? ''] ?? 'auth.forgotPassword.error.generic', locale));
    }
    return null;
  }

  async function start(event?: FormEvent) {
    event?.preventDefault();
    if (pending.current || cooldown > 0 || !normalized.type) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = await request('forgot-password', { username: normalized.normalized });
      if (!body) return;
      if (typeof body.challengeId !== 'string' || !body.challengeId.trim())
        throw new Error('Missing challenge');
      setChallengeId(body.challengeId);
      setAuthorization(null);
      setPassword('');
      setConfirmation('');
      setOtp('');
      setCooldown(60);
    } catch {
      setError(t('auth.forgotPassword.error.generic', locale));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (pending.current || attemptCooldown > 0 || !/^\d{6}$/.test(otp)) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = await request('reset-password/verify', { challengeId, otp });
      if (!body) return;
      const expiresAt = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
      if (
        body.verified !== true ||
        body.challengeId !== challengeId ||
        typeof body.resetToken !== 'string' ||
        !/^[a-f0-9]{64}$/.test(body.resetToken) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      ) {
        throw new Error('Invalid reset authorization');
      }
      setOtp('');
      setAuthorization({ token: body.resetToken, expiresAt });
    } catch {
      setError(t('auth.forgotPassword.error.generic', locale));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    if (pending.current || attemptCooldown > 0 || !authorization) return;
    if (authorization.expiresAt <= Date.now()) {
      setError(t('auth.otp.error.expired', locale));
      return;
    }
    if (password !== confirmation) {
      setError(t('auth.resetPassword.mismatch', locale));
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = await request('reset-password', {
        challengeId,
        resetToken: authorization.token,
        newPassword: password,
      });
      if (!body) return;
      if (!hasPasswordChangeAcknowledgement(body)) throw new Error('Invalid reset acknowledgement');
      setOtp('');
      setPassword('');
      setConfirmation('');
      setChallengeId('');
      setAuthorization(null);
      toast.success(t('auth.resetPassword.success', locale), {
        description: t('auth.resetPassword.signIn', locale),
      });
      await router.navigate({ to: '/login', replace: true });
    } catch {
      setError(t('auth.forgotPassword.error.generic', locale));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const validPassword =
    password.length >= 8 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);
  return (
    <AuthLayout
      locale={locale}
      footer={
        <Link to="/login" className="text-sm text-primary underline">
          {t('auth.forgotPassword.backToLogin', locale)}
        </Link>
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <h1 className="text-xl font-semibold">
          {t(challengeId ? 'auth.resetPassword.title' : 'auth.forgotPassword.title', locale)}
        </h1>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {challengeId ? (
          <form onSubmit={authorization ? reset : verify} className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('auth.forgotPassword.sent', locale)}</p>
            <p className="text-sm" dir="ltr">
              {maskDestination(normalized.normalized)}
            </p>
            {!authorization ? (
              <div className="space-y-2">
                <Label htmlFor="reset-otp">{t('auth.otp.inputLabel', locale)}</Label>
                <Input
                  id="reset-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={6}
                  autoFocus
                  value={otp}
                  onChange={(event) =>
                    setOtp(
                      event.target.value
                        .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
                        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
                        .replace(/\D/g, '')
                    )
                  }
                  disabled={busy}
                />
              </div>
            ) : (
              <>
                <PasswordField
                  id="new-password"
                  label={t('auth.resetPassword.newPassword', locale)}
                  locale={locale}
                  value={password}
                  onChange={setPassword}
                  disabled={busy}
                />
                <PasswordField
                  id="confirm-password"
                  label={t('auth.resetPassword.confirmPassword', locale)}
                  locale={locale}
                  value={confirmation}
                  onChange={setConfirmation}
                  showStrength={false}
                  disabled={busy}
                />
              </>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={
                busy ||
                attemptCooldown > 0 ||
                (authorization ? !validPassword || !confirmation : otp.length !== 6)
              }
            >
              {t(
                authorization
                  ? busy
                    ? 'auth.resetPassword.submitting'
                    : 'auth.resetPassword.submit'
                  : busy
                    ? 'auth.otp.verifying'
                    : 'auth.otp.verifyButton',
                locale
              )}
            </Button>
            {attemptCooldown > 0 && (
              <p role="status">
                {t('auth.otp.resendTimer', locale).replace(
                  '{seconds}',
                  numbers.number(attemptCooldown, { useGrouping: false })
                )}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={busy || cooldown > 0}
              onClick={() => void start()}
            >
              {cooldown > 0
                ? t('auth.otp.resendTimer', locale).replace(
                    '{seconds}',
                    numbers.number(cooldown, { useGrouping: false })
                  )
                : t('auth.otp.resend', locale)}
            </Button>
          </form>
        ) : (
          <form onSubmit={start} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.register.emailLabel', locale)}</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                maxLength={255}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={busy}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !normalized.type || cooldown > 0}
            >
              {t(busy ? 'auth.forgotPassword.submitting' : 'auth.forgotPassword.submit', locale)}
            </Button>
            {cooldown > 0 && (
              <p role="status">
                {t('auth.otp.resendTimer', locale).replace(
                  '{seconds}',
                  numbers.number(cooldown, { useGrouping: false })
                )}
              </p>
            )}
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
