import { useState } from 'react';
import { Button, LoadingStatus } from '@barghsa/ui';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { useLocale } from '../hooks/useLocale.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  isMaintenanceHistory,
  isMaintenanceRecoveryDraft,
  type MaintenanceHistoryEntry,
  type MaintenanceRecoveryDraft,
  type MaintenanceSetting,
} from '../lib/maintenance-form.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { TeamActionDialog } from './TeamActionDialog.js';

async function readHistory(response: Response) {
  if (!response.ok) throw new ServerQueryError(response.status);
  const data: unknown = await response.json();
  if (!isMaintenanceHistory(data)) throw new Error('Invalid maintenance history');
  return data;
}

export function MaintenanceRecovery({
  setting,
  disabled,
  formatTime,
  onLoad,
  onDenied,
}: {
  setting: MaintenanceSetting;
  disabled: boolean;
  formatTime: (value: string) => string;
  onLoad: (draft: MaintenanceRecoveryDraft) => void;
  onDenied: () => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tMaintenance(key, locale);
  const [before, setBefore] = useState<number | null>(null);
  const [source, setSource] = useState<MaintenanceHistoryEntry | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const path = `/api/admin/maintenance/${setting.capability}`;
  const history = useAsyncData(
    `${path}/history${before === null ? '' : `?beforeVersion=${before}`}`,
    {
      read: readHistory,
    }
  );
  if (history.status === 'loading') return <LoadingStatus>{copy('loadingHistory')}</LoadingStatus>;
  if (history.status === 'error') {
    if (history.error.code === 'READ_DENIED') return <p role="alert">{copy('denied')}</p>;
    return (
      <div role="alert" className="space-y-2">
        <p>{copy('historyError')}</p>
        <Button type="button" variant="outline" onClick={history.retry}>
          {copy('refresh')}
        </Button>
      </div>
    );
  }
  const { baseVersion, items, nextBeforeVersion, draft } = history.data;
  if (baseVersion !== setting.version) return <p role="alert">{copy('versionConflict')}</p>;
  const displayVersion = (version: number) => numbers.number(version, { useGrouping: false });
  return (
    <section aria-label={copy('history')} className="max-w-2xl space-y-3 rounded-lg border p-4">
      {uncertain && <p role="alert">{copy('unconfirmedDraft')}</p>}
      {draft?.setting.capability === setting.capability && (
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !!source}
          onClick={() => onLoad(draft)}
        >
          {copy('resumeRecovery').replace('{version}', displayVersion(draft.setting.version))}
        </Button>
      )}
      {items.length === 0 && <p>{copy('emptyHistory')}</p>}
      <ul className="space-y-2">
        {items
          .filter(({ setting: previous }) => previous.capability === setting.capability)
          .map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm">
                {copy('revision').replace('{version}', displayVersion(item.setting.version))}
                {' · '}
                {copy(item.setting.active ? 'active' : 'inactive')}
                {' · '}
                {formatTime(item.setting.updatedAt!)}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={disabled || !!source}
                onClick={() => setSource(item)}
              >
                {copy('restoreRevision').replace('{version}', displayVersion(item.setting.version))}
              </Button>
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {before !== null && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !!source}
            onClick={() => setBefore(null)}
          >
            {copy('latestRevisions')}
          </Button>
        )}
        {nextBeforeVersion !== null && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !!source}
            onClick={() => setBefore(nextBeforeVersion)}
          >
            {copy('olderRevisions')}
          </Button>
        )}
      </div>
      {source && (
        <TeamActionDialog
          action={{
            title: copy('restoreRevision').replace(
              '{version}',
              displayVersion(source.setting.version)
            ),
            description: copy('restoreConfirm'),
            path: `${path}/rollback-draft`,
            method: 'POST',
            successStatus: 201,
            body: { sourceId: source.id, expectedVersion: baseVersion },
            forbiddenMessage: copy('denied'),
            conflictMessage: copy('versionConflict'),
          }}
          confirmationDisabled={disabled}
          onClose={() => setSource(null)}
          onDenied={onDenied}
          onUnconfirmed={() => {
            setSource(null);
            setUncertain(true);
            history.retry();
          }}
          onSuccess={async (value) => {
            if (
              !isMaintenanceRecoveryDraft(value) ||
              value.sourceId !== source.id ||
              value.baseVersion !== baseVersion ||
              value.setting.capability !== setting.capability ||
              value.setting.version !== source.setting.version
            )
              throw new Error('Unconfirmed maintenance recovery draft');
            setUncertain(false);
            onLoad(value);
          }}
        />
      )}
    </section>
  );
}
