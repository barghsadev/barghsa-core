import { useEffect, useRef } from 'react';
import { createFileRoute, Link, useRouter, useSearch } from '@tanstack/react-router';
import { authReturnSearch } from '../lib/auth-return.js';
import { t } from '@barghsa/i18n/auth';
import { passwordRecoveryText } from '@barghsa/i18n/password-recovery-forms';
import { Button, Input, Alert, AlertDescription } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import { AuthLayout } from '../components/AuthLayout.js';
import { PasswordField } from '../components/PasswordField.js';
import { OtpInput } from '../components/OtpInput.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { usePasswordRecoveryForm } from '../hooks/usePasswordRecoveryForm.js';
import { maskDestination } from '../lib/mask-destination.js';
import { toast } from '../lib/toast-api.js';
export const Route = createFileRoute('/forgot-password')({
  validateSearch: authReturnSearch,
  component: ForgotPasswordPage,
});
function ForgotPasswordPage() {
  const router = useRouter(),
    locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const { returnTo } = useSearch({ from: '/forgot-password' });
  const model = usePasswordRecoveryForm(locale, numbers.numberStyle, async () => {
    toast.success(t('auth.resetPassword.success', locale), {
      description: t('auth.resetPassword.signIn', locale),
    });
    await router.navigate({
      to: '/login',
      ...(returnTo ? { search: { returnTo } } : {}),
      replace: true,
    });
  });
  const form = model.form;
  const element = model.feedback.element;
  const stage = useRef(model.stage);
  const focusUsername = useRef(false);
  stage.current = model.stage;
  useEffect(() => {
    if (model.authorization)
      element.current?.querySelector<HTMLInputElement>('#new-password')?.focus();
    if (model.stage === 'request' && focusUsername.current) {
      focusUsername.current = false;
      element.current?.querySelector<HTMLInputElement>('#username')?.focus();
    }
  }, [model.authorization, model.stage, element]);
  const restart = () => {
    focusUsername.current = model.restart();
  };
  const copy = (key: string) => passwordRecoveryText(key, locale);
  const validationError = form.formState.errors.root?.validation?.message;
  const error = model.error ?? validationError ?? null;
  const title = {
    request: 'auth.forgotPassword.title',
    verify: 'auth.forgotPassword.otpTitle',
    reset: 'auth.resetPassword.title',
  }[model.stage];
  return (
    <AuthLayout
      locale={locale}
      footer={
        <Link
          to="/login"
          search={{ returnTo }}
          className="touch-action justify-center self-center text-sm text-foreground underline underline-offset-4"
          onClick={(event) => {
            if (model.busy) event.preventDefault();
          }}
        >
          {t('auth.forgotPassword.backToLogin', locale)}
        </Link>
      }
    >
      <div className="space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <div className="space-y-2">
          <h1 className="tracking-tight">{t(title, locale)}</h1>
          {model.stage === 'request' && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {copy('requestInstructions')}
            </p>
          )}
          {model.stage === 'verify' && model.challenge && (
            <p className="space-y-1 text-sm leading-relaxed text-muted-foreground">
              <span className="block">{t('auth.forgotPassword.sent', locale)}</span>
              <span className="block wrap-anywhere font-medium text-foreground">
                <bdi dir="ltr">{maskDestination(model.challenge.destination)}</bdi>
              </span>
            </p>
          )}
        </div>
        {error && model.stage !== 'verify' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form
            noValidate
            ref={element}
            className="space-y-3.5"
            aria-busy={model.busy}
            onSubmit={(event) => void model.perform(stage.current, event)}
          >
            {model.stage === 'request' ? (
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem id="username">
                    <FormLabel>{t('auth.register.emailLabel', locale)}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        dir="ltr"
                        aria-required="true"
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={255}
                        placeholder={t('auth.register.usernamePlaceholder', locale)}
                        disabled={model.locked}
                        onChange={(event) => {
                          if (model.canEdit(stage.current)) field.onChange(event);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <>
                {model.stage === 'verify' ? (
                  <div id="reset-otp">
                    <FormField
                      control={form.control}
                      name="otp"
                      render={({ field, fieldState }) => (
                        <OtpInput
                          key={model.challenge!.id}
                          id="recovery-code"
                          name={field.name}
                          locale={locale}
                          disabled={model.locked || model.attemptCooldown > 0}
                          error={fieldState.error?.message ?? error}
                          onClearError={() => {
                            if (model.canEdit(stage.current)) {
                              model.clearError();
                              form.clearErrors('otp');
                            }
                          }}
                          onChange={(value) => {
                            if (model.canEdit(stage.current)) field.onChange(value);
                          }}
                          onComplete={() => void model.perform('verify')}
                        />
                      )}
                    />
                  </div>
                ) : (
                  <>
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field, fieldState }) => (
                        <div
                          onBlurCapture={() => {
                            if (model.canEdit(stage.current)) field.onBlur();
                          }}
                        >
                          <PasswordField
                            id="new-password"
                            name={field.name}
                            label={t('auth.resetPassword.newPassword', locale)}
                            locale={locale}
                            value={field.value}
                            error={fieldState.error?.message ?? null}
                            disabled={model.locked}
                            onChange={(value) => {
                              if (model.canEdit(stage.current)) field.onChange(value);
                            }}
                          />
                        </div>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmation"
                      render={({ field, fieldState }) => (
                        <div
                          onBlurCapture={() => {
                            if (model.canEdit(stage.current)) field.onBlur();
                          }}
                        >
                          <PasswordField
                            id="confirm-password"
                            name={field.name}
                            label={t('auth.resetPassword.confirmPassword', locale)}
                            locale={locale}
                            value={field.value}
                            error={fieldState.error?.message ?? null}
                            showStrength={false}
                            disabled={model.locked}
                            onChange={(value) => {
                              if (model.canEdit(stage.current)) field.onChange(value);
                            }}
                          />
                        </div>
                      )}
                    />
                  </>
                )}
              </>
            )}
            {model.uncertain && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={model.busy}
                onClick={restart}
              >
                {copy('restart')}
              </Button>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={
                model.locked ||
                (model.stage === 'request' ? model.cooldown > 0 : model.attemptCooldown > 0)
              }
            >
              {t(
                model.stage === 'request'
                  ? model.busy
                    ? 'auth.forgotPassword.submitting'
                    : 'auth.forgotPassword.submit'
                  : model.stage === 'verify'
                    ? model.busy
                      ? 'auth.otp.verifying'
                      : 'auth.otp.verifyButton'
                    : model.busy
                      ? 'auth.resetPassword.submitting'
                      : 'auth.resetPassword.submit',
                locale
              )}
            </Button>
            {(model.stage === 'request' ? model.cooldown : model.attemptCooldown) > 0 && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('auth.otp.resendTimer', locale).replace(
                  '{seconds}',
                  numbers.number(
                    model.stage === 'request' ? model.cooldown : model.attemptCooldown,
                    { useGrouping: false }
                  )
                )}
              </p>
            )}
            {model.stage === 'verify' && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={model.locked || model.cooldown > 0}
                  onClick={() => void model.perform('request')}
                >
                  {model.cooldown > 0
                    ? t('auth.otp.resendTimer', locale).replace(
                        '{seconds}',
                        numbers.number(model.cooldown, { useGrouping: false })
                      )
                    : t('auth.otp.resend', locale)}
                </Button>
              </div>
            )}
            {model.stage === 'reset' && !model.uncertain && (
              <div className="flex justify-end">
                <Button type="button" variant="ghost" disabled={model.locked} onClick={restart}>
                  {copy('restart')}
                </Button>
              </div>
            )}
          </form>
        </Form>
      </div>
    </AuthLayout>
  );
}
