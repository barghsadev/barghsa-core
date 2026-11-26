import { t, type Locale } from '@barghsa/i18n/auth';
import { FormDescription } from '@barghsa/ui/form';

export function AuthUsernameHint({
  locale,
  formatted,
}: {
  locale: Locale;
  formatted: string | null;
}) {
  return (
    <FormDescription className="text-xs leading-4">
      {formatted ? (
        <>
          {t('auth.username.phonePreview', locale)}{' '}
          <bdi
            id="username-hint"
            dir="ltr"
            className="font-medium whitespace-nowrap text-foreground"
          >
            {formatted}
          </bdi>
        </>
      ) : (
        t('auth.username.phoneFormat', locale)
      )}
    </FormDescription>
  );
}
