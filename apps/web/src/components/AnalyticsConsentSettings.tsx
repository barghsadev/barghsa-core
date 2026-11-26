import { Button } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
import { useLocale } from '../hooks/useLocale.js';
import { useAnalyticsConsent } from '../providers/AnalyticsConsentProvider.js';
import { RecordEditorActions } from './RecordEditorLayout.js';

export function AnalyticsConsentSettings({
  coordination,
}: {
  coordination: { locked: boolean; isLocked(): boolean; claim(): boolean; release(): void };
}) {
  const locale = useLocale();
  const copy = (key: string) => tPreferenceSettingsForms(key, locale);
  const { consent, status, saving, saveError, updateConsent, reload } = useAnalyticsConsent();
  async function choose(value: boolean) {
    if (saving || coordination.isLocked() || !coordination.claim()) return;
    try {
      await updateConsent(value);
    } finally {
      coordination.release();
    }
  }
  return (
    <section aria-label={shellText('analyticsTitle', locale)} className="min-w-0">
      <div className="space-y-2.5 px-4 py-4 sm:px-6">
        <h2 className="text-base font-semibold">{shellText('analyticsTitle', locale)}</h2>
        <p className="text-sm text-muted-foreground">{copy('analyticsDescription')}</p>
        {status === 'loading' && <p role="status">{copy('analyticsLoading')}</p>}
        {status === 'error' && (
          <Button
            type="button"
            variant="outline"
            disabled={saving || coordination.locked}
            onClick={() => {
              if (!saving && !coordination.isLocked()) reload();
            }}
          >
            {copy('analyticsRetry')}
          </Button>
        )}
        {status === 'ready' && (
          <p role="status" className="w-fit rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
            {copy(
              consent === true
                ? 'analyticsAllowed'
                : consent === false
                  ? 'analyticsDeclined'
                  : 'analyticsUndecided'
            )}
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {shellText('analyticsError', locale)}
          </p>
        )}
      </div>
      {status === 'ready' && (
        <RecordEditorActions>
          <Button
            type="button"
            variant="outline"
            disabled={saving || coordination.locked || consent === false}
            onClick={() => void choose(false)}
          >
            {shellText('analyticsDecline', locale)}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving || coordination.locked || consent === true}
            onClick={() => void choose(true)}
          >
            {shellText('analyticsAllow', locale)}
          </Button>
        </RecordEditorActions>
      )}
    </section>
  );
}
