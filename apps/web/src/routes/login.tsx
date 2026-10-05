import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/auth';
import { loginFormText } from '@barghsa/i18n/login-forms';
import { Button, Input, Alert, AlertDescription } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import { AuthLayout } from '../components/AuthLayout.js';
import { PasswordField } from '../components/PasswordField.js';
import { OtpInput, type OtpInputHandle } from '../components/OtpInput.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useLoginNativeForm } from '../hooks/useLoginNativeForm.js';
import { publicAuthFetch } from '../lib/public-auth-fetch.js';
import { authErrorCode, rateLimitMessage, retryAfterSeconds } from '../lib/auth-errors.js';
import {
  hasSessionAcknowledgement,
  hasPasswordChangeAcknowledgement,
  hasResendAcknowledgement,
  parseLoginAcknowledgement,
} from '../lib/auth-responses.js';
import { normalizeRecoveryUsername as normalizeUsername } from '../lib/password-recovery-form.js';
import { emptyLogin, type LoginStage } from '../lib/login-form.js';
import { toast } from '../lib/toast-api.js';
import { rememberAuthSuccess } from '../lib/auth-entry-feedback.js';
export const Route = createFileRoute('/login')({ component: LoginPage });
const ERROR_CODE_I18N_MAP: Record<string, string> = {
  'AUTH:LOGIN:INVALID_CREDENTIALS': 'auth.login.error.invalidCredentials',
  'RATE_LIMIT:EXCEEDED': 'auth.register.error.rateLimited',
  'INTERNAL:UNEXPECTED': 'auth.login.error.internal',
  'INTERNAL:SERVER_ERROR': 'auth.login.error.internal',
};

function resolveErrorMessage(errorCode: string | undefined, locale: Locale): string {
  if (errorCode && ERROR_CODE_I18N_MAP[errorCode]) {
    return t(ERROR_CODE_I18N_MAP[errorCode], locale);
  }
  return t('auth.login.error.generic', locale);
}

function LoginPage() {
  const router = useRouter(),
    locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const [stage, setStage] = useState<LoginStage>('credentials');
  const [challenge, setChallenge] = useState<{ id: string; destination: string } | null>(null);
  const [passwordChangeToken, setPasswordChangeToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState(0),
    [attemptUntil, setAttemptUntil] = useState(0),
    [now, setNow] = useState(Date.now),
    [resending, setResending] = useState(false);
  const expiryRedirect = useRef<ReturnType<typeof setTimeout> | null>(null),
    otpRef = useRef<OtpInputHandle>(null);
  const model = useLoginNativeForm(stage, stage, locale),
    form = model.form;
  const username = form.watch('username'),
    normalized = normalizeUsername(username);
  const touched = !!form.formState.touchedFields.username || form.formState.isSubmitted;
  const cooldown = Math.max(0, Math.ceil((resendUntil - now) / 1000)),
    attemptCooldown = Math.max(0, Math.ceil((attemptUntil - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      if (expiryRedirect.current !== null) clearTimeout(expiryRedirect.current);
      expiryRedirect.current = null;
    },
    [stage, locale]
  );
  function returnToCredentials(message: string | null = null) {
    if (model.busy) return;
    const reset = model.uncertain
      ? model.restart()
      : model.replaceDraft({ ...emptyLogin, username: form.getValues('username') });
    if (!reset) return;
    setStage('credentials');
    setChallenge(null);
    setPasswordChangeToken('');
    setError(message);
    setResending(false);
    otpRef.current?.reset();
  }
  async function complete(message: string) {
    form.reset(emptyLogin);
    otpRef.current?.reset();
    rememberAuthSuccess(message);
    toast.success(message);
    await router.navigate({ to: '/app', replace: true });
  }
  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (
      (stage === 'otp' &&
        (!challenge || Date.now() < attemptUntil || expiryRedirect.current !== null)) ||
      (stage === 'change' && !passwordChangeToken)
    )
      return;
    void model.run(async (values, capture) => {
      setError(null);
      const unknown = () => {
        if (capture.current()) {
          capture.hold();
          setError(loginFormText('uncertain', locale));
        }
      };
      const payload =
        stage === 'credentials'
          ? { username: normalizeUsername(values.username).normalized, password: values.password }
          : stage === 'change'
            ? { passwordChangeToken, newPassword: values.newPassword }
            : { challengeId: challenge!.id, otp: values.otp, trustDevice: values.trustDevice };
      const endpoint =
        stage === 'credentials'
          ? 'login'
          : stage === 'change'
            ? 'force-change-password'
            : 'login/verify';
      try {
        const response = await publicAuthFetch('/api/auth/' + endpoint, {
          signal: capture.controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => null);
        if (!capture.current()) return;
        if (response.status !== 200) {
          if (![400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
            unknown();
            return;
          }
          const code = authErrorCode(body),
            retry = rateLimitMessage(response, locale, numbers.numberStyle);
          if (stage === 'credentials') setError(retry ?? resolveErrorMessage(code, locale));
          else if (stage === 'change')
            setError(
              retry ??
                t(
                  code === 'AUTH:LOGIN:PASSWORD_REUSED'
                    ? 'auth.login.error.passwordReused'
                    : 'auth.login.error.passwordChangeFailed',
                  locale
                )
            );
          else {
            const keys: Record<string, string> = {
              'AUTH:OTP:INVALID': 'auth.otp.error.invalid',
              'AUTH:OTP:EXPIRED': 'auth.otp.error.expired',
              'AUTH:OTP:MAX_ATTEMPTS': 'auth.otp.error.maxAttempts',
              'AUTH:OTP:CONSUMED': 'auth.otp.error.consumed',
            };
            setError(retry ?? t(keys[code ?? ''] ?? 'auth.otp.error.generic', locale));
            form.setValue('otp', '');
            otpRef.current?.reset();
            if (response.status === 429) {
              setNow(Date.now());
              setAttemptUntil(Date.now() + (retryAfterSeconds(response) ?? 60) * 1000);
            }
            if (code === 'AUTH:OTP:EXPIRED') {
              capture.hold(false);
              expiryRedirect.current = setTimeout(() => {
                if (!capture.current()) return;
                if (model.replaceDraft({ ...emptyLogin, username: values.username }, capture)) {
                  setStage('credentials');
                  setChallenge(null);
                  setPasswordChangeToken('');
                  const message = t('auth.login.otpExpired', locale);
                  setError(message);
                  toast.error(message);
                }
              }, 500);
            }
          }
          return;
        }
        if (stage === 'credentials') {
          const accepted = parseLoginAcknowledgement(body);
          if (!accepted) {
            unknown();
            return;
          }
          if (accepted.kind === 'session') {
            await complete(t('auth.login.success', locale));
            return;
          }
          if (!model.replaceDraft({ ...emptyLogin, username: values.username }, capture)) return;
          if (accepted.kind === 'password-change') {
            setPasswordChangeToken(accepted.token);
            setStage('change');
          } else {
            setChallenge({
              id: accepted.challengeId,
              destination:
                normalizeUsername(values.username).formatted ??
                normalizeUsername(values.username).normalized,
            });
            setNow(Date.now());
            setResendUntil(Date.now() + 60_000);
            setAttemptUntil(0);
            setStage('otp');
          }
        } else if (stage === 'change') {
          if (!hasPasswordChangeAcknowledgement(body)) {
            unknown();
            return;
          }
          if (model.replaceDraft({ ...emptyLogin, username: values.username }, capture)) {
            setPasswordChangeToken('');
            setStage('credentials');
            toast.success(t('auth.login.passwordChanged', locale));
          }
        } else {
          if (!hasSessionAcknowledgement(body)) {
            unknown();
            return;
          }
          await complete(t('auth.login.otpSuccess', locale));
        }
      } catch {
        unknown();
      }
    }, event);
  }
  function resend() {
    if (
      stage !== 'otp' ||
      !challenge ||
      Date.now() < resendUntil ||
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
            setError(loginFormText('uncertain', locale));
          }
        };
        try {
          const response = await publicAuthFetch('/api/auth/login/resend', {
            signal: capture.controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
            body: JSON.stringify({ challengeId: challenge.id }),
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
            if (response.status === 429) {
              setNow(Date.now());
              setResendUntil(Date.now() + (retryAfterSeconds(response) ?? 60) * 1000);
            }
            return;
          }
          if (!hasResendAcknowledgement(body, challenge.id)) {
            unknown();
            return;
          }
          setNow(Date.now());
          setResendUntil(Date.now() + 60_000);
          form.setValue('otp', '');
          form.clearErrors('otp');
          otpRef.current?.reset();
          toast.success(
            t('auth.otp.sentTo', locale).replace('{destination}', challenge.destination)
          );
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
  const edit = (field: { onChange: (value: unknown) => void }, value: unknown) => {
    if (model.canEdit()) field.onChange(value);
  };
  const passwordControl = (name: 'password' | 'newPassword', id: string, label: string) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <div
          onBlurCapture={() => {
            if (model.canEdit()) field.onBlur();
          }}
        >
          <PasswordField
            id={id}
            name={field.name}
            locale={locale}
            label={label}
            value={field.value}
            onChange={(value) => edit(field, value)}
            disabled={model.locked}
            error={fieldState.error?.message ?? null}
            showStrength={name === 'newPassword'}
            autoComplete={name === 'password' ? 'current-password' : 'new-password'}
            autoFocus={name === 'newPassword'}
          />
        </div>
      )}
    />
  );
  return (
    <AuthLayout
      locale={locale}
      footer={
        stage !== 'credentials' ? (
          <p className="text-center text-sm">
            <button
              type="button"
              disabled={model.busy || (model.locked && !model.uncertain)}
              onClick={() => returnToCredentials()}
              className="text-muted-foreground underline-offset-4 hover:text-primary dark:hover:text-foreground hover:underline"
              aria-label={t(
                stage === 'otp' ? 'auth.login.otpBackToLogin' : 'auth.login.backToLogin',
                locale
              )}
            >
              {t(stage === 'otp' ? 'auth.login.otpBackToLogin' : 'auth.login.backToLogin', locale)}
            </button>
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-center text-sm text-muted-foreground">
              {t('auth.login.registerLink', locale)}{' '}
              <Link
                to="/register"
                onClick={(event) => {
                  if (model.busy) event.preventDefault();
                }}
                className="font-medium text-primary dark:text-foreground underline-offset-4 hover:underline"
                aria-label={t('auth.login.registerLinkLabel', locale)}
              >
                {t('auth.login.registerLinkLabel', locale)}
              </Link>
            </p>
            <p className="text-center text-sm">
              <Link
                to="/forgot-password"
                onClick={(event) => {
                  if (model.busy) event.preventDefault();
                }}
                className="text-muted-foreground underline-offset-4 hover:text-primary dark:hover:text-foreground hover:underline"
                aria-label={t('auth.register.forgotPasswordLabel', locale)}
              >
                {t('auth.register.forgotPasswordLink', locale)}
              </Link>
            </p>
          </div>
        )
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <div className={'space-y-1.5' + (stage === 'otp' ? ' text-center' : '')}>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t(
              stage === 'credentials'
                ? 'auth.login.title'
                : stage === 'change'
                  ? 'auth.login.forceChangeTitle'
                  : 'auth.login.otpTitle',
              locale
            )}
          </h1>
          {stage !== 'credentials' && (
            <p className="text-sm text-muted-foreground">
              {stage === 'change'
                ? t('auth.login.forceChangeDescription', locale)
                : t('auth.login.otpSentTo', locale).replace(
                    '{destination}',
                    challenge?.destination ?? ''
                  )}
            </p>
          )}
        </div>
        <Form {...form}>
          <form
            key={`${stage}|${model.draftKey}`}
            ref={model.feedback.element}
            className="space-y-4"
            noValidate
            aria-busy={model.busy}
            onSubmit={submit}
          >
            {stage !== 'otp' && (error ?? form.formState.errors.root?.validation?.message) && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  {error ?? form.formState.errors.root?.validation?.message}
                </AlertDescription>
              </Alert>
            )}
            {stage === 'credentials' ? (
              <>
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem id="username">
                      <FormLabel>{t('auth.register.emailLabel', locale)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="text"
                          dir="ltr"
                          autoComplete="username"
                          autoFocus
                          maxLength={255}
                          placeholder={t('auth.register.usernamePlaceholder', locale)}
                          disabled={model.locked}
                          onChange={(event) => edit(field, event)}
                          onBlur={() => {
                            if (model.canEdit()) field.onBlur();
                          }}
                          aria-describedby={
                            touched && !form.formState.errors.username && normalized.formatted
                              ? 'username-hint'
                              : undefined
                          }
                        />
                      </FormControl>
                      <FormMessage />
                      {touched && !form.formState.errors.username && normalized.formatted && (
                        <p id="username-hint" dir="ltr" className="text-sm text-muted-foreground">
                          {normalized.formatted}
                        </p>
                      )}
                    </FormItem>
                  )}
                />
                {passwordControl('password', 'password', t('auth.register.passwordLabel', locale))}
              </>
            ) : stage === 'change' ? (
              <>
                {passwordControl(
                  'newPassword',
                  'new-password',
                  t('auth.register.newPasswordLabel', locale)
                )}
                <FormField
                  control={form.control}
                  name="confirmation"
                  render={({ field }) => (
                    <FormItem id="confirm-password">
                      <FormLabel>{t('auth.register.confirmPasswordLabel', locale)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                          disabled={model.locked}
                          onChange={(event) => edit(field, event)}
                          onBlur={() => {
                            if (model.canEdit()) field.onBlur();
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <>
                <FormField
                  control={form.control}
                  name="otp"
                  render={({ field, fieldState }) => (
                    <OtpInput
                      ref={otpRef}
                      id="login-code"
                      name={field.name}
                      locale={locale}
                      disabled={model.locked || attemptCooldown > 0}
                      error={
                        fieldState.error?.message ??
                        error ??
                        form.formState.errors.root?.validation?.message ??
                        null
                      }
                      onChange={(value) => edit(field, value)}
                      onComplete={() => submit()}
                      onClearError={() => {
                        if (model.canEdit()) {
                          setError(null);
                          form.clearErrors('otp');
                        }
                      }}
                    />
                  )}
                />
                <FormField
                  control={form.control}
                  name="trustDevice"
                  render={({ field }) => (
                    <FormItem id="trust-device">
                      <div className="flex items-center gap-2">
                        <FormControl>
                          <input
                            type="checkbox"
                            name={field.name}
                            ref={field.ref}
                            checked={field.value}
                            className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            onChange={(event) => edit(field, event.target.checked)}
                            disabled={model.locked}
                          />
                        </FormControl>
                        <FormLabel className="text-sm text-muted-foreground">
                          {t('auth.login.trustDevice', locale)}
                        </FormLabel>
                      </div>
                    </FormItem>
                  )}
                />
              </>
            )}
            {model.uncertain && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={model.busy}
                onClick={() => returnToCredentials()}
              >
                {loginFormText('restart', locale)}
              </Button>
            )}
            <Button
              type="submit"
              className="w-full hover:bg-primary"
              disabled={model.locked || (stage === 'otp' && attemptCooldown > 0)}
            >
              {t(
                stage === 'credentials'
                  ? model.busy
                    ? 'auth.login.submitting'
                    : 'auth.login.submit'
                  : stage === 'change'
                    ? model.busy
                      ? 'auth.login.changingPassword'
                      : 'auth.login.changePasswordButton'
                    : model.busy && !resending
                      ? 'auth.otp.verifying'
                      : 'auth.otp.verifyButton',
                locale
              )}
            </Button>
            {stage === 'otp' && (
              <>
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
              </>
            )}
          </form>
        </Form>
      </div>
    </AuthLayout>
  );
}
