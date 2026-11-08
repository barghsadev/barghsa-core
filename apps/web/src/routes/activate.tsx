import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import { authErrorCode, rateLimitMessage } from '../lib/auth-errors.js';
import { authResponseRecord } from '../lib/auth-responses.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';
import { Alert, AlertDescription, Button } from '@barghsa/ui';
import { AuthLayout } from '../components/AuthLayout.js';
import { PasswordField } from '../components/PasswordField.js';
import { useLocale } from '../hooks/useLocale.js';

export const Route = createFileRoute('/activate')({ component: ActivatePage });

function ActivatePage() {
  const locale = useLocale();
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''
  );
  const link = useRef({ token, retired: false });
  const request = useRef<AbortController | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<'complete' | 'unconfirmed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const validPassword =
    password.length >= 8 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password);

  useEffect(() => {
    // The email fragment never reaches the HTTP server, and is removed from browser history.
    const receiveLink = () => {
      const incoming = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (incoming !== null && incoming !== link.current.token) {
        request.current?.abort();
        request.current = null;
        link.current = { token: incoming, retired: false };
        setToken(incoming);
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
    if (request.current || owner.retired || owner.token !== token || !validToken || !validPassword)
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
          body: JSON.stringify({ token, newPassword: password }),
          signal,
        });
        return { response, body: await response.json().catch(() => null) };
      });
      if (request.current !== controller) return;
      if (response.status === 200 && authResponseRecord(body)?.activated === true) {
        finish('complete');
      } else if (response.status === 401 && authErrorCode(body) === 'AUTH:TOKEN_INVALID') {
        finish(null);
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
        <Link
          to="/login"
          className="touch-action justify-center text-sm text-foreground underline pointer-coarse:min-h-[45px]!"
        >
          {t('auth.forgotPassword.backToLogin', locale)}
        </Link>
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <h1 className="text-xl font-semibold">
          {t(outcome === 'complete' ? 'auth.activate.success' : 'auth.activate.title', locale)}
        </h1>
        {outcome === 'complete' ? (
          <p role="status">{t('auth.resetPassword.signIn', locale)}</p>
        ) : outcome === 'unconfirmed' ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {passwordRecoveryText('activationUnconfirmed', locale)}
            </AlertDescription>
          </Alert>
        ) : !validToken ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('auth.activate.invalid', locale)}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={activate} className="space-y-4" aria-busy={busy}>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
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
              disabled={busy || !validPassword || !confirmation}
            >
              {t(busy ? 'auth.resetPassword.submitting' : 'auth.activate.submit', locale)}
            </Button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
