import { useState } from 'react';
import { Alert, Button, LoadingStatus } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import type { GreenElectricityConfig } from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { record } from '../lib/catalogue-form.js';
import {
  electricityModes,
  greenBasis,
  validGreenConfig,
  validVersionId,
} from '../lib/electricity-settings-form.js';
import { ServerQueryError } from '../lib/server-query-client.js';

type Copy = (key: string) => string;
type Revision = { id: string; version: number; config: GreenElectricityConfig };
type Draft = {
  id: string;
  baseVersion: number;
  sourceId: string;
  sourceVersion: number;
  config: GreenElectricityConfig;
};
type History = {
  baseVersion: number;
  items: Revision[];
  nextBeforeVersion: number | null;
  draft: Draft | null;
};
type Selection = (
  { kind: 'stage'; revision: Revision; baseVersion: number } | { kind: 'activate'; draft: Draft }
) & { action: TeamAction };

const path = '/api/admin/config/green-electricity-rules';
const version = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const validRevision = (value: unknown): value is Revision =>
  record(value) &&
  validVersionId(value.id) &&
  version(value.version) &&
  validGreenConfig(value.config);
const validDraft = (value: unknown): value is Draft =>
  record(value) &&
  validVersionId(value.id) &&
  version(value.baseVersion) &&
  validVersionId(value.sourceId) &&
  version(value.sourceVersion) &&
  value.sourceVersion < value.baseVersion &&
  validGreenConfig(value.config);

async function readHistory(response: Response): Promise<History> {
  if (!response.ok) throw new ServerQueryError(response.status);
  const data: unknown = await response.json();
  if (
    !record(data) ||
    !(data.baseVersion === 0 || version(data.baseVersion)) ||
    !Array.isArray(data.items) ||
    !data.items.every(validRevision) ||
    !(data.nextBeforeVersion === null || version(data.nextBeforeVersion)) ||
    !(
      data.draft === null ||
      (validDraft(data.draft) && data.draft.baseVersion === data.baseVersion)
    )
  )
    throw new Error('Invalid green rule recovery history');
  return {
    baseVersion: data.baseVersion,
    items: data.items,
    nextBeforeVersion: data.nextBeforeVersion,
    draft: data.draft,
  };
}

function RuleValues({ config, label }: { config: GreenElectricityConfig; label: Copy }) {
  const numbers = useNumberFormatting(useLocale());
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {electricityModes.map((mode) => (
        <div key={mode} className="min-w-0 space-y-1 rounded-md border bg-card p-3 text-sm">
          <p className="font-medium">{label(mode)}</p>
          <p>{label(config[mode].mandatoryGreenEnabled ? 'enabledState' : 'disabledState')}</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-2">
            <dt>{label('threshold')}</dt>
            <dd>
              <bdi>{numbers.number(config[mode].averagePowerThresholdKw)}</bdi>
            </dd>
            <dt>{label('share')}</dt>
            <dd>
              <bdi>{numbers.percent(config[mode].mandatoryGreenSharePercent / 100)}</bdi>
            </dd>
          </dl>
        </div>
      ))}
    </div>
  );
}

export default function GreenRulesRecovery({
  label,
  disabled,
  onBusyChange,
  onDenied,
  onActivated,
}: {
  label: Copy;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDenied: () => void;
  onActivated: () => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [before, setBefore] = useState<number | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const history = useAsyncData(
    `${path}/rollback-history${before === null ? '' : `?beforeVersion=${before}`}`,
    { read: readHistory }
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
          <RuleValues config={draft.config} label={label} />
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
      {selection && reviewed && (
        <TeamActionDialog
          action={selection.action}
          summary={<RuleValues config={reviewed} label={label} />}
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
                !validDraft(value) ||
                value.sourceId !== selection.revision.id ||
                value.sourceVersion !== selection.revision.version ||
                value.baseVersion !== selection.baseVersion ||
                greenBasis(value.config) !== greenBasis(reviewed)
              )
                throw new Error('Invalid recovery draft receipt');
            } else {
              if (
                !record(value) ||
                value.draftId !== selection.draft.id ||
                value.version !== selection.draft.baseVersion + 1 ||
                !validGreenConfig(value.config) ||
                greenBasis(value.config) !== greenBasis(reviewed)
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
