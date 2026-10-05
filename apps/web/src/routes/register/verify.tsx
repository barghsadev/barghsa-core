import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createFileRoute, Link, useRouter, useSearch } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/auth';
import { registrationFormText } from '@barghsa/i18n/registration-forms';
import { Button } from '@barghsa/ui';
import { Form, FormField } from '@barghsa/ui/form';
import { AuthLayout } from '../../components/AuthLayout.js';
import { OtpInput, type OtpInputHandle } from '../../components/OtpInput.js';
import { useLocale } from '../../hooks/useLocale.js';
import { useNumberFormatting } from '../../hooks/useNumberFormatting.js';
import { useRegistrationNativeForm } from '../../hooks/useRegistrationNativeForm.js';
import { publicAuthFetch } from '../../lib/public-auth-fetch.js';
import { authErrorCode, rateLimitMessage, retryAfterSeconds } from '../../lib/auth-errors.js';
import { hasSessionAcknowledgement, hasResendAcknowledgement } from '../../lib/auth-responses.js';
import { registrationChallenge, emptyRegistration } from '../../lib/registration-form.js';
import { toast } from '../../lib/toast-api.js';
import { rememberAuthSuccess } from '../../lib/auth-entry-feedback.js';
export const Route = createFileRoute('/register/verify')({
  validateSearch: (search: Record<string, unknown>) => ({
    challengeId: String(search?.challengeId ?? ''),
    destination: String(search?.destination ?? ''),
  }),
  component: OtpVerifyPage,
});
function OtpVerifyPage() {
  const router = useRouter(),
    { challengeId, destination } = useSearch({ from: '/register/verify' }),
    locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const model = useRegistrationNativeForm('verify', `verify|${challengeId}`, locale),
    form = model.form;
  const otpRef = useRef<OtpInputHandle>(null),
    expiryRedirect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null),
    [resendUntil, setResendUntil] = useState(() => Date.now() + 60_000),
    [attemptUntil, setAttemptUntil] = useState(0),
    [now, setNow] = useState(Date.now),
    [resending, setResending] = useState(false);
  const cooldown = Math.max(0, Math.ceil((resendUntil - now) / 1000)),
    attemptCooldown = Math.max(0, Math.ceil((attemptUntil - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    form.reset(emptyRegistration);
    otpRef.current?.reset();
    setError(null);
    setResending(false);
    setResendUntil(Date.now() + 60_000);
    setAttemptUntil(0);
    setNow(Date.now());
    if (!registrationChallenge({ challengeId })) void router.navigate({ to: '/register' });
    return () => {
      if (expiryRedirect.current !== null) clearTimeout(expiryRedirect.current);
      expiryRedirect.current = null;
    };
  }, [challengeId, form.reset, router]);
  function verify(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (
      Date.now() < attemptUntil ||
      !registrationChallenge({ challengeId }) ||
      expiryRedirect.current !== null
    )
      return;
    void model.run(async (values, capture) => {
      setError(null);
      const unknown = () => {
        if (capture.current()) {
          capture.hold();
          setError(registrationFormText('uncertain', locale));
        }
      };
      try {
        const response = await publicAuthFetch('/api/auth/register/verify', {
          signal: capture.controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
          body: JSON.stringify({ challengeId, otp: values.otp }),
        });
        const body = await response.json().catch(() => null);
        if (!capture.current()) return;
        if (response.status !== 200) {
          if (![400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
            unknown();
            return;
          }
          const code = authErrorCode(body),
            keys: Record<string, string> = {
              'AUTH:OTP:INVALID': 'auth.otp.error.invalid',
              'AUTH:OTP:EXPIRED': 'auth.otp.error.expired',
              'AUTH:OTP:MAX_ATTEMPTS': 'auth.otp.error.maxAttempts',
              'AUTH:OTP:CONSUMED': 'auth.otp.error.consumed',
            };
          setError(
            rateLimitMessage(response, locale, numbers.numberStyle) ??
              t(keys[code ?? ''] ?? 'auth.otp.error.generic', locale)
          );
          // Keep the registration flow's rejected-code clearing policy.
          form.setValue('otp', '');
          otpRef.current?.reset();
          if (response.status === 429)
            setAttemptUntil(Date.now() + (retryAfterSeconds(response) ?? 60) * 1000);
          if (code === 'AUTH:OTP:EXPIRED') {
            capture.hold(false);
            expiryRedirect.current = setTimeout(() => {
              if (!capture.current() || router.state.location.pathname !== '/register/verify')
                return;
              toast.error(t('auth.otp.expired', locale));
              void router.navigate({ to: '/register' });
            }, 500);
          }
          return;
        }
        if (!hasSessionAcknowledgement(body)) {
          unknown();
          return;
        }
        form.reset(emptyRegistration);
        otpRef.current?.reset();
        const message = t('auth.register.success', locale);
        rememberAuthSuccess(message);
        toast.success(message);
        await router.navigate({ to: '/app' });
      } catch {
        unknown();
      }
    }, event);
  }
  function resend() {
    if (
      Date.now() < resendUntil ||
      !registrationChallenge({ challengeId }) ||
      expiryRedirect.current !== null
    )
      return;
    void model.run(
      async (_values, capture) => {
        setResending(true);
        setError(null);
        const unknown = () => {
          if (capture.current()) {
            capture.hold();
            setError(registrationFormText('uncertain', locale));
          }
        };
        try {
          const response = await publicAuthFetch('/api/auth/register/resend', {
            signal: capture.controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
            body: JSON.stringify({ challengeId }),
          });
          const body = await response.json().catch(() => null);
          if (!capture.current()) return;
          if (response.status !== 200) {
            if (![400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
              unknown();
              return;
            }
            setError(
              rateLimitMessage(response, locale, numbers.numberStyle) ??
                t('auth.otp.error.resend', locale)
            );
            if (response.status === 429)
              setResendUntil(Date.now() + (retryAfterSeconds(response) ?? 60) * 1000);
            return;
          }
          if (!hasResendAcknowledgement(body, challengeId)) {
            unknown();
            return;
          }
          setNow(Date.now());
          setResendUntil(Date.now() + 60_000);
          form.setValue('otp', '');
          otpRef.current?.reset();
          toast.success(t('auth.otp.sentTo', locale).replace('{destination}', destination));
        } catch {
          unknown();
        } finally {
          if (capture.current()) setResending(false);
        }
      },
      undefined,
      false
    );
  }
  return (
    <AuthLayout
      locale={locale}
      footer={
        <Link
          to="/register"
          className="text-muted-foreground underline"
          onClick={(event) => {
            if (model.busy) event.preventDefault();
          }}
          aria-label={t('auth.otp.backToRegister', locale)}
        >
          {t('auth.otp.backToRegister', locale)}
        </Link>
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <div className="space-y-1.5 text-center">
          <h1 className="text-xl font-semibold tracking-tight">{t('auth.otp.title', locale)}</h1>
          <p className="text-sm text-muted-foreground">
            {t('auth.otp.sentTo', locale).replace('{destination}', destination)}
          </p>
        </div>
        <Form {...form}>
          <form
            key={model.draftKey}
            ref={model.feedback.element}
            className="space-y-6"
            noValidate
            aria-busy={model.busy}
            onSubmit={verify}
          >
            <FormField
              control={form.control}
              name="otp"
              render={({ field, fieldState }) => (
                <OtpInput
                  ref={otpRef}
                  id="registration-code"
                  name={field.name}
                  locale={locale}
                  disabled={model.locked || attemptCooldown > 0}
                  error={
                    fieldState.error?.message ??
                    error ??
                    form.formState.errors.root?.validation?.message ??
                    null
                  }
                  onChange={(value) => {
                    if (model.canEdit()) field.onChange(value);
                  }}
                  onComplete={() => verify()}
                  onClearError={() => {
                    if (model.canEdit()) {
                      setError(null);
                      form.clearErrors('otp');
                    }
                  }}
                />
              )}
            />
            {model.uncertain && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={model.busy}
                onClick={() => {
                  if (model.restart()) {
                    otpRef.current?.reset();
                    void router.navigate({ to: '/register' });
                  }
                }}
              >
                {registrationFormText('restart', locale)}
              </Button>
            )}
            <Button type="submit" className="w-full" disabled={model.locked || attemptCooldown > 0}>
              {t(model.busy && !resending ? 'auth.otp.verifying' : 'auth.otp.verifyButton', locale)}
            </Button>
            {attemptCooldown > 0 && (
              <p role="status">
                {t('auth.otp.resendTimer', locale).replace(
                  '{seconds}',
                  numbers.number(attemptCooldown, { useGrouping: false })
                )}
              </p>
            )}
            <div className="text-center">
              {cooldown === 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={model.locked}
                  onClick={resend}
                >
                  {t(resending ? 'auth.otp.resending' : 'auth.otp.resend', locale)}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t('auth.otp.resendTimer', locale).replace(
                    '{seconds}',
                    numbers.number(cooldown, { useGrouping: false })
                  )}
                </p>
              )}
            </div>
          </form>
        </Form>
      </div>
    </AuthLayout>
  );
}
