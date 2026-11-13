import { CommandFeedback } from './CommandFeedback.js';
import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { useCallback, useRef, useState } from 'react';
import { LoadingStatus, Alert, Button, Input, Label } from '@barghsa/ui';
import {
  DEFAULT_VERIFICATION_POLICY,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_PROFILE_TYPES,
  isVerificationPolicyView,
  isVerificationPolicy,
  verificationPolicyBasis,
  type VerificationPolicy,
  type VerificationPolicyView,
} from '@barghsa/shared/verification';
import { verificationConfigText as copy } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { useCatalogueResource } from '../hooks/useCatalogueResource.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { CONFIG_AUDIT_ID } from '@barghsa/shared/admin';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ConfigPreviewCard } from './ConfigPreviewCard.js';

const path = '/api/admin/config/profile-verification-policy';
type Revision = { id: string; version: number; policy: VerificationPolicy };
type History = { items: Revision[]; nextBeforeVersion: number | null };
type PolicyCommand = { expectedVersion: number } & (
  | { action: 'draft' | 'activate'; policy: VerificationPolicy }
  | { action: 'restore'; sourceId: string }
);
type Review = TeamAction & { body: PolicyCommand; policy: VerificationPolicy };
const historyVersion = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
function isHistory(value: unknown): value is History {
  if (!value || typeof value !== 'object') return false;
  const { items, nextBeforeVersion } = value as Partial<History>;
  return (
    Array.isArray(items) &&
    items.length <= 20 &&
    items.every(
      (entry: Revision) =>
        entry &&
        typeof entry.id === 'string' &&
        CONFIG_AUDIT_ID.test(entry.id) &&
        historyVersion(entry.version) &&
        isVerificationPolicy(entry.policy)
    ) &&
    (nextBeforeVersion === null || historyVersion(nextBeforeVersion))
  );
}
const basis = (value: VerificationPolicyView) =>
  JSON.stringify([
    value.version,
    verificationPolicyBasis(value.active),
    value.draft && verificationPolicyBasis(value.draft),
  ]);
export function VerificationPolicySettings({ onReadDenied }: { onReadDenied?: () => void }) {
  const locale = useLocale(),
    text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
  const numbers = useNumberFormatting(locale);
  const [draft, setDraft] = useState<VerificationPolicy>(
    structuredClone(DEFAULT_VERIFICATION_POLICY)
  );
  const [expiry, setExpiry] = useState({ INDIVIDUAL: '', LEGAL: '' });
  const [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const [action, setAction] = useState<Review | null>(null),
    [pending, setPending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [beforeVersion, setBeforeVersion] = useState<number | null>(null);
  const epoch = useRef(0),
    capturedEpoch = useRef(0),
    actionRef = useRef(action);
  const expiryInputs = useRef<Partial<Record<'INDIVIDUAL' | 'LEGAL', HTMLInputElement>>>({});
  actionRef.current = action;
  const withdraw = useCallback(() => {
    epoch.current++;
    setAction(null);
    setPending(false);
  }, []);
  const reset = useCallback((view: VerificationPolicyView | null) => {
    const policy = view?.draft ?? view?.active ?? structuredClone(DEFAULT_VERIFICATION_POLICY);
    setDraft(policy);
    setExpiry({
      INDIVIDUAL: String(policy.INDIVIDUAL.expiryDays ?? ''),
      LEGAL: String(policy.LEGAL.expiryDays ?? ''),
    });
    setInvalid(false);
    setSaved(false);
  }, []);
  const state = useSettingsSnapshot(
    path,
    isVerificationPolicyView,
    basis,
    reset,
    withdraw,
    onReadDenied
  );
  const blocked = !state.ready || state.changed || state.uncertain;
  const busy = pending || !!action;
  const { deny } = state.scope;
  const denyHistory = useCallback(
    (status?: 401 | 403) => {
      deny(status);
      onReadDenied?.();
    },
    [deny, onReadDenied]
  );
  const history = useCatalogueResource(
    { ...state.scope, deny: denyHistory },
    showHistory
      ? `${path}/history${beforeVersion === null ? '' : `?beforeVersion=${beforeVersion}`}`
      : null,
    isHistory
  );
  const currentVersion = state.current?.version ?? 0;
  const olderPage = history.data?.nextBeforeVersion ?? null;
  function proposal(): VerificationPolicy | null {
    const value = structuredClone(draft);
    for (const type of VERIFICATION_PROFILE_TYPES) {
      const raw = expiry[type].trim();
      const days = raw === '' ? null : boundedCatalogueInteger(raw, 1, 3650);
      if (raw !== '' && days === null) return null;
      value[type].expiryDays = days;
    }
    return value;
  }
  function prepare(command: 'draft' | 'activate' | Revision) {
    if (blocked || busy || !state.current) return;
    const kind = typeof command === 'string' ? command : 'restore';
    const policy = typeof command === 'string' ? proposal() : command.policy;
    if (!policy) {
      setInvalid(true);
      const invalidType = VERIFICATION_PROFILE_TYPES.find(
        (type) =>
          expiry[type].trim() !== '' &&
          boundedCatalogueInteger(expiry[type].trim(), 1, 3650) === null
      );
      if (invalidType) expiryInputs.current[invalidType]?.focus();
      return;
    }
    if (
      kind === 'activate' &&
      (!state.current.draft ||
        verificationPolicyBasis(policy) !== verificationPolicyBasis(state.current.draft))
    )
      return;
    setInvalid(false);
    setSaved(false);
    capturedEpoch.current = epoch.current;
    const expectedVersion = state.current.version;
    setAction({
      path,
      method: 'PUT',
      requiresPassword: kind === 'activate',
      title: text(kind === 'restore' ? 'policyRestore' : kind === 'activate' ? 'activate' : 'save'),
      description: text(kind === 'restore' ? 'policyRestoreReview' : 'policyWarning'),
      body:
        typeof command === 'string'
          ? { action: command, policy, expectedVersion }
          : { action: 'restore', sourceId: command.id, expectedVersion },
      policy,
      forbiddenMessage: text('forbidden'),
      conflictMessage: text('conflict'),
    });
  }
  function edit(value: VerificationPolicy) {
    setDraft(value);
    setSaved(false);
    setInvalid(false);
  }
  const proposed = proposal();
  const summary = (policy: VerificationPolicy) => (
    <div className="space-y-3">
      {VERIFICATION_PROFILE_TYPES.map((type) => (
        <div key={type}>
          <p className="font-medium">
            {text(type)}: {text(policy[type].required ? 'yes' : 'no')}
          </p>
          <p>{policy[type].documents.map((doc) => text(doc)).join(' · ') || text('noDocuments')}</p>
          <p>
            {policy[type].expiryDays === null
              ? text('noExpiry')
              : text('days').replace('{days}', String(policy[type].expiryDays))}
          </p>
        </div>
      ))}
      <p>
        {text('policyStaff')}: {text(policy.autoVerifyStaff ? 'yes' : 'no')}
      </p>
      <p>
        {text('policyOverride')}: {text(policy.allowManualOverride ? 'yes' : 'no')}
      </p>
    </div>
  );
  const matchesDraft =
    !!proposed &&
    !!state.current?.draft &&
    verificationPolicyBasis(proposed) === verificationPolicyBasis(state.current.draft);
  return (
    <section
      className="space-y-4 border-t pt-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      aria-label={text('policyTitle')}
    >
      <h2 className="text-xl font-semibold">{text('policyTitle')}</h2>
      <p className="text-sm text-muted-foreground">{text('policyWarning')}</p>
      {state.resource.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {state.resource.error && <Alert variant="destructive">{text('loadFailed')}</Alert>}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      <CommandFeedback message={saved ? text('policySaved') : null} />
      {(state.changed || state.uncertain) && (
        <Alert variant="destructive">{text(state.uncertain ? 'unverified' : 'changedDraft')}</Alert>
      )}
      {(state.changed || state.uncertain) && (
        <Button
          type="button"
          disabled={busy || !state.ready || (state.uncertain && !state.recovered)}
          onClick={state.resetSaved}
        >
          {text('resetSaved')}
        </Button>
      )}
      {state.current && !state.scope.denied && (
        <form
          noValidate
          aria-label={text('policyTitle')}
          onSubmit={(event) => {
            event.preventDefault();
            prepare('draft');
          }}
          className="space-y-5"
        >
          <ConfigPreviewCard
            title={settingsText('admin.settings.comparison', locale)}
            current={summary(state.current.active)}
            draft={summary(proposed ?? draft)}
          />
          <fieldset disabled={blocked || busy} className="min-w-0 space-y-5">
            {VERIFICATION_PROFILE_TYPES.map((type) => (
              <fieldset key={type} className="min-w-0 space-y-3 rounded border p-4">
                <legend>{text(type)}</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draft[type].required}
                    onChange={(e) =>
                      edit({ ...draft, [type]: { ...draft[type], required: e.target.checked } })
                    }
                  />
                  {text('policyRequired')}
                </label>
                <fieldset className="space-y-2">
                  <legend>{text('policyDocuments')}</legend>
                  {VERIFICATION_DOCUMENT_TYPES.map((doc) => (
                    <label key={doc} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={draft[type].documents.includes(doc)}
                        onChange={(e) =>
                          edit({
                            ...draft,
                            [type]: {
                              ...draft[type],
                              documents: e.target.checked
                                ? [...draft[type].documents, doc]
                                : draft[type].documents.filter((value) => value !== doc),
                            },
                          })
                        }
                      />
                      {text(doc)}
                    </label>
                  ))}
                </fieldset>
                <Label htmlFor={`verification-expiry-${type}`}>{text('policyExpiry')}</Label>
                <Input
                  ref={(node) => {
                    if (node) expiryInputs.current[type] = node;
                    else delete expiryInputs.current[type];
                  }}
                  id={`verification-expiry-${type}`}
                  inputMode="numeric"
                  dir="ltr"
                  value={expiry[type]}
                  onChange={(e) => {
                    setExpiry({ ...expiry, [type]: e.target.value });
                    setSaved(false);
                    setInvalid(false);
                  }}
                  aria-describedby="verification-policy-expiry-help"
                  aria-invalid={invalid || undefined}
                />
              </fieldset>
            ))}
            <p id="verification-policy-expiry-help" className="text-sm">
              {text('policyExpiryHelp')}
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.autoVerifyStaff}
                onChange={(e) => edit({ ...draft, autoVerifyStaff: e.target.checked })}
              />
              {text('policyStaff')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.allowManualOverride}
                onChange={(e) => edit({ ...draft, allowManualOverride: e.target.checked })}
              />
              {text('policyOverride')}
            </label>
            <p className="text-sm">{text('policyOverrideHelp')}</p>
            {invalid && <Alert variant="destructive">{text('policyInvalidExpiry')}</Alert>}
            <Button type="submit">{text('save')}</Button>
            <Button type="button" disabled={!matchesDraft} onClick={() => prepare('activate')}>
              {text('activate')}
            </Button>
          </fieldset>
        </form>
      )}
      {state.current && !state.scope.denied && (
        <Button
          type="button"
          variant="outline"
          aria-expanded={showHistory}
          disabled={busy}
          onClick={() => {
            setShowHistory(!showHistory);
            setBeforeVersion(null);
          }}
        >
          {text('policyHistory')}
        </Button>
      )}
      {showHistory && state.current && !state.scope.denied && (
        <section aria-label={text('policyHistory')} className="space-y-3 border-t pt-4">
          {history.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
          {history.error && <Alert variant="destructive">{text('loadFailed')}</Alert>}
          {history.error && (
            <Button type="button" variant="outline" onClick={history.retry}>
              {text('policyReload')}
            </Button>
          )}
          {!history.loading && !history.error && history.data && (
            <>
              {history.data.items.length === 0 && <p>{text('policyHistoryEmpty')}</p>}
              {history.data.items.length > 0 && (
                <ul className="divide-y">
                  {history.data.items.map((revision) => (
                    <li
                      key={revision.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      <span>
                        {text('rateRecoveryVersion').replace(
                          '{version}',
                          numbers.number(revision.version, { useGrouping: false })
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={blocked || busy || revision.version > currentVersion}
                        onClick={() => prepare(revision)}
                      >
                        {text('policyRestore')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {beforeVersion !== null && (
                <Button type="button" variant="ghost" onClick={() => setBeforeVersion(null)}>
                  {text('rateRecoveryLatest')}
                </Button>
              )}
              {olderPage !== null && (
                <Button type="button" variant="ghost" onClick={() => setBeforeVersion(olderPage)}>
                  {text('rateRecoveryOlder')}
                </Button>
              )}
            </>
          )}
        </section>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending || state.resource.loading}
        onClick={() => {
          withdraw();
          state.refresh();
        }}
      >
        {text('policyReload')}
      </Button>
      {action && (
        <TeamActionDialog
          action={action}
          summary={action.body.action === 'restore' ? summary(action.policy) : undefined}
          onClose={withdraw}
          onDenied={state.denyCommand}
          onPendingChange={setPending}
          onUnconfirmed={state.unconfirmed}
          confirmationDisabled={blocked}
          onSuccess={async (result) => {
            if (
              capturedEpoch.current !== epoch.current ||
              actionRef.current !== action ||
              state.scope.denied
            )
              return;
            const { body, policy } = action;
            if (
              !isVerificationPolicyView(result) ||
              result.version !== body.expectedVersion + 1 ||
              (body.action !== 'activate'
                ? !result.draft ||
                  verificationPolicyBasis(result.draft) !== verificationPolicyBasis(policy) ||
                  verificationPolicyBasis(result.active) !==
                    verificationPolicyBasis(state.current!.active)
                : result.draft !== null ||
                  verificationPolicyBasis(result.active) !== verificationPolicyBasis(policy))
            ) {
              state.unconfirmed();
              throw new Error('Unconfirmed verification policy');
            }
            if (!state.accept(result)) return;
            if (body.action === 'activate' && showHistory) history.retry();
            setSaved(true);
            withdraw();
          }}
        />
      )}
    </section>
  );
}
