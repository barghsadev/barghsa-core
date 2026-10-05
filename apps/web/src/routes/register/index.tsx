import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/auth';
import { registrationFormText } from '@barghsa/i18n/registration-forms';
import { Button, Checkbox, Input, Alert, AlertDescription } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import { AuthLayout } from '../../components/AuthLayout.js';
import { PasswordField } from '../../components/PasswordField.js';
import { useLocale } from '../../hooks/useLocale.js';
import { useNumberFormatting } from '../../hooks/useNumberFormatting.js';
import { useRegistrationNativeForm } from '../../hooks/useRegistrationNativeForm.js';
import { publicAuthFetch } from '../../lib/public-auth-fetch.js';
import { authErrorCode, rateLimitMessage } from '../../lib/auth-errors.js';
import { normalizeRecoveryUsername as normalizeUsername } from '../../lib/password-recovery-form.js';
import {
  registrationTerms,
  registrationChallenge,
  emptyRegistration,
  type RegistrationTerms,
} from '../../lib/registration-form.js';
import { maskDestination } from '../../lib/mask-destination.js';
import { toast } from '../../lib/toast-api.js';
const RegistrationTermsDialog = lazy(() => import('../../components/RegistrationTermsDialog.js'));
export const Route = createFileRoute('/register/')({ component: RegisterPage });
const ERROR_CODE_I18N_MAP: Record<string, string> = {
  'AUTH:REGISTER:USERNAME_TAKEN': 'auth.register.error.usernameTaken',
  'AUTH:REGISTER:INVALID_USERNAME': 'auth.register.error.invalidUsername',
  'AUTH:REGISTER:WEAK_PASSWORD': 'auth.register.error.weakPassword',
  'AUTH:REGISTER:TOS_NOT_ACCEPTED': 'auth.register.error.tosNotAccepted',
  'RATE_LIMIT:EXCEEDED': 'auth.register.error.rateLimited',
  'INTERNAL:UNEXPECTED': 'auth.register.error.internal',
  'INTERNAL:SERVER_ERROR': 'auth.register.error.internal',
};

function resolveErrorMessage(errorCode: string | undefined, locale: Locale): string {
  if (errorCode && ERROR_CODE_I18N_MAP[errorCode]) {
    return t(ERROR_CODE_I18N_MAP[errorCode], locale);
  }
  return t('auth.register.error.generic', locale);
}

function RegisterPage() {
  const router = useRouter(),
    locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const [loadedTerms, setLoadedTerms] = useState<(RegistrationTerms & { locale: Locale }) | null>(
    null
  );
  const terms = loadedTerms?.locale === locale ? loadedTerms : null;
  const [termsOpen, setTermsOpen] = useState(false),
    [tosError, setTosError] = useState(false),
    [error, setError] = useState<string | null>(null);
  const termsTrigger = useRef<HTMLAnchorElement>(null);
  const model = useRegistrationNativeForm(
    'register',
    `register|${locale}|${terms?.id ?? ''}`,
    locale
  );
  const form = model.form,
    username = form.watch('username');
  const normalized = normalizeUsername(username);
  const touched = !!form.formState.touchedFields.username || form.formState.isSubmitted;
  const revealPassword = touched && !!normalized.type && !form.formState.errors.username;
  useEffect(() => {
    const controller = new AbortController();
    setLoadedTerms(null);
    setTosError(false);
    setTermsOpen(false);
    form.setValue('tos', false);
    void fetch(`/api/tos/current?locale=${locale}`, {
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Terms unavailable');
        const receipt = registrationTerms(await response.json());
        if (!receipt) throw new Error('Invalid terms');
        if (!controller.signal.aborted) setLoadedTerms({ ...receipt, locale });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTosError(true);
      });
    return () => controller.abort();
  }, [locale, form.setValue]);
  return (
    <AuthLayout
      locale={locale}
      footer={
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {t('auth.register.loginLink', locale)}{' '}
            <Link
              to="/login"
              className="font-medium text-foreground underline underline-offset-4 hover:decoration-2"
              onClick={(event) => {
                if (model.busy) event.preventDefault();
              }}
              aria-label={t('auth.register.loginLinkLabel', locale)}
            >
              {t('auth.register.loginLinkLabel', locale)}
            </Link>
          </p>
          <p className="text-center text-sm">
            <Link
              to="/forgot-password"
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              onClick={(event) => {
                if (model.busy) event.preventDefault();
              }}
              aria-label={t('auth.register.forgotPasswordLabel', locale)}
            >
              {t('auth.register.forgotPasswordLink', locale)}
            </Link>
          </p>
        </div>
      }
    >
      <>
        <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t('auth.register.title', locale)}
          </h1>
          <Form {...form}>
            <form
              key={model.draftKey}
              ref={model.feedback.element}
              className="space-y-4"
              noValidate
              aria-busy={model.busy}
              onSubmit={(event) => {
                if (termsOpen) {
                  event.preventDefault();
                  return;
                }
                void model.run(async (values, capture) => {
                  if (!terms) {
                    form.setError('tos', {
                      type: 'server',
                      message: t('auth.register.tosRequired', locale),
                    });
                    return;
                  }
                  setError(null);
                  const unknown = () => {
                    if (capture.current()) {
                      capture.hold();
                      const message = registrationFormText('uncertain', locale);
                      setError(message);
                      toast.error(message);
                    }
                  };
                  try {
                    const response = await publicAuthFetch('/api/auth/register', {
                      signal: capture.controller.signal,
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
                      body: JSON.stringify({
                        username: normalizeUsername(values.username).normalized,
                        password: values.password,
                        tosVersionId: terms.id,
                      }),
                    });
                    const body = await response.json().catch(() => null);
                    if (!capture.current()) return;
                    if (response.status !== 200) {
                      if (![400, 401, 403, 404, 409, 422, 429].includes(response.status)) {
                        unknown();
                        return;
                      }
                      const message =
                        rateLimitMessage(response, locale, numbers.numberStyle) ??
                        resolveErrorMessage(authErrorCode(body), locale);
                      setError(message);
                      toast.error(message);
                      return;
                    }
                    const challengeId = registrationChallenge(body);
                    if (!challengeId) {
                      unknown();
                      return;
                    }
                    form.reset(emptyRegistration);
                    await router.navigate({
                      to: '/register/verify',
                      search: {
                        challengeId,
                        destination: maskDestination(normalizeUsername(values.username).normalized),
                      },
                    });
                  } catch {
                    unknown();
                  }
                }, event);
              }}
            >
              {(error ?? form.formState.errors.root?.validation?.message) && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>
                    {error ?? form.formState.errors.root?.validation?.message}
                  </AlertDescription>
                </Alert>
              )}
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
                        autoComplete="username"
                        autoFocus
                        maxLength={255}
                        placeholder={t('auth.register.usernamePlaceholder', locale)}
                        disabled={model.locked}
                        onChange={(event) => {
                          if (model.canEdit()) field.onChange(event);
                        }}
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
                      <p id="username-hint" className="text-sm text-muted-foreground" dir="ltr">
                        {normalized.formatted}
                      </p>
                    )}
                  </FormItem>
                )}
              />
              {revealPassword && (
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field, fieldState }) => (
                    <div
                      onBlurCapture={() => {
                        if (model.canEdit()) field.onBlur();
                      }}
                    >
                      <PasswordField
                        id="password"
                        name={field.name}
                        locale={locale}
                        label={t('auth.register.passwordLabel', locale)}
                        value={field.value}
                        error={fieldState.error?.message ?? null}
                        disabled={model.locked}
                        onChange={(value) => {
                          if (model.canEdit()) field.onChange(value);
                        }}
                      />
                    </div>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="tos"
                render={({ field }) => (
                  <FormItem id="tos">
                    <div className="flex items-start gap-3">
                      <FormControl>
                        <Checkbox
                          aria-labelledby="tos-label"
                          name={field.name}
                          ref={field.ref}
                          checked={field.value}
                          onCheckedChange={(value) => {
                            if (model.canEdit()) field.onChange(value === true);
                          }}
                          onBlur={() => {
                            if (model.canEdit()) field.onBlur();
                          }}
                          disabled={model.locked || !terms}
                          className="mt-0.5"
                        />
                      </FormControl>
                      <div id="tos-label" className="text-sm font-normal leading-relaxed">
                        {t('auth.register.tosPrefix', locale)}{' '}
                        <a
                          ref={termsTrigger}
                          href={
                            terms
                              ? `/terms?lang=${locale}&version=${encodeURIComponent(terms.id)}`
                              : undefined
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(event) => {
                            if (!terms || model.locked) {
                              event.preventDefault();
                              return;
                            }
                            if (
                              window.matchMedia('(max-width: 767px)').matches &&
                              !event.ctrlKey &&
                              !event.metaKey &&
                              !event.shiftKey &&
                              !event.altKey
                            ) {
                              event.preventDefault();
                              setTermsOpen(true);
                            }
                          }}
                          aria-disabled={!terms || model.locked}
                          className="font-medium text-foreground underline underline-offset-4 hover:text-foreground"
                          aria-label={t('auth.register.tosLinkText', locale)}
                        >
                          {t('auth.register.tosLinkText', locale)}
                        </a>{' '}
                        {t('auth.register.tosSuffix', locale)}
                      </div>
                    </div>
                    <FormMessage />
                    {tosError && (
                      <p role="alert" className="text-sm text-destructive">
                        {t('tos.page.error', locale)}
                      </p>
                    )}
                  </FormItem>
                )}
              />
              {model.uncertain && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={model.busy}
                  onClick={() => {
                    if (model.restart()) setError(null);
                  }}
                >
                  {registrationFormText('restart', locale)}
                </Button>
              )}
              <Button type="submit" className="w-full" disabled={model.locked || !terms}>
                {t(model.busy ? 'auth.register.submitting' : 'auth.register.submit', locale)}
              </Button>
            </form>
          </Form>
        </div>
        {termsOpen && terms && (
          <Suspense fallback={null}>
            <RegistrationTermsDialog
              locale={locale}
              versionId={terms.versionId}
              content={terms.content}
              finalFocus={termsTrigger}
              onClose={() => setTermsOpen(false)}
            />
          </Suspense>
        )}
      </>
    </AuthLayout>
  );
}
