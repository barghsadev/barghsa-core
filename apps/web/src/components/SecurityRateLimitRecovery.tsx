import { useCallback, useState, type RefObject } from 'react';
import { CONFIG_AUDIT_ID } from '@barghsa/shared/admin';
import type { SecurityRateLimitPolicy } from '@barghsa/shared/rate-limit';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { Alert, Button, LoadingStatus } from '@barghsa/ui';
import { useCatalogueResource, type useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { record } from '../lib/catalogue-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const path = '/api/admin/config/security-rate-limits';
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const id = (value: unknown): value is string =>
  typeof value === 'string' && CONFIG_AUDIT_ID.test(value);
type Revision = { id: string; version: number; limit: number };
type Draft = {
  id: string;
  baseVersion: number;
  sourceId: string;
  sourceVersion: number;
  limit: number;
};
type History = {
  policy: SecurityRateLimitPolicy;
  baseVersion: number;
  items: Revision[];
  nextBeforeVersion: number | null;
  draft: Draft | null;
};
type Selection = ({ kind: 'stage'; source: Revision } | { kind: 'activate'; draft: Draft }) & {
  action: TeamAction;
};

function validDraft(value: unknown, baseVersion: number, ceiling: number): value is Draft {
  return (
    record(value) &&
    id(value.id) &&
    id(value.sourceId) &&
    value.baseVersion === baseVersion &&
    integer(value.sourceVersion, 1, baseVersion - 1) &&
    integer(value.limit, 1, ceiling)
  );
}

export default function SecurityRateLimitRecovery({
  policy,
  version,
  ceiling,
  scope,
  toggle,
  onDenied,
  onUnconfirmed,
  onActivated,
}: {
  policy: SecurityRateLimitPolicy;
  version: number;
  ceiling: number;
  scope: ReturnType<typeof useCatalogueScope>;
  toggle: RefObject<HTMLButtonElement | null>;
  onDenied: (status?: 401 | 403) => void;
  onUnconfirmed: () => void;
  onActivated: (value: unknown, expected: Draft) => boolean;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const [beforeVersion, setBeforeVersion] = useState<number | null>(null);
  const [selection, select] = useState<Selection | null>(null);
  const validate = useCallback(
    (value: unknown): value is History => {
      if (!record(value) || value.policy !== policy || !integer(value.baseVersion, 0, 2147483647))
        return false;
      const base = value.baseVersion;
      return (
        Array.isArray(value.items) &&
        value.items.length <= 20 &&
        value.items.every(
          (entry) =>
            record(entry) &&
            id(entry.id) &&
            integer(entry.version, 1, base - 1) &&
            integer(entry.limit, 1, ceiling)
        ) &&
        (value.nextBeforeVersion === null || integer(value.nextBeforeVersion, 1, base - 1)) &&
        (value.draft === null || validDraft(value.draft, base, ceiling))
      );
    },
    [policy, ceiling]
  );
  const query = new URLSearchParams({ policy });
  if (beforeVersion !== null) query.set('beforeVersion', String(beforeVersion));
  const history = useCatalogueResource(
    { ...scope, deny: onDenied },
    `${path}/rollback-history?${query}`,
    validate
  );
  const data = history.data;
  const blocked = scope.denied || history.loading || history.error || data?.baseVersion !== version;
  const versionText = (key: 'rateRecoveryVersion' | 'rateRecoveryDraft', value: number) =>
    text(key).replace('{version}', numbers.number(value, { useGrouping: false }));

  function open(next: { kind: 'stage'; source: Revision } | { kind: 'activate'; draft: Draft }) {
    if (blocked || selection) return;
    const stage = next.kind === 'stage';
    select({
      ...next,
      action: {
        title: text(stage ? 'rateRecoveryStage' : 'rateRecoveryActivate'),
        description: text(stage ? 'rateRecoveryStageReview' : 'rateRecoveryActivateReview'),
        path: `${path}/rollback-${stage ? 'draft' : 'activate'}`,
        method: 'POST',
        requiresPassword: true,
        successStatus: stage ? 201 : 200,
        conflictMessage: text('conflict'),
        forbiddenMessage: text('forbidden'),
        body: stage
          ? { policy, expectedVersion: version, sourceId: next.source.id }
          : { policy, expectedVersion: version, draftId: next.draft.id },
      },
    });
  }

  return (
    <section
      aria-label={text('rateRecoveryHistory')}
      className="mt-4 space-y-3 rounded-lg border p-4"
    >
      {history.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {history.error && <Alert variant="destructive">{text('loadFailed')}</Alert>}
      {data && data.baseVersion !== version && (
        <Alert variant="destructive">{text('conflict')}</Alert>
      )}
      {!blocked && data && (
        <>
          {data.draft && (
            <div className="space-y-2 rounded-md bg-muted p-3">
              <h3 className="font-semibold">
                {versionText('rateRecoveryDraft', data.draft.sourceVersion)}
              </h3>
              <p>
                {text('rateLimitValue')} · <bdi>{numbers.number(data.draft.limit)}</bdi>
              </p>
              <Button
                type="button"
                disabled={!!selection}
                onClick={() => open({ kind: 'activate', draft: data.draft! })}
              >
                {text('rateRecoveryActivate')}
              </Button>
            </div>
          )}
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{text('rateRecoveryEmpty')}</p>
          ) : (
            <ul className="divide-y">
              {data.items.map((source) => (
                <li
                  key={source.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    {versionText('rateRecoveryVersion', source.version)} ·{' '}
                    <bdi>{numbers.number(source.limit)}</bdi>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!!selection}
                    onClick={() => open({ kind: 'stage', source })}
                  >
                    {text('rateRecoveryStage')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {beforeVersion !== null && (
            <Button
              type="button"
              variant="outline"
              disabled={!!selection}
              onClick={() => setBeforeVersion(null)}
            >
              {text('rateRecoveryLatest')}
            </Button>
          )}
          {data.nextBeforeVersion !== null && (
            <Button
              type="button"
              variant="outline"
              disabled={!!selection}
              onClick={() => setBeforeVersion(data.nextBeforeVersion)}
            >
              {text('rateRecoveryOlder')}
            </Button>
          )}
        </>
      )}
      {history.error && (
        <Button type="button" variant="outline" onClick={history.retry}>
          {text('reload')}
        </Button>
      )}
      {selection && (
        <TeamActionDialog
          action={selection.action}
          confirmationDisabled={blocked}
          finalFocus={toggle}
          onClose={() => select(null)}
          onDenied={onDenied}
          onUnconfirmed={() => {
            select(null);
            onUnconfirmed();
          }}
          summary={
            <p>
              {text(policy)} ·{' '}
              <bdi>
                {numbers.number(
                  selection.kind === 'stage' ? selection.source.limit : selection.draft.limit
                )}
              </bdi>
            </p>
          }
          onSuccess={async (value) => {
            if (selection.kind === 'stage') {
              if (
                !data ||
                !validDraft(value, version, ceiling) ||
                value.sourceId !== selection.source.id ||
                value.sourceVersion !== selection.source.version ||
                value.limit !== selection.source.limit ||
                !history.accept({ ...data, draft: value })
              )
                throw new Error('Invalid rate-limit recovery draft receipt');
              history.retry();
            } else if (!onActivated(value, selection.draft)) {
              throw new Error('Invalid rate-limit recovery activation receipt');
            }
            select(null);
          }}
        />
      )}
    </section>
  );
}
