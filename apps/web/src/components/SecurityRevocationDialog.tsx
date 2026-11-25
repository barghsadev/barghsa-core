import { useRef, type RefObject } from 'react';
import { ShieldMinus } from 'lucide-react';
import {
  Button,
  ConfirmationFields,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { trustedDeviceText } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import type { SecurityOwner, SecurityLists } from '../hooks/useSecuritySettings.js';
import { useSecurityRevocationForm } from '../hooks/useSecurityRevocationForm.js';
import type { SecurityOperation } from '../lib/security-settings-form.js';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
export function SecurityRevocationDialog({
  scope,
  lists,
  operation,
  locale,
  finalFocus,
  close,
  done,
  deviceName,
  formatTimestamp,
}: {
  scope: SecurityOwner;
  lists: SecurityLists;
  operation: SecurityOperation;
  locale: Locale;
  finalFocus: RefObject<HTMLElement | null>;
  close: () => void;
  done: () => void;
  deviceName: (value: string | undefined, locale: Locale) => string;
  formatTimestamp: (value: string) => string;
}) {
  const gate = useRiskConfirmation(operation, locale, 'destructive');
  const authorized = useRef(gate.allowed);
  authorized.current = gate.allowed;
  const model = useSecurityRevocationForm(
    scope,
    lists,
    operation,
    locale,
    done,
    () => authorized.current
  );
  const text = (key: string) => securitySettingsText(key, locale);
  const changesTrust = operation.kind === 'trust' || operation.kind === 'allTrust';
  const title = changesTrust
    ? trustedDeviceText(operation.kind === 'allTrust' ? 'removeAll' : 'remove', locale)
    : t(
        operation.kind === 'others' ? 'settings.security.revokeAll' : 'settings.security.revoke',
        locale
      );
  const target =
    operation.kind === 'trust'
      ? {
          agent: operation.target.userAgent ?? undefined,
          ip: operation.target.ip,
          date: operation.target.trustedAt,
          dateLabel: trustedDeviceText('trustedAt', locale),
        }
      : operation.kind === 'session'
        ? {
            agent: operation.target.deviceInfo?.userAgent,
            ip: operation.target.deviceInfo?.ip,
            date: operation.target.createdAt,
            dateLabel: text('signedInAt'),
          }
        : null;
  const passwordId =
    operation.kind === 'others'
      ? 'revoke-password'
      : changesTrust
        ? 'trusted-device-password'
        : 'revoke-single-password';
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && scope.isCurrent() && !scope.isLocked()) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b p-4 sm:px-5">
          <span className="grid size-9 place-items-center rounded-lg bg-danger-soft text-destructive">
            <ShieldMinus aria-hidden="true" className="size-4" />
          </span>
          <div className="space-y-1">
            <DialogTitle className="text-base leading-snug font-semibold">{title}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {changesTrust
                ? trustedDeviceText(
                    operation.kind === 'allTrust' ? 'confirmAll' : 'confirm',
                    locale
                  )
                : t(
                    operation.kind === 'others'
                      ? 'settings.security.revokeAllConfirm'
                      : 'settings.security.revokeConfirm',
                    locale
                  )}
            </DialogDescription>
          </div>
        </DialogHeader>
        <Form {...model.form}>
          <form
            noValidate
            ref={model.feedback.element}
            onSubmit={model.submit}
            aria-busy={model.busy}
          >
            <div className="space-y-3 px-4 py-4 sm:px-5">
              {target && (
                <div className="rounded-lg bg-muted/55 px-3 py-2.5">
                  <p className="font-medium break-words">{deviceName(target.agent, locale)}</p>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    {target.ip && (
                      <>
                        <dt>{text('ipAddress')}</dt>
                        <dd className="break-all">
                          <bdi dir="ltr">{target.ip}</bdi>
                        </dd>
                      </>
                    )}
                    <dt>{target.dateLabel}</dt>
                    <dd>{formatTimestamp(target.date)}</dd>
                  </dl>
                </div>
              )}
              {model.needsPassword && (
                <FormField
                  control={model.form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem id={passwordId}>
                      <FormLabel>{t('settings.security.passwordLabel', locale)}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          aria-required="true"
                          autoComplete="current-password"
                          autoFocus
                          disabled={scope.locked}
                          onChange={(event) => {
                            if (scope.isCurrent() && !scope.isLocked()) field.onChange(event);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <ConfirmationFields gate={gate} disabled={scope.locked} />
              {model.error && (
                <p
                  role="alert"
                  className="rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive"
                >
                  {model.error}
                </p>
              )}
            </div>
            <DialogFooter className="m-0 flex-row flex-wrap justify-end gap-2 bg-muted/35 px-4 py-3 sm:px-5">
              <Button
                type="button"
                variant="ghost"
                autoFocus={!model.needsPassword}
                disabled={scope.locked}
                onClick={() => {
                  if (scope.isCurrent() && !scope.isLocked()) close();
                }}
              >
                {t('settings.security.cancel', locale)}
              </Button>
              {model.uncertain ? (
                <>
                  {model.checked && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={model.busy}
                      onClick={model.restart}
                    >
                      {text('restart')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="h-auto min-h-11 min-w-0 whitespace-normal"
                    loading={model.busy}
                    onClick={() => void model.confirm()}
                  >
                    {text(model.busy ? 'checking' : 'check')}
                  </Button>
                </>
              ) : (
                <Button
                  type="submit"
                  variant="destructive"
                  className="h-auto min-h-11 min-w-0 whitespace-normal"
                  loading={model.busy}
                  disabled={scope.locked || !gate.allowed}
                >
                  {title}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
