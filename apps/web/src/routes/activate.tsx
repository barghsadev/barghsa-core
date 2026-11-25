import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import { authErrorCode, rateLimitMessage } from '../lib/auth-errors.js';
import { authResponseRecord } from '../lib/auth-responses.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';
import { Alert, AlertDescription, Button, Input, buttonVariants } from '@barghsa/ui';
import { AuthLayout } from '../components/AuthLayout.js';
import { PasswordField } from '../components/PasswordField.js';
import { useLocale } from '../hooks/useLocale.js';

export const Route = createFileRoute('/activate')({ component: ActivatePage });

function ActivatePage() {
  const locale = useLocale();
  const [invitation, setInvitation] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('invitation') ?? ''
  );
  const link = useRef({ invitation, retired: false });
  const request = useRef<AbortController | null>(null);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'complete' | 'invalid' | 'unconfirmed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const validInvitation = /^[a-f0-9]{64}$/.test(invitation);
  const validToken = /^v2_[a-f0-9]{64}$/.test(token.trim());
  const validPassword =
    password.length >= 8 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  useEffect(() => {
    // Keep the public invitation reference out of browser history after opening it.
    const receiveLink = () => {
      if (!window.location.hash) return;
      const incoming = new URLSearchParams(window.location.hash.slice(1)).get('invitation') ?? '';
      if (incoming !== link.current.invitation) {
        request.current?.abort();
        request.current = null;
        link.current = { invitation: incoming, retired: false };
        setInvitation(incoming);
        setToken('');
        setPassword('');
        setConfirmation('');
        setBusy(false);
        setOutcome(null);
        setError(null);
      }
      window.history.replaceState(window.history.state, '', window.location.pathname);
    };
    receiveLink();
    window.addEventListener('hashchange', receiveLink);
    return () => {
      window.removeEventListener('hashchange', receiveLink);
      request.current?.abort();
      request.current = null;
    };
  }, []);

  async function activate(event: FormEvent) {
    event.preventDefault();
    const owner = link.current;
    if (
      request.current ||
      owner.retired ||
      owner.invitation !== invitation ||
      !validInvitation ||
      !validToken ||
      !validPassword
    )
      return;
    if (password !== confirmation) {
      setError(t('auth.resetPassword.mismatch', locale));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    const finish = (result: typeof outcome) => {
      owner.retired = true;
      setToken('');
      setPassword('');
      setConfirmation('');
      setOutcome(result);
    };
    try {
      const { response, body } = await readWithDeadline(controller.signal, async (signal) => {
        const response = await publicAuthFetch('/api/auth/activate-staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
          body: JSON.stringify({ token: token.trim(), invitation, newPassword: password }),
          signal,
        });
        return { response, body: await response.json().catch(() => null) };
      });
      if (request.current !== controller) return;
      if (response.status === 200 && authResponseRecord(body)?.activated === true) {
        finish('complete');
      } else if (response.status === 401 && authErrorCode(body) === 'AUTH:TOKEN_INVALID') {
        finish('invalid');
      } else if ([400, 403, 422, 429].includes(response.status)) {
        setError(
          rateLimitMessage(response, locale) ?? t('auth.forgotPassword.error.generic', locale)
        );
      } else {
        finish('unconfirmed');
      }
    } catch {
      if (request.current === controller) finish('unconfirmed');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <AuthLayout
      locale={locale}
      footer={
        outcome !== 'complete' && (
          <Link
            to="/login"
            className="touch-action justify-center self-center text-sm text-foreground underline underline-offset-4 pointer-coarse:min-h-[45px]!"
          >
            {t('auth.forgotPassword.backToLogin', locale)}
          </Link>
        )
      }
    >
      <div className="space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <div className="space-y-2">
          <h1 className="tracking-tight">
            {t(outcome === 'complete' ? 'auth.activate.success' : 'auth.activate.title', locale)}
          </h1>
          {outcome === null && validInvitation && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {passwordRecoveryText('activationInstructions', locale)}
            </p>
          )}
        </div>
        {outcome === 'complete' ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-muted-foreground">
              {passwordRecoveryText('activationComplete', locale)}
            </p>
            <Link to="/login" className={buttonVariants({ className: 'min-h-11 w-full' })}>
              {t('auth.resetPassword.signIn', locale)}
            </Link>
          </div>
        ) : outcome === 'unconfirmed' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {passwordRecoveryText('activationUnconfirmed', locale)}
            </AlertDescription>
          </Alert>
        ) : outcome === 'invalid' || !validInvitation ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription className="space-y-2">
              <p>{t('auth.activate.invalid', locale)}</p>
              <p>{passwordRecoveryText('activationRecovery', locale)}</p>
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={activate} className="space-y-3.5" aria-busy={busy}>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1.5">
              <label htmlFor="activation-code" className="text-sm font-medium">
                {passwordRecoveryText('activationCode', locale)}
              </label>
              <Input
                id="activation-code"
                type="password"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                aria-required="true"
                dir="ltr"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
              />
            </div>
            <PasswordField
              id="activation-password"
              label={t('auth.resetPassword.newPassword', locale)}
              locale={locale}
              value={password}
              onChange={setPassword}
              disabled={busy}
            />
            <PasswordField
              id="activation-confirmation"
              label={t('auth.resetPassword.confirmPassword', locale)}
              locale={locale}
              value={confirmation}
              onChange={setConfirmation}
              disabled={busy}
              showStrength={false}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !validToken || !validPassword || !confirmation}
            >
              {t(busy ? 'auth.resetPassword.submitting' : 'auth.activate.submit', locale)}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
