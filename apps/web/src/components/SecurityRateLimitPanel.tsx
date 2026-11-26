import { lazy, Suspense, useCallback, useRef, useState, type FormEvent } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import {
  securityRateLimitPolicies,
  securityRateLimitPolicyKeys,
  type SecurityRateLimitPolicy,
} from '@barghsa/shared/rate-limit';
import {
  Alert,
  Button,
  Label,
  ListRefreshButton,
  LoadingStatus,
  NativeSelect,
  Textarea,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { CommandFeedback } from './CommandFeedback.js';
import { SettingsFormSection } from './SettingsFormSection.js';
import { parseRecordNumber } from '../lib/record-number.js';
import { RecordNumberInput } from './RecordNumberInput.js';
import { recordEditorField, recordEditorGrid } from './RecordEditorLayout.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const path = '/api/admin/config/security-rate-limits';
const SecurityRateLimitRecovery = lazy(() => import('./SecurityRateLimitRecovery.js'));
type Emergency = {
  limit: number;
  owner: string;
  reason: string;
  expiresAt: string;
  active: boolean;
};
type Policy = {
  policy: SecurityRateLimitPolicy;
  windowMs: number;
  ceiling: number;
  version: number;
  limit: number;
  emergency: Emergency | null;
};
type Config = { policies: Policy[] };
type EmergencyOperation =
  | { operation: 'keep' }
  | { operation: 'clear'; reason: string }
  | { operation: 'set'; limit: number; minutes: number; reason: string };
type Change = {
  policy: Policy['policy'];
  limit: number;
  expectedVersion: number;
  emergency: EmergencyOperation;
};

function newDraft(): {
  limit: string | null;
  operation: EmergencyOperation['operation'];
  emergencyLimit: string;
  minutes: string;
  reason: string;
} {
  return { limit: null, operation: 'keep', emergencyLimit: '', minutes: '30', reason: '' };
}

function record(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function inRange(raw: unknown, min: number, max: number): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= min && raw <= max;
}

function validPolicy(raw: unknown): raw is Policy {
  if (
    !record(raw) ||
    typeof raw.policy !== 'string' ||
    !Object.hasOwn(securityRateLimitPolicies, raw.policy)
  )
    return false;
  const { ceiling, windowMs } = securityRateLimitPolicies[raw.policy as Policy['policy']];
  if (
    raw.ceiling !== ceiling ||
    raw.windowMs !== windowMs ||
    !inRange(raw.version, 0, 2147483647) ||
    !inRange(raw.limit, 1, ceiling)
  )
    return false;
  const emergency = raw.emergency;
  if (raw.version === 0) return emergency === null && raw.limit === ceiling;
  return (
    emergency === null ||
    (record(emergency) &&
      inRange(emergency.limit, 1, ceiling) &&
      typeof emergency.owner === 'string' &&
      emergency.owner.length > 0 &&
      typeof emergency.reason === 'string' &&
      emergency.reason.length >= 10 &&
      emergency.reason.length <= 300 &&
      typeof emergency.expiresAt === 'string' &&
      Number.isFinite(Date.parse(emergency.expiresAt)) &&
      typeof emergency.active === 'boolean')
  );
}

function validConfig(raw: unknown): raw is Config {
  if (
    !record(raw) ||
    !Array.isArray(raw.policies) ||
    raw.policies.length !== securityRateLimitPolicyKeys.length
  )
    return false;
  return (
    raw.policies.every(validPolicy) &&
    new Set(raw.policies.map((row) => row.policy)).size === raw.policies.length
  );
}

function configBasis(value: Config) {
  return value.policies.map(({ policy, version }) => `${policy}:${version}`).join(',');
}

function sameEmergency(left: Emergency | null, right: Emergency | null): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.limit === right.limit &&
      left.reason === right.reason &&
      left.owner === right.owner &&
      left.expiresAt === right.expiresAt)
  );
}

export default function SecurityRateLimitPanel({
  onReadDenied,
}: {
  onReadDenied?: (status?: 401 | 403) => void;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const text = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const [selected, select] = useState<Policy['policy']>('otpDestinationHour');
  const [draft, setDraft] = useState(newDraft);
  const { limit, operation, emergencyLimit, minutes, reason } = draft;
  const [action, setAction] = useState<(TeamAction & { body: Change }) | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const save = useRef<HTMLButtonElement>(null);
  const recoveryToggle = useRef<HTMLButtonElement>(null);
  const captured = useRef<typeof action>(null);
  const withdraw = useCallback(() => {
    captured.current = null;
    setAction(null);
    setPending(false);
  }, []);
  const reset = useCallback(() => {
    setDraft(newDraft());
    setInvalid(false);
    setSaved(false);
    setShowRecovery(false);
  }, []);
  const state = useSettingsSnapshot(path, validConfig, configBasis, reset, withdraw, onReadDenied);
  const policy = state.current?.policies.find((row) => row.policy === selected);
  const emergency = policy?.emergency;
  const blocked = !state.ready || state.changed || state.uncertain || !policy;
  const nextLimit = parseRecordNumber(limit ?? String(policy?.limit ?? ''));
  const expiryFormatter = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || showRecovery || !policy || captured.current) return;
    const message = reason.trim();
    const temporaryLimit = parseRecordNumber(emergencyLimit);
    const duration = parseRecordNumber(minutes);
    if (
      !inRange(nextLimit, 1, policy.ceiling) ||
      (operation !== 'keep' && !inRange(message.length, 10, 300)) ||
      (operation === 'set' &&
        (!inRange(temporaryLimit, 1, nextLimit - 1) || !inRange(duration, 5, 1440)))
    ) {
      setInvalid(true);
      return;
    }
    const change: EmergencyOperation =
      operation === 'set'
        ? { operation, limit: temporaryLimit, minutes: duration, reason: message }
        : operation === 'clear'
          ? { operation, reason: message }
          : { operation };
    const command = {
      title: text('rateLimitSave'),
      description: text('rateLimitDescription'),
      path,
      method: 'PUT' as const,
      requiresPassword: true,
      successStatus: 200,
      conflictMessage: text('conflict'),
      forbiddenMessage: text('forbidden'),
      body: {
        policy: selected,
        limit: nextLimit,
        expectedVersion: policy.version,
        emergency: change,
      },
    };
    setInvalid(false);
    setSaved(false);
    captured.current = command;
    setAction(command);
  }

  return (
    <SettingsFormSection
      headingId="security-rate-limits-heading"
      title={text('rateLimitTitle')}
      description={text('rateLimitDescription')}
      onSubmit={submit}
      actions={
        <>
          <ListRefreshButton
            label={text('reload')}
            onClick={state.refresh}
            refreshing={state.resource.loading}
            disabled={pending}
          />
          <Button
            ref={save}
            type="submit"
            disabled={
              blocked ||
              showRecovery ||
              !!action ||
              (nextLimit === policy?.limit && operation === 'keep')
            }
          >
            {text('rateLimitSave')}
          </Button>
        </>
      }
    >
      {state.resource.loading && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {state.scope.denied && <Alert variant="destructive">{text('forbidden')}</Alert>}
      {state.resource.error && <Alert variant="destructive">{text('loadFailed')}</Alert>}
      {invalid && <Alert variant="destructive">{text('invalid')}</Alert>}
      {(state.changed || state.uncertain) && (
        <>
          <Alert variant="destructive">
            {text(state.uncertain ? 'unverified' : 'changedDraft')}
          </Alert>
          <Button
            type="button"
            variant="outline"
            onClick={state.resetSaved}
            disabled={!state.ready || (state.uncertain && !state.recovered)}
          >
            {text('resetSaved')}
          </Button>
        </>
      )}
      <CommandFeedback message={saved ? text('rateLimitSaved') : null} />
      {policy && (
        <fieldset
          className="m-0 min-w-0 space-y-3 border-0 p-0"
          disabled={blocked || !!action || showRecovery}
        >
          <legend className="sr-only">{text('rateLimitTitle')}</legend>
          <div className={recordEditorField}>
            <Label htmlFor="security-rate-action">{text('rateLimitAction')}</Label>
            <NativeSelect
              id="security-rate-action"
              className="w-full"
              value={selected}
              onChange={(event) => {
                select(event.target.value as Policy['policy']);
                reset();
              }}
            >
              {securityRateLimitPolicyKeys.map((key) => (
                <option key={key} value={key}>
                  {text(key)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
            <div>
              <dt className="text-muted-foreground">{text('rateLimitWindow')}</dt>
              <dd className="font-medium tabular-nums">
                {numbers.number(policy.windowMs / 60_000)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{text('rateLimitVersion')}</dt>
              <dd className="font-medium tabular-nums">{numbers.number(policy.version)}</dd>
            </div>
          </dl>
          <div className={recordEditorField}>
            <Label htmlFor="security-rate-value">{text('rateLimitValue')}</Label>
            <div className="flex min-w-0 items-center gap-3">
              <RecordNumberInput
                id="security-rate-value"
                className="w-28 min-w-0"
                locale={locale}
                min={1}
                max={policy.ceiling}
                step={1}
                required
                aria-describedby="security-rate-range security-rate-current"
                value={limit ?? String(policy.limit)}
                onChange={(value) => {
                  setDraft({ ...draft, limit: value });
                  setSaved(false);
                }}
              />
              <p
                id="security-rate-current"
                className="min-w-0 border-s ps-3 text-sm text-muted-foreground"
              >
                {text('rateLimitCurrent').replace('{count}', numbers.number(policy.limit))}
              </p>
            </div>
            <p id="security-rate-range" className="text-sm text-muted-foreground">
              {text('otpRange')
                .replace('{min}', numbers.number(1))
                .replace('{max}', numbers.number(policy.ceiling))}
            </p>
          </div>
          <div className="space-y-2 rounded-lg border bg-muted/35 p-3">
            <div className={recordEditorField}>
              <Label htmlFor="security-rate-emergency">{text('rateLimitEmergency')}</Label>
              <NativeSelect
                id="security-rate-emergency"
                className="w-full"
                value={operation}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    operation: event.target.value as EmergencyOperation['operation'],
                  });
                  setSaved(false);
                }}
              >
                <option value="keep">{text('rateLimitKeep')}</option>
                <option value="set" disabled={nextLimit <= 1}>
                  {text('rateLimitSet')}
                </option>
                {emergency && <option value="clear">{text('rateLimitClear')}</option>}
              </NativeSelect>
            </div>
            {emergency && (
              <dl className="space-y-1 text-sm break-words">
                <dt>{text('rateLimitEmergencyValue')}</dt>
                <dd>{numbers.number(emergency.limit)}</dd>
                <dt>{text('rateLimitOwner')}</dt>
                <dd>
                  <bdi>{emergency.owner}</bdi>
                </dd>
                <dt>{text('rateLimitExpiry')}</dt>
                <dd>
                  <time dateTime={emergency.expiresAt}>
                    {expiryFormatter.format(Date.parse(emergency.expiresAt))}
                  </time>
                  {!emergency.active && ` · ${text('rateLimitExpired')}`}
                </dd>
                <dt>{text('rateLimitReason')}</dt>
                <dd dir="auto">{emergency.reason}</dd>
              </dl>
            )}
            {operation === 'set' && (
              <div className={recordEditorGrid}>
                <div className={recordEditorField}>
                  <Label htmlFor="security-rate-emergency-value">
                    {text('rateLimitEmergencyValue')}
                  </Label>
                  <RecordNumberInput
                    id="security-rate-emergency-value"
                    locale={locale}
                    min={1}
                    max={Number.isFinite(nextLimit) ? nextLimit - 1 : undefined}
                    step={1}
                    required
                    value={emergencyLimit}
                    onChange={(value) => setDraft({ ...draft, emergencyLimit: value })}
                  />
                </div>
                <div className={recordEditorField}>
                  <Label htmlFor="security-rate-emergency-minutes">
                    {text('rateLimitMinutes')}
                  </Label>
                  <RecordNumberInput
                    id="security-rate-emergency-minutes"
                    locale={locale}
                    min={5}
                    max={1440}
                    step={1}
                    required
                    value={minutes}
                    onChange={(value) => setDraft({ ...draft, minutes: value })}
                  />
                </div>
              </div>
            )}
            {operation !== 'keep' && (
              <div className={recordEditorField}>
                <Label htmlFor="security-rate-reason">{text('rateLimitReason')}</Label>
                <Textarea
                  id="security-rate-reason"
                  required
                  minLength={10}
                  maxLength={300}
                  dir="auto"
                  rows={2}
                  placeholder={text('rateLimitReasonExample')}
                  value={reason}
                  onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                />
              </div>
            )}
          </div>
        </fieldset>
      )}
      {policy && (
        <Button
          ref={recoveryToggle}
          type="button"
          variant="outline"
          className="mt-4"
          aria-expanded={showRecovery}
          aria-controls={showRecovery && !blocked ? 'security-rate-limit-recovery' : undefined}
          disabled={blocked || !!action}
          onClick={() => setShowRecovery((open) => !open)}
        >
          {text('rateRecoveryHistory')}
        </Button>
      )}
      {showRecovery && !blocked && policy && (
        <div id="security-rate-limit-recovery">
          <Suspense fallback={<LoadingStatus>{text('loading')}</LoadingStatus>}>
            <SecurityRateLimitRecovery
              key={`${selected}:${policy.version}`}
              policy={selected}
              version={policy.version}
              ceiling={policy.ceiling}
              scope={state.scope}
              toggle={recoveryToggle}
              onDenied={state.denyCommand}
              onUnconfirmed={() => {
                setShowRecovery(false);
                state.unconfirmed();
              }}
              onActivated={(raw, expected) => {
                if (
                  !state.current ||
                  state.scope.denied ||
                  !record(raw) ||
                  raw.draftId !== expected.id ||
                  !validPolicy(raw.current) ||
                  raw.current.policy !== selected ||
                  raw.current.version !== expected.baseVersion + 1 ||
                  raw.current.limit !== expected.limit ||
                  !sameEmergency(policy.emergency, raw.current.emergency)
                )
                  return false;
                const current = raw.current;
                if (
                  !state.accept({
                    policies: state.current.policies.map((row) =>
                      row.policy === selected ? current : row
                    ),
                  })
                )
                  return false;
                setSaved(true);
                state.resource.retry();
                return true;
              }}
            />
          </Suspense>
        </div>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={save}
          onClose={withdraw}
          onDenied={state.denyCommand}
          onPendingChange={setPending}
          onUnconfirmed={state.unconfirmed}
          confirmationDisabled={blocked}
          summary={
            <div className="space-y-1 break-words">
              <p>
                {text(action.body.policy)} · {numbers.number(action.body.limit)}
              </p>
              {action.body.emergency.operation === 'clear' && <p>{text('rateLimitClear')}</p>}
              {action.body.emergency.operation === 'set' && (
                <p>
                  {text('rateLimitEmergencyValue')} · {numbers.number(action.body.emergency.limit)}{' '}
                  · {text('rateLimitMinutes')} · {numbers.number(action.body.emergency.minutes)}
                </p>
              )}
              {action.body.emergency.operation !== 'keep' && (
                <p dir="auto">{action.body.emergency.reason}</p>
              )}
            </div>
          }
          onSuccess={async (raw) => {
            if (captured.current !== action || state.scope.denied || !state.current || !policy)
              return;
            const change = action.body;
            if (
              !validPolicy(raw) ||
              raw.policy !== change.policy ||
              raw.limit !== change.limit ||
              raw.version !== change.expectedVersion + 1 ||
              (change.emergency.operation === 'keep' &&
                !sameEmergency(policy.emergency, raw.emergency)) ||
              (change.emergency.operation === 'clear' && raw.emergency !== null) ||
              (change.emergency.operation === 'set' &&
                (!raw.emergency?.active ||
                  raw.emergency.limit !== change.emergency.limit ||
                  raw.emergency.reason !== change.emergency.reason))
            ) {
              throw new Error('Unconfirmed rate-limit configuration');
            }
            if (
              !state.accept({
                policies: state.current.policies.map((row) =>
                  row.policy === raw.policy ? raw : row
                ),
              })
            )
              throw new Error('Obsolete rate-limit receipt');
            withdraw();
            setSaved(true);
            state.resource.retry();
          }}
        />
      )}
    </SettingsFormSection>
  );
}
