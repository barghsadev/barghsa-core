import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import {
  UserIcon,
  MailIcon,
  PhoneIcon,
  AlertCircleIcon,
  Loader2Icon,
  KeyIcon,
  PlusIcon,
  SendIcon,
  CheckIcon,
  XIcon,
} from 'lucide-react';
import { Button, Input, Alert, AlertTitle, AlertDescription } from '@barghsa/ui';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  type FieldValues,
  type FieldPath,
  type UseFormReturn,
} from '@barghsa/ui/form';
import { useLocale } from '../../../hooks/useLocale.js';
import { useAccountSettingsEditor } from '../../../hooks/useAccountSettingsEditor.js';

export const Route = createFileRoute('/_app/settings/username')({
  component: SettingsUsernamePage,
});
function maskUsername(username: string): string {
  return username.slice(0, 3) + (username.length <= 8 ? '***' : '...') + username.slice(-3);
}
function AccountField<Values extends FieldValues>({
  form,
  name,
  id,
  label,
  locked,
  canEdit,
  otp = false,
  type = 'text',
  placeholder,
}: {
  form: UseFormReturn<Values>;
  name: FieldPath<Values>;
  id: string;
  label: string;
  locked: boolean;
  canEdit: () => boolean;
  otp?: boolean;
  type?: 'text' | 'email' | 'tel';
  placeholder?: string;
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id} className="space-y-1.5">
          <FormLabel htmlFor={id} className="text-xs">
            {label}
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              id={id}
              type={type === 'email' ? 'text' : type}
              inputMode={type === 'email' ? 'email' : undefined}
              placeholder={placeholder}
              disabled={locked}
              onChange={(event) => {
                if (canEdit()) field.onChange(event);
              }}
              {...(otp
                ? { inputMode: 'numeric' as const, autoComplete: 'one-time-code', maxLength: 6 }
                : {})}
              className={otp ? 'text-sm font-mono w-40' : 'text-sm'}
              dir="ltr"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
function SettingsUsernamePage() {
  const locale = useLocale(),
    editor = useAccountSettingsEditor(locale);
  const {
    user,
    loading,
    locked,
    busy,
    error,
    copy,
    usernameForm,
    contactForm,
    usernameValues,
    contactValues,
    usernameChallenge,
    contactChallenge,
    contactType,
    showUsername,
  } = editor;
  function cancel(family: 'username' | 'contact') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={locked}
        onClick={() => editor.cancel(family)}
        className="gap-1"
      >
        <XIcon aria-hidden="true" className="h-3.5 w-3.5" />
        {t('settings.contact.cancel', locale)}
      </Button>
    );
  }
  function submit(verify: boolean, disabled: boolean) {
    return (
      <Button type="submit" size="sm" disabled={locked || disabled} className="gap-1">
        {busy ? (
          <Loader2Icon aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
        ) : verify ? (
          <CheckIcon aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <SendIcon aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {t(verify ? 'settings.contact.verify' : 'settings.contact.sendOtp', locale)}
      </Button>
    );
  }
  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">{t('settings.username.title', locale)}</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading || locked || !editor.canRead()}
          onClick={() => void editor.refresh()}
        >
          {copy('refresh')}
        </Button>
      </div>
      {loading && (
        <div className="text-center py-8 text-muted-foreground">
          <UserIcon aria-hidden="true" className="mx-auto h-6 w-6 animate-pulse mb-2" />
          <p className="text-sm">{t('settings.profile.loading', locale)}</p>
        </div>
      )}
      {!loading && error && (
        <Alert variant="destructive" className="mb-6" data-slot="account-settings-feedback">
          <AlertCircleIcon aria-hidden="true" className="h-4 w-4" />
          <AlertTitle>{t('settings.security.error.title', locale)}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          {editor.uncertain && (
            <div className="mt-3 space-y-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void editor.confirm()}
              >
                {copy('confirm')}
              </Button>
              {editor.canRestart && (
                <>
                  <p className="text-sm">{copy('restartHelp')}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={editor.restart}
                  >
                    {copy('restart')}
                  </Button>
                </>
              )}
            </div>
          )}
        </Alert>
      )}
      {!loading && user && (
        <div className="space-y-8">
          <section
            className="rounded-lg border p-4 space-y-4"
            aria-labelledby="username-section-title"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyIcon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <h2 id="username-section-title" className="text-base font-semibold">
                  {t('settings.username.current', locale)}
                </h2>
              </div>
              {!showUsername && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={locked}
                  onClick={editor.openUsername}
                  className="gap-1"
                >
                  <KeyIcon aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('settings.username.change', locale)}
                </Button>
              )}
            </div>
            <p className="text-sm font-mono text-muted-foreground" dir="ltr">
              {maskUsername(user.username)}
            </p>
            {showUsername && (
              <Form {...usernameForm}>
                <form
                  noValidate
                  data-slot="account-username-form"
                  ref={editor.usernameFeedback.element}
                  onSubmit={(event) => void editor.prepareUsername(event)}
                  aria-busy={busy || usernameForm.formState.isSubmitting}
                  className="space-y-3 pt-2 border-t"
                >
                  {!usernameChallenge ? (
                    <AccountField
                      form={usernameForm}
                      name="newUsername"
                      id="new-username"
                      label={t('settings.username.newLabel', locale)}
                      placeholder={t('settings.username.newPlaceholder', locale)}
                      locked={locked}
                      canEdit={editor.canEdit}
                    />
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.username.pairSent', locale)}
                      </p>
                      <AccountField
                        form={usernameForm}
                        name="previousOtp"
                        id="previous-otp"
                        otp
                        label={t('settings.username.previousOtp', locale).replace(
                          '{destination}',
                          maskUsername(usernameChallenge.previousDestination!)
                        )}
                        locked={locked}
                        canEdit={editor.canEdit}
                      />
                      <AccountField
                        form={usernameForm}
                        name="otp"
                        id="change-otp"
                        otp
                        label={t('settings.username.newOtp', locale).replace(
                          '{destination}',
                          maskUsername(usernameChallenge.destination)
                        )}
                        placeholder={t('settings.username.otpPlaceholder', locale)}
                        locked={locked}
                        canEdit={editor.canEdit}
                      />
                    </>
                  )}
                  {usernameForm.formState.errors.root && (
                    <p role="alert" className="text-sm text-destructive">
                      {copy('validationUnavailable')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {cancel('username')}
                    {submit(
                      !!usernameChallenge,
                      !!usernameChallenge &&
                        (usernameValues.otp.length !== 6 || usernameValues.previousOtp.length !== 6)
                    )}
                  </div>
                </form>
              </Form>
            )}
          </section>
          <section
            className="rounded-lg border p-4 space-y-4"
            aria-labelledby="contact-section-title"
          >
            <div className="flex items-center gap-2">
              <MailIcon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              <h2 id="contact-section-title" className="text-base font-semibold">
                {t('settings.contact.title', locale)}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('settings.contact.loginHelp', locale)}
            </p>
            {(['email', 'mobile'] as const).map((type) => {
              const value = user[type],
                verified = type === 'email' ? user.emailVerified : user.mobileVerified;
              const Icon = type === 'email' ? MailIcon : PhoneIcon;
              return (
                <div key={type} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{t('settings.contact.' + type, locale)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-sm font-mono text-muted-foreground"
                      dir={value ? 'ltr' : undefined}
                    >
                      {value ?? (locale === 'fa' ? 'ثبت نشده' : 'Not set')}
                    </span>
                    {value && (
                      <span className="text-xs text-muted-foreground">
                        {t(
                          verified ? 'settings.contact.verified' : 'settings.contact.unverified',
                          locale
                        )}
                      </span>
                    )}
                    {!verified && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={locked || contactType !== null}
                        onClick={() => editor.openContact(type)}
                        className="gap-1 text-xs"
                      >
                        <PlusIcon aria-hidden="true" className="h-3 w-3" />
                        {t(
                          value
                            ? type === 'email'
                              ? 'settings.contact.verifyEmail'
                              : 'settings.contact.verifyMobile'
                            : type === 'email'
                              ? 'settings.contact.addEmail'
                              : 'settings.contact.addMobile',
                          locale
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {contactType && (
              <Form {...contactForm}>
                <form
                  noValidate
                  data-slot="account-contact-form"
                  ref={editor.contactFeedback.element}
                  onSubmit={(event) => void editor.prepareContact(event)}
                  aria-busy={busy || contactForm.formState.isSubmitting}
                  className="space-y-3 pt-2 border-t"
                >
                  {!contactChallenge ? (
                    <AccountField
                      form={contactForm}
                      name="contactValue"
                      id="new-contact"
                      type={contactType === 'email' ? 'email' : 'tel'}
                      label={t('settings.contact.' + contactType, locale)}
                      placeholder={t(
                        contactType === 'email'
                          ? 'settings.contact.newEmailPlaceholder'
                          : 'settings.contact.newMobilePlaceholder',
                        locale
                      )}
                      locked={locked}
                      canEdit={editor.canEdit}
                    />
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.contact.otpSent', locale).replace(
                          '{destination}',
                          contactChallenge.destination
                        )}
                      </p>
                      <AccountField
                        form={contactForm}
                        name="otp"
                        id="contact-otp"
                        otp
                        label={t('settings.contact.otpLabel', locale)}
                        placeholder={t('settings.contact.otpPlaceholder', locale)}
                        locked={locked}
                        canEdit={editor.canEdit}
                      />
                    </>
                  )}
                  {contactForm.formState.errors.root && (
                    <p role="alert" className="text-sm text-destructive">
                      {copy('validationUnavailable')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    {cancel('contact')}
                    {submit(
                      !!contactChallenge,
                      !!contactChallenge && contactValues.otp.length !== 6
                    )}
                  </div>
                </form>
              </Form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
