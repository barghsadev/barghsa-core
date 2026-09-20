import { t, type Locale } from '@barghsa/i18n/app';
import { Button } from '@barghsa/ui';

export function GeographyLoadError({
  error,
  retry,
  message,
  locale,
  testId,
}: {
  error: boolean;
  retry: () => void;
  message: string;
  locale: Locale;
  testId: string;
}) {
  return error ? (
    <div role="alert" className="space-y-2 text-sm text-destructive">
      <p>{message}</p>
      <Button type="button" variant="outline" onClick={retry} data-testid={testId}>
        {t('onboarding.draft.retry', locale)}
      </Button>
    </div>
  ) : null;
}
