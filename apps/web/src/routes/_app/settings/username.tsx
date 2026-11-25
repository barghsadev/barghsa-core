import { Skeleton } from '@barghsa/ui';
import { useEffect, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { MailIcon, PhoneIcon, AlertCircleIcon, KeyIcon } from 'lucide-react';
import { Button, Input, Alert, AlertTitle, AlertDescription, ListRefreshButton } from '@barghsa/ui';
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
import { maskDestination } from '../../../lib/mask-destination.js';
import {
  RecordEditorActions,
  recordEditorSurface,
} from '../../../components/RecordEditorLayout.js';

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
  focusOnOpen = false,
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
  focusOnOpen?: boolean;
  type?: 'text' | 'email' | 'tel';
  placeholder?: string;
}) {
  const focusPending = useRef(focusOnOpen);
  const setFocus = form.setFocus;
  useEffect(() => {
    if (!focusPending.current || locked) return;
    focusPending.current = false;
    setFocus(name);
  }, [locked, name, setFocus]);
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem id={id} className="space-y-1.5">
          <FormLabel htmlFor={id}>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              id={id}
              aria-required="true"
              type={type === 'email' ? 'text' : type}
              inputMode={type === 'email' ? 'email' : undefined}
              placeholder={otp ? '000000' : placeholder}
              disabled={locked}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => {
                if (canEdit()) field.onChange(event);
              }}
              {...(otp
                ? { inputMode: 'numeric' as const, autoComplete: 'one-time-code', maxLength: 6 }
                : {})}
              className={otp ? 'max-w-40 text-center font-mono tracking-widest' : 'max-w-sm'}
              dir="ltr"
            />
          </FormControl>
          <FormMessage reserveSpace className="min-h-8 text-xs leading-4" />
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
  const usernameTrigger = useRef<HTMLButtonElement>(null);
  const emailTrigger = useRef<HTMLButtonElement>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const contactHeading = useRef<HTMLHeadingElement>(null);
  const previousEditor = useRef({ showUsername, contactType });
  useEffect(() => {
    const previous = previousEditor.current;
    previousEditor.current = { showUsername, contactType };
    if (!user) return;
    if (previous.showUsername && !showUsername) usernameTrigger.current?.focus();
    if (previous.contactType && !contactType) {
      const trigger = previous.contactType === 'email' ? emailTrigger : mobileTrigger;
      (trigger.current ?? contactHeading.current)?.focus();
    }
  }, [showUsername, contactType, user]);
  function cancel(family: 'username' | 'contact') {
    return (
      <Button type="button" variant="ghost" disabled={locked} onClick={() => editor.cancel(family)}>
        {t('settings.contact.cancel', locale)}
      </Button>
    );
  }
  function submit(verify: boolean, disabled: boolean) {
    return (
      <Button type="submit" loading={busy} disabled={locked || disabled}>
        {t(verify ? 'settings.contact.verify' : 'settings.contact.sendOtp', locale)}
      </Button>
    );
  }
  return (
    <div className="mx-auto max-w-4xl min-w-0 space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('settings.username.title', locale)}</h1>
        <ListRefreshButton
          label={copy('refresh')}
          refreshing={loading}
          disabled={locked || !editor.canRead()}
          onClick={() => void editor.refresh()}
        />
      </header>
      {loading && (
        <div className="space-y-2 py-5 text-muted-foreground" role="status">
          <Skeleton className="h-6 w-20 shrink-0" />
          <p className="text-sm">{t('settings.profile.loading', locale)}</p>
        </div>
      )}
      {!loading && error && (
        <Alert variant="destructive" data-slot="account-settings-feedback">
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
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
          <section className={recordEditorSurface} aria-labelledby="username-section-title">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
              <div className="min-w-0 space-y-1.5">
                <h2
                  id="username-section-title"
                  className="flex items-center gap-2 text-base font-semibold"
                >
                  <KeyIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  {t('settings.username.current', locale)}
                </h2>
                <p className="text-sm font-mono text-muted-foreground">
                  <bdi dir="ltr">{maskUsername(user.username)}</bdi>
                </p>
              </div>
              {!showUsername && (
                <Button
                  ref={usernameTrigger}
                  type="button"
                  variant="outline"
                  disabled={locked}
                  onClick={editor.openUsername}
                >
                  {t('settings.username.change', locale)}
                </Button>
              )}
            </div>
            {showUsername && (
              <Form {...usernameForm}>
                <form
                  noValidate
                  data-slot="account-username-form"
                  ref={editor.usernameFeedback.element}
                  onSubmit={(event) => void editor.prepareUsername(event)}
                  aria-label={t('settings.username.change', locale)}
                  aria-busy={busy || usernameForm.formState.isSubmitting}
                  className="border-t"
                >
                  <div className="space-y-2.5 px-4 py-3 sm:px-6">
                    {!usernameChallenge ? (
                      <>
                        <p className="text-sm text-muted-foreground">{copy('usernameHelp')}</p>
                        <AccountField
                          form={usernameForm}
                          name="newUsername"
                          id="new-username"
                          label={t('settings.username.newLabel', locale)}
                          placeholder={t('settings.username.newPlaceholder', locale)}
                          locked={locked}
                          canEdit={editor.canEdit}
                          focusOnOpen
                        />
                      </>
                    ) : (
                      <>
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold">{copy('usernameCodes')}</h3>
                          <p className="text-sm text-muted-foreground">
                            {t('settings.username.pairSent', locale)}
                          </p>
                        </div>
                        <div className="grid min-w-0 gap-x-4 gap-y-1 min-[380px]:grid-cols-2">
                          <AccountField
                            form={usernameForm}
                            name="previousOtp"
                            id="previous-otp"
                            otp
                            focusOnOpen
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
                            locked={locked}
                            canEdit={editor.canEdit}
                          />
                        </div>
                      </>
                    )}
                    {usernameForm.formState.errors.root && (
                      <p role="alert" className="text-sm text-destructive">
                        {copy('validationUnavailable')}
                      </p>
                    )}
                  </div>
                  <RecordEditorActions>
                    {cancel('username')}
                    {submit(
                      !!usernameChallenge,
                      !!usernameChallenge &&
                        (usernameValues.otp.length !== 6 || usernameValues.previousOtp.length !== 6)
                    )}
                  </RecordEditorActions>
                </form>
              </Form>
            )}
          </section>
          <section className={recordEditorSurface} aria-labelledby="contact-section-title">
            <header className="space-y-1.5 px-4 py-4 sm:px-6">
              <h2
                ref={contactHeading}
                id="contact-section-title"
                tabIndex={-1}
                className="flex items-center gap-2 text-base font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
              >
                <MailIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {t('settings.contact.title', locale)}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.contact.loginHelp', locale)}
              </p>
            </header>
            {(['email', 'mobile'] as const).map((type) => {
              const value = user[type],
                verified = type === 'email' ? user.emailVerified : user.mobileVerified;
              const Icon = type === 'email' ? MailIcon : PhoneIcon;
              const actionLabel = t(
                value
                  ? type === 'email'
                    ? 'settings.contact.verifyEmail'
                    : 'settings.contact.verifyMobile'
                  : type === 'email'
                    ? 'settings.contact.addEmail'
                    : 'settings.contact.addMobile',
                locale
              );
              return (
                <div key={type} className="border-t">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <Icon
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        {t('settings.contact.' + type, locale)}
                        {value && (
                          <span
                            className={
                              verified
                                ? 'rounded-full bg-success-soft px-2 py-0.5 text-xs font-normal text-success'
                                : 'rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground'
                            }
                          >
                            {t(
                              verified
                                ? 'settings.contact.verified'
                                : 'settings.contact.unverified',
                              locale
                            )}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {value ? <bdi dir="ltr">{value}</bdi> : copy('notSet')}
                      </p>
                    </div>
                    {!verified && contactType !== type && (
                      <Button
                        ref={type === 'email' ? emailTrigger : mobileTrigger}
                        type="button"
                        variant="outline"
                        disabled={locked || contactType !== null}
                        onClick={() => editor.openContact(type)}
                      >
                        {actionLabel}
                      </Button>
                    )}
                  </div>
                  {contactType === type && (
                    <Form {...contactForm}>
                      <form
                        noValidate
                        data-slot="account-contact-form"
                        ref={editor.contactFeedback.element}
                        onSubmit={(event) => void editor.prepareContact(event)}
                        aria-label={actionLabel}
                        aria-busy={busy || contactForm.formState.isSubmitting}
                      >
                        <div className="space-y-2.5 border-t bg-muted/20 px-4 py-3 sm:px-6">
                          {!contactChallenge ? (
                            <AccountField
                              form={contactForm}
                              name="contactValue"
                              id="new-contact"
                              type={type === 'email' ? 'email' : 'tel'}
                              label={t('settings.contact.' + type, locale)}
                              placeholder={t(
                                type === 'email'
                                  ? 'settings.contact.newEmailPlaceholder'
                                  : 'settings.contact.newMobilePlaceholder',
                                locale
                              )}
                              locked={locked}
                              canEdit={editor.canEdit}
                              focusOnOpen
                            />
                          ) : (
                            <>
                              <div className="space-y-1">
                                <h3 className="text-sm font-semibold">{copy('contactCode')}</h3>
                                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                                  {t('settings.contact.otpSent', locale).replace(
                                    '{destination}',
                                    maskDestination(contactChallenge.destination)
                                  )}
                                </p>
                              </div>
                              <AccountField
                                form={contactForm}
                                name="otp"
                                id="contact-otp"
                                otp
                                label={t('settings.contact.otpLabel', locale)}
                                locked={locked}
                                canEdit={editor.canEdit}
                                focusOnOpen
                              />
                            </>
                          )}
                          {contactForm.formState.errors.root && (
                            <p role="alert" className="text-sm text-destructive">
                              {copy('validationUnavailable')}
                            </p>
                          )}
                        </div>
                        <RecordEditorActions>
                          {cancel('contact')}
                          {submit(
                            !!contactChallenge,
                            !!contactChallenge && contactValues.otp.length !== 6
                          )}
                        </RecordEditorActions>
                      </form>
                    </Form>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
    </div>
  );
}
