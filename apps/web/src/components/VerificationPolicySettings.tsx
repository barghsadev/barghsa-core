import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { useCallback, useRef, useState } from 'react';
import { Alert, Button, Input, Label } from '@barghsa/ui';
import {
  DEFAULT_VERIFICATION_POLICY,
  VERIFICATION_DOCUMENT_TYPES,
  VERIFICATION_PROFILE_TYPES,
  isVerificationPolicyView,
  verificationPolicyBasis,
  type VerificationPolicy,
  type VerificationPolicyView,
} from '@barghsa/shared/verification';
import { verificationConfigText as copy } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { boundedCatalogueInteger } from '../lib/catalogue-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ConfigPreviewCard } from './ConfigPreviewCard.js';

const path = '/api/admin/config/profile-verification-policy';
const basis = (value: VerificationPolicyView) =>
  JSON.stringify([
    value.version,
    verificationPolicyBasis(value.active),
    value.draft && verificationPolicyBasis(value.draft),
  ]);
export function VerificationPolicySettings() {
  const locale = useLocale(),
    text = (key: Parameters<typeof copy>[0]) => copy(key, locale);
  const [draft, setDraft] = useState<VerificationPolicy>(
    structuredClone(DEFAULT_VERIFICATION_POLICY)
  );
  const [expiry, setExpiry] = useState({ INDIVIDUAL: '', LEGAL: '' });
  const [invalid, setInvalid] = useState(false),
    [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null),
    [pending, setPending] = useState(false);
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
  const state = useSettingsSnapshot(path, isVerificationPolicyView, basis, reset, withdraw);
  const blocked = !state.ready || state.changed || state.uncertain;
  const busy = pending || !!action;
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
  function prepare(kind: 'draft' | 'activate') {
    if (blocked || busy || !state.current) return;
    const policy = proposal();
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
    setAction({
      path,
      method: 'PUT',
      requiresPassword: kind === 'activate',
      title: text(kind === 'activate' ? 'activate' : 'save'),
      description: text('policyWarning'),
      body: { action: kind, policy, expectedVersion: state.current.version },
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
      {state.resource.loading && <p role="status">{text('loading')}</p>}
      {state.resource.error && <Alert variant="destructive">{text('loadFailed')}</Alert>}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {saved && <p role="status">{text('policySaved')}</p>}
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
          onClose={withdraw}
          onDenied={state.scope.deny}
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
            const body = action.body as {
              action: 'draft' | 'activate';
              policy: VerificationPolicy;
              expectedVersion: number;
            };
            if (
              !isVerificationPolicyView(result) ||
              result.version !== body.expectedVersion + 1 ||
              (body.action === 'draft'
                ? !result.draft ||
                  verificationPolicyBasis(result.draft) !== verificationPolicyBasis(body.policy) ||
                  verificationPolicyBasis(result.active) !==
                    verificationPolicyBasis(state.current!.active)
                : result.draft !== null ||
                  verificationPolicyBasis(result.active) !== verificationPolicyBasis(body.policy))
            ) {
              state.unconfirmed();
              throw new Error('Unconfirmed verification policy');
            }
            if (!state.accept(result)) return;
            setSaved(true);
            withdraw();
          }}
        />
      )}
    </section>
  );
}
