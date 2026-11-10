import { useCallback, useRef, useState, type FormEvent } from 'react';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import {
  securityRateLimitPolicies,
  securityRateLimitPolicyKeys,
  type SecurityRateLimitPolicy,
} from '@barghsa/shared/rate-limit';
import { Alert, Button, Input, Label, LoadingStatus, Textarea } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useSettingsSnapshot } from '../hooks/useSettingsSnapshot.js';
import { CommandFeedback } from './CommandFeedback.js';
import { SettingsFormSection } from './SettingsFormSection.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

const path = '/api/admin/config/security-rate-limits';
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
  const save = useRef<HTMLButtonElement>(null);
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
  }, []);
  const state = useSettingsSnapshot(path, validConfig, configBasis, reset, withdraw, onReadDenied);
  const policy = state.current?.policies.find((row) => row.policy === selected);
  const emergency = policy?.emergency;
  const blocked = !state.ready || state.changed || state.uncertain || !policy;
  const nextLimit = Number(limit ?? policy?.limit);
  const expiryFormatter = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked || !policy || captured.current) return;
    const message = reason.trim();
    if (
      !inRange(nextLimit, 1, policy.ceiling) ||
      (operation !== 'keep' && !inRange(message.length, 10, 300)) ||
      (operation === 'set' &&
        (!inRange(Number(emergencyLimit), 1, nextLimit - 1) || !inRange(Number(minutes), 5, 1440)))
    ) {
      setInvalid(true);
      return;
    }
    const change: EmergencyOperation =
      operation === 'set'
        ? { operation, limit: Number(emergencyLimit), minutes: Number(minutes), reason: message }
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
          <Button
            ref={save}
            type="submit"
            disabled={blocked || !!action || (nextLimit === policy?.limit && operation === 'keep')}
          >
            {text('rateLimitSave')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={state.refresh}
            disabled={state.resource.loading || pending}
          >
            {text('reload')}
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
        <fieldset className="space-y-3 min-w-0" disabled={blocked || !!action}>
          <legend className="sr-only">{text('rateLimitTitle')}</legend>
          <Label htmlFor="security-rate-action">{text('rateLimitAction')}</Label>
          <select
            id="security-rate-action"
            className="touch-action w-full rounded border bg-background px-2"
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
          </select>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-sm">
            <dt>{text('rateLimitWindow')}</dt>
            <dd>{numbers.number(policy.windowMs / 60_000)}</dd>
            <dt>{text('rateLimitVersion')}</dt>
            <dd>{numbers.number(policy.version)}</dd>
          </dl>
          <Label htmlFor="security-rate-value">{text('rateLimitValue')}</Label>
          <Input
            id="security-rate-value"
            type="number"
            min={1}
            max={policy.ceiling}
            step={1}
            required
            aria-describedby="security-rate-range"
            value={limit ?? String(policy.limit)}
            onChange={(event) => {
              setDraft({ ...draft, limit: event.target.value });
              setSaved(false);
            }}
          />
          <p id="security-rate-range" className="text-sm text-muted-foreground">
            {text('otpRange')
              .replace('{min}', numbers.number(1))
              .replace('{max}', numbers.number(policy.ceiling))}
          </p>
          <Label htmlFor="security-rate-emergency">{text('rateLimitEmergency')}</Label>
          <select
            id="security-rate-emergency"
            className="touch-action w-full rounded border bg-background px-2"
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
          </select>
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
            <>
              <Label htmlFor="security-rate-emergency-value">
                {text('rateLimitEmergencyValue')}
              </Label>
              <Input
                id="security-rate-emergency-value"
                type="number"
                min={1}
                max={nextLimit - 1}
                step={1}
                required
                value={emergencyLimit}
                onChange={(event) => setDraft({ ...draft, emergencyLimit: event.target.value })}
              />
              <Label htmlFor="security-rate-emergency-minutes">{text('rateLimitMinutes')}</Label>
              <Input
                id="security-rate-emergency-minutes"
                type="number"
                min={5}
                max={1440}
                step={1}
                required
                value={minutes}
                onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
              />
            </>
          )}
          {operation !== 'keep' && (
            <>
              <Label htmlFor="security-rate-reason">{text('rateLimitReason')}</Label>
              <Textarea
                id="security-rate-reason"
                required
                minLength={10}
                maxLength={300}
                dir="auto"
                value={reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            </>
          )}
        </fieldset>
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
