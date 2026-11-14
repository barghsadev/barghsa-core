import { useCallback, useState, type ReactNode } from 'react';
import { Alert, Button, LoadingStatus } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { record } from '../lib/catalogue-form.js';
import { validVersionId } from '../lib/electricity-settings-form.js';
import { ServerQueryError } from '../lib/server-query-client.js';

type Copy = (key: string) => string;
type Revision<T> = { id: string; version: number; config: T };
type Draft<T> = {
  id: string;
  baseVersion: number;
  sourceId: string;
  sourceVersion: number;
  config: T;
};
type History<T> = {
  baseVersion: number;
  items: Revision<T>[];
  nextBeforeVersion: number | null;
  draft: Draft<T> | null;
};
type Selection<T> = (
  | { kind: 'stage'; revision: Revision<T>; baseVersion: number }
  | { kind: 'activate'; draft: Draft<T> }
) & { action: TeamAction };

const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validRevision = <T,>(value: unknown, valid: Validator<T>): value is Revision<T> =>
  record(value) && validVersionId(value.id) && version(value.version) && valid(value.config);
const validDraft = <T,>(value: unknown, valid: Validator<T>): value is Draft<T> =>
  record(value) &&
  validVersionId(value.id) &&
  version(value.baseVersion) &&
  validVersionId(value.sourceId) &&
  version(value.sourceVersion) &&
  value.sourceVersion < value.baseVersion &&
  valid(value.config);

type Validator<T> = (value: unknown) => value is T;

async function readHistory<T>(response: Response, valid: Validator<T>): Promise<History<T>> {
  if (!response.ok) throw new ServerQueryError(response.status);
  const data: unknown = await response.json();
  if (
    !record(data) ||
    !(data.baseVersion === 0 || version(data.baseVersion)) ||
    !Array.isArray(data.items) ||
    !data.items.every((item) => validRevision(item, valid)) ||
    !(data.nextBeforeVersion === null || version(data.nextBeforeVersion)) ||
    !(
      data.draft === null ||
      (validDraft(data.draft, valid) && data.draft.baseVersion === data.baseVersion)
    )
  )
    throw new Error('Invalid configuration recovery history');
  return {
    baseVersion: data.baseVersion,
    items: data.items,
    nextBeforeVersion: data.nextBeforeVersion,
    draft: data.draft,
  };
}

export default function ConfigRecovery<T>({
  path,
  valid,
  basis,
  renderValues,
  label,
  disabled,
  onBusyChange,
  onDenied,
  onActivated,
  errorMessages,
}: {
  path: string;
  valid: Validator<T>;
  basis: (value: T) => string;
  renderValues: (value: T, label: Copy) => ReactNode;
  label: Copy;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDenied: () => void;
  onActivated: () => void;
  errorMessages?: TeamAction['errorMessages'];
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [before, setBefore] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection<T> | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const read = useCallback((response: Response) => readHistory(response, valid), [valid]);
  const history = useAsyncData(
    `${path}/rollback-history${before === null ? '' : `?beforeVersion=${before}`}`,
    { read }
  );
  if (history.status === 'loading')
    return <LoadingStatus>{label('recoveryLoading')}</LoadingStatus>;
  if (history.status === 'error') {
    if (history.error.code === 'READ_DENIED')
      return <Alert variant="destructive">{label('forbidden')}</Alert>;
    return (
      <div role="alert" className="space-y-2">
        <p>{label('recoveryReadError')}</p>
        <Button type="button" variant="outline" onClick={history.retry}>
          {label('retry')}
        </Button>
      </div>
    );
  }
  const { baseVersion, items, draft, nextBeforeVersion } = history.data;
  const revisionLabel = (key: string, number: number) =>
    label(key).replace('{version}', numbers.number(number, { useGrouping: false }));
  const close = () => {
    setSelection(null);
    onBusyChange(false);
  };
  const reviewed =
    selection?.kind === 'stage' ? selection.revision.config : selection?.draft.config;
  return (
    <section
      aria-label={label('recoveryTitle')}
      className="space-y-4 rounded-lg border bg-card p-4 text-card-foreground"
    >
      {unconfirmed && <Alert variant="destructive">{label('unverified')}</Alert>}
      {draft && (
        <div className="space-y-3 rounded-md bg-muted p-3">
          <h2 className="font-semibold">{revisionLabel('recoveryDraft', draft.sourceVersion)}</h2>
          {renderValues(draft.config, label)}
          <Button
            type="button"
            disabled={disabled || !!selection}
            onClick={() =>
              setSelection({
                kind: 'activate',
                draft,
                action: {
                  title: label('recoveryActivate'),
                  description: label('recoveryActivateConfirm'),
                  path: `${path}/rollback-activate`,
                  method: 'POST',
                  successStatus: 200,
                  body: { draftId: draft.id, expectedVersion: draft.baseVersion },
                  forbiddenMessage: label('forbidden'),
                  conflictMessage: label('recoveryConflict'),
                  ...(errorMessages && { errorMessages }),
                },
              })
            }
          >
            {label('recoveryActivate')}
          </Button>
        </div>
      )}
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">{label('recoveryEmpty')}</p>
      )}
      <ul className="divide-y">
        {items.map((revision) => (
          <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{revisionLabel('recoveryRevision', revision.version)}</span>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || !!selection}
              onClick={() =>
                setSelection({
                  kind: 'stage',
                  revision,
                  baseVersion,
                  action: {
                    title: revisionLabel('recoveryStage', revision.version),
                    description: label('recoveryStageConfirm'),
                    path: `${path}/rollback-draft`,
                    method: 'POST',
                    successStatus: 201,
                    body: { sourceId: revision.id, expectedVersion: baseVersion },
                    forbiddenMessage: label('forbidden'),
                    conflictMessage: label('recoveryConflict'),
                    ...(errorMessages && { errorMessages }),
                  },
                })
              }
            >
              {revisionLabel('recoveryStage', revision.version)}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !!selection}
          onClick={history.retry}
        >
          {label('refresh')}
        </Button>
        {before !== null && (
          <Button type="button" variant="outline" onClick={() => setBefore(null)}>
            {label('recoveryLatest')}
          </Button>
        )}
        {nextBeforeVersion !== null && (
          <Button type="button" variant="outline" onClick={() => setBefore(nextBeforeVersion)}>
            {label('recoveryOlder')}
          </Button>
        )}
      </div>
      {selection && reviewed !== undefined && (
        <TeamActionDialog
          action={selection.action}
          summary={renderValues(reviewed, label)}
          confirmationDisabled={disabled}
          onPendingChange={onBusyChange}
          onDenied={onDenied}
          onClose={close}
          onUnconfirmed={() => {
            close();
            setUnconfirmed(true);
            history.retry();
            onActivated();
          }}
          onSuccess={async (value) => {
            if (selection.kind === 'stage') {
              if (
                !validDraft(value, valid) ||
                value.sourceId !== selection.revision.id ||
                value.sourceVersion !== selection.revision.version ||
                value.baseVersion !== selection.baseVersion ||
                basis(value.config) !== basis(reviewed)
              )
                throw new Error('Invalid recovery draft receipt');
            } else {
              if (
                !record(value) ||
                value.draftId !== selection.draft.id ||
                value.version !== selection.draft.baseVersion + 1 ||
                !valid(value.config) ||
                basis(value.config) !== basis(reviewed)
              )
                throw new Error('Invalid recovery activation receipt');
              onActivated();
            }
            close();
            setUnconfirmed(false);
            history.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
