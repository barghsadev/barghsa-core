import type { RefObject } from 'react';
import { Button, Input, Dialog, DialogContent, DialogTitle, DialogDescription } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import { t, type Locale } from '@barghsa/i18n/app';
import { trustedDeviceText } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import type { SecurityOwner, SecurityLists } from '../hooks/useSecuritySettings.js';
import { useSecurityRevocationForm } from '../hooks/useSecurityRevocationForm.js';
import type { SecurityOperation } from '../lib/security-settings-form.js';
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
  const model = useSecurityRevocationForm(scope, lists, operation, locale, done);
  const text = (key: string) => securitySettingsText(key, locale);
  const title =
    operation.kind === 'trust'
      ? trustedDeviceText('remove', locale)
      : t(
          operation.kind === 'others' ? 'settings.security.revokeAll' : 'settings.security.revoke',
          locale
        );
  const passwordId =
    operation.kind === 'others'
      ? 'revoke-password'
      : operation.kind === 'trust'
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
        className="sm:max-w-md p-6 space-y-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {operation.kind === 'trust'
            ? trustedDeviceText('confirm', locale)
            : t(
                operation.kind === 'others'
                  ? 'settings.security.revokeAllConfirm'
                  : 'settings.security.revokeConfirm',
                locale
              )}
        </DialogDescription>
        {operation.kind !== 'others' && (
          <div className="text-sm rounded border p-3 bg-muted/20 space-y-1 break-words">
            <p className="font-medium">
              {deviceName(
                operation.kind === 'trust'
                  ? (operation.target.userAgent ?? undefined)
                  : operation.target.deviceInfo?.userAgent,
                locale
              )}
            </p>
            <bdi dir="ltr">
              {operation.kind === 'trust' ? operation.target.ip : operation.target.deviceInfo?.ip}
            </bdi>
            <p>
              {formatTimestamp(
                operation.kind === 'trust' ? operation.target.trustedAt : operation.target.createdAt
              )}
            </p>
          </div>
        )}
        <Form {...model.form}>
          <form
            noValidate
            ref={model.feedback.element}
            onSubmit={model.submit}
            className="space-y-4"
            aria-busy={model.busy}
          >
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
            {model.error && (
              <p role="alert" className="text-sm text-destructive">
                {model.error}
              </p>
            )}
            {model.uncertain && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full whitespace-normal"
                  disabled={model.busy}
                  onClick={() => void model.confirm()}
                >
                  {text(model.busy ? 'checking' : 'check')}
                </Button>
                {model.checked && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={model.busy}
                    onClick={model.restart}
                  >
                    {text('restart')}
                  </Button>
                )}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                autoFocus={!model.needsPassword}
                disabled={scope.locked}
                onClick={() => {
                  if (scope.isCurrent() && !scope.isLocked()) close();
                }}
              >
                {t('settings.security.cancel', locale)}
              </Button>
              <Button
                type="submit"
                variant={operation.kind === 'trust' ? 'outline' : 'destructive'}
                className={
                  operation.kind === 'trust'
                    ? undefined
                    : 'bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:text-white dark:hover:bg-red-800'
                }
                disabled={scope.locked}
              >
                {model.busy
                  ? t(
                      operation.kind === 'others'
                        ? 'settings.security.revokingAll'
                        : 'settings.security.revoking',
                      locale
                    )
                  : title}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
