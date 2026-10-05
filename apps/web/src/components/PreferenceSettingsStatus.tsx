import { Button } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
type State = {
  loading: boolean;
  loadFailed: boolean;
  busy: boolean;
  error: string | null;
  uncertain: boolean;
  checked: boolean;
  saved: boolean;
  refresh(): Promise<void>;
  confirm(): Promise<void>;
  restart(): void;
};
export function PreferenceSettingsStatus({
  editor,
  locale,
  locked,
  enabled,
  loadError,
  retry,
  success,
  saveError,
}: {
  editor: State;
  locale: Locale;
  locked: boolean;
  enabled: boolean;
  loadError: string;
  retry: string;
  success: string;
  saveError: string;
}) {
  const copy = (key: string) => tPreferenceSettingsForms(key, locale);
  return (
    <div className="space-y-2">
      {editor.loading && <p role="status">{copy('loading')}</p>}
      {editor.loadFailed && <p role="alert">{loadError}</p>}
      {editor.error && (
        <div role="alert" className="text-sm text-destructive">
          <p>{saveError}</p>
          <p>{editor.error}</p>
        </div>
      )}
      {editor.saved && <p role="status">{success}</p>}
      <div className="flex flex-wrap gap-2">
        {editor.uncertain ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={editor.busy || !enabled}
              onClick={() => void editor.confirm()}
            >
              {copy('confirm')}
            </Button>
            {editor.checked && (
              <Button
                type="button"
                variant="outline"
                disabled={editor.busy || !enabled}
                onClick={editor.restart}
              >
                {copy('restart')}
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={locked || editor.loading || !enabled}
            onClick={() => void editor.refresh()}
          >
            {editor.loadFailed ? retry : copy('refresh')}
          </Button>
        )}
      </div>
      {editor.uncertain && <p className="text-xs text-muted-foreground">{copy('restartHelp')}</p>}
    </div>
  );
}
