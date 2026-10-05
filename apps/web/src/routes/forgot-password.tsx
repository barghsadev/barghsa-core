import { useEffect, useRef } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
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
export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage });
function ForgotPasswordPage() {
  const router = useRouter(),
    locale = useLocale(),
    numbers = useNumberFormatting(locale);
  const model = usePasswordRecoveryForm(locale, numbers.numberStyle, async () => {
    toast.success(t('auth.resetPassword.success', locale), {
      description: t('auth.resetPassword.signIn', locale),
    });
    await router.navigate({ to: '/login', replace: true });
  });
  const form = model.form;
  const element = model.feedback.element;
  const stage = useRef(model.stage);
  stage.current = model.stage;
  useEffect(() => {
    if (model.authorization) document.getElementById('new-password')?.focus();
  }, [model.authorization]);
  const copy = (key: string) => passwordRecoveryText(key, locale);
  const validationError = form.formState.errors.root?.validation?.message;
  const error = model.error ?? validationError ?? null;
  return (
    <AuthLayout
      locale={locale}
      footer={
        <Link
          to="/login"
          className="text-sm text-foreground underline"
          onClick={(event) => {
            if (model.busy) event.preventDefault();
          }}
        >
          {t('auth.forgotPassword.backToLogin', locale)}
        </Link>
      }
    >
      <div className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <h1 className="text-xl font-semibold">
          {t(model.challenge ? 'auth.resetPassword.title' : 'auth.forgotPassword.title', locale)}
        </h1>
        {error && model.stage !== 'verify' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form
            noValidate
            ref={element}
            className="space-y-4"
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
                        autoComplete="username"
                        autoFocus
                        maxLength={255}
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
                <p className="text-sm text-muted-foreground">
                  {t('auth.forgotPassword.sent', locale)}
                </p>
                <p className="text-sm" dir="ltr">
                  {maskDestination(model.challenge!.destination)}
                </p>
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
                onClick={model.restart}
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
              <p role="status">
                {t('auth.otp.resendTimer', locale).replace(
                  '{seconds}',
                  numbers.number(
                    model.stage === 'request' ? model.cooldown : model.attemptCooldown,
                    { useGrouping: false }
                  )
                )}
              </p>
            )}
            {model.challenge && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
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
            )}
          </form>
        </Form>
      </div>
    </AuthLayout>
  );
}
