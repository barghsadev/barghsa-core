import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import '../lib/auth-errors.js';
import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
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
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
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
      if (incoming !== null) {
        setToken(incoming);
        setComplete(false);
        setError(null);
      }
      window.history.replaceState(window.history.state, '', window.location.pathname);
    };
    receiveLink();
    window.addEventListener('hashchange', receiveLink);
    return () => window.removeEventListener('hashchange', receiveLink);
  }, []);

  async function activate(event: FormEvent) {
    event.preventDefault();
    if (busy || !validToken || !validPassword) return;
    if (password !== confirmation) {
      setError(t('auth.resetPassword.mismatch', locale));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await publicAuthFetch('/api/auth/activate-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!response.ok) {
        setError(
          t(
            response.status === 401
              ? 'auth.activate.invalid'
              : response.status === 429
                ? 'auth.forgotPassword.error.rateLimited'
                : 'auth.forgotPassword.error.generic',
            locale
          )
        );
        return;
      }
      setToken('');
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch {
      setError(t('auth.forgotPassword.error.generic', locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      locale={locale}
      footer={
        <Link to="/login" className="text-sm text-foreground underline">
          {t('auth.forgotPassword.backToLogin', locale)}
        </Link>
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <h1 className="text-xl font-semibold">
          {t(complete ? 'auth.activate.success' : 'auth.activate.title', locale)}
        </h1>
        {complete ? (
          <p role="status">{t('auth.resetPassword.signIn', locale)}</p>
        ) : !validToken ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('auth.activate.invalid', locale)}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={activate} className="space-y-4">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <PasswordField
              id="activation-password"
              autoFocus
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
