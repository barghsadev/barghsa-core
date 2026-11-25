import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, ListRefreshButton, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useLocale } from '../hooks/useLocale.js';

import type { ContractActivationRule } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
const fields = ['signatureRequired', 'paymentRequired', 'serviceStartRequired'] as const;
const services = ['electricity', 'savings', 'solar'] as const;
const rulesPath = '/api/admin/contract-activation-rules';
type RuleSet = { rules: ContractActivationRule[]; canEdit: boolean };
type RuleAction = TeamAction & {
  serviceType: ContractActivationRule['serviceType'];
  body: Pick<ContractActivationRule, (typeof fields)[number]> & {
    expectedRevision: number;
    idempotencyKey: string;
  };
};
function validRule(value: unknown): value is ContractActivationRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<ContractActivationRule>;
  return (
    services.some((service) => service === rule.serviceType) &&
    fields.every((field) => typeof rule[field] === 'boolean') &&
    Number.isSafeInteger(rule.revision) &&
    Number(rule.revision) >= 1 &&
    typeof rule.updatedAt === 'string' &&
    Number.isFinite(Date.parse(rule.updatedAt)) &&
    (rule.serviceType !== 'solar' || rule.signatureRequired === true) &&
    (rule.serviceType !== 'electricity' || rule.paymentRequired === true)
  );
}
function validRules(value: unknown): value is RuleSet {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<RuleSet>;
  return (
    typeof data.canEdit === 'boolean' &&
    Array.isArray(data.rules) &&
    data.rules.length === services.length &&
    data.rules.every(validRule) &&
    new Set(data.rules.map((rule) => rule.serviceType)).size === services.length
  );
}
function sameRule(a: ContractActivationRule, b: ContractActivationRule | undefined) {
  return b && a.revision === b.revision && fields.every((field) => a[field] === b[field]);
}
export function ContractActivationRules() {
  const locale = useLocale(),
    [open, setOpen] = useState(false);
  const word = (key: string) => contractText(key, locale);
  return (
    <section className="rounded-xl border bg-card p-5" aria-label={word('activationRules')}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={open ? 'contract-activation-rules' : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {word('activationRules')}
      </Button>
      {open ? (
        <div id="contract-activation-rules" className="pt-4">
          <RulesEditor />
        </div>
      ) : null}
    </section>
  );
}
function RulesEditor() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedRulesEditor key={JSON.stringify([actor, revision])} />;
}
function OwnedRulesEditor() {
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [drafts, setDrafts] = useState<ContractActivationRule[]>([]),
    [busy, setBusy] = useState(false),
    [requiredRead, setRequiredRead] = useState<number | null>(null),
    [unconfirmed, setUnconfirmed] = useState<RuleAction | null>(null),
    [action, setAction] = useState<RuleAction | null>(null);
  const previous = useRef<RuleSet | null>(null);
  const clear = useCallback(() => {
    previous.current = null;
    setDrafts([]);
    setAction(null);
    setUnconfirmed(null);
    setRequiredRead(null);
    setBusy(false);
  }, []);
  const scope = useCatalogueScope(clear);
  const resource = useCatalogueResource(scope, rulesPath, validRules);
  const { data, loading, error, readAttempt } = resource;
  const ready = !!data && !loading && !error && !scope.denied && requiredRead === null;
  useEffect(() => {
    if (!data || loading || error || busy) return;
    if (requiredRead !== null && (readAttempt ?? -1) < requiredRead) return;
    const before = previous.current;
    if (before === data && requiredRead === null) return;
    previous.current = data;
    setDrafts((local) =>
      data.rules.map((row) => {
        const prior = before?.rules.find((item) => item.serviceType === row.serviceType);
        const draft = local.find((item) => item.serviceType === row.serviceType);
        return data.canEdit && draft && sameRule(row, prior) ? draft : row;
      })
    );
    if (
      unconfirmed &&
      (!data.canEdit ||
        !data.rules.some(
          (row) =>
            row.serviceType === unconfirmed.serviceType &&
            row.revision === unconfirmed.body.expectedRevision &&
            sameRule(
              row,
              before?.rules.find((item) => item.serviceType === row.serviceType)
            )
        ))
    )
      setUnconfirmed(null);
    setAction(null);
    setRequiredRead(null);
  }, [data, loading, error, busy, readAttempt, requiredRead, unconfirmed]);
  function refresh() {
    if (busy || loading) return;
    if (scope.denied) scope.recover();
    else resource.retry();
  }
  function save(row: ContractActivationRule) {
    if (!ready || !data?.canEdit || action) return;
    const original =
      unconfirmed?.serviceType === row.serviceType &&
      unconfirmed.body.expectedRevision === row.revision &&
      fields.every((field) => unconfirmed.body[field] === row[field])
        ? unconfirmed
        : null;
    setAction({
      serviceType: row.serviceType,
      title: word('saveActivationRules'),
      description: word(row.serviceType) + '. ' + word('activationRulesNotice'),
      path: rulesPath + '/' + row.serviceType,
      method: 'PUT',
      body: {
        expectedRevision: row.revision,
        signatureRequired: row.signatureRequired,
        paymentRequired: row.paymentRequired,
        serviceStartRequired: row.serviceStartRequired,
        idempotencyKey: original?.body.idempotencyKey ?? crypto.randomUUID(),
      },
      conflictMessage: word('activationRulesConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const savedActionRule = data?.rules.find((row) => row.serviceType === action?.serviceType);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{word('activationRulesNotice')}</p>
        <ListRefreshButton
          label={word('refresh')}
          disabled={busy || loading || action !== null}
          onClick={refresh}
        />
      </div>
      {requiredRead !== null && !action && (
        <p role="alert">{confirmationText('unconfirmed', locale)}</p>
      )}
      {(error || scope.denied) && (
        <Alert variant="destructive">
          <AlertDescription>{word(scope.denied ? 'denied' : 'error')}</AlertDescription>
        </Alert>
      )}
      {loading && <PageLoading label={word('loading')} />}
      {data && (
        <>
          {!data.canEdit ? <p>{word('activationRulesReadOnly')}</p> : null}
          <div className="grid gap-3 xl:grid-cols-3">
            {drafts.map((row) => {
              const saved = data.rules.find((item) => item.serviceType === row.serviceType);
              const changed =
                saved?.revision === row.revision &&
                fields.some((field) => row[field] !== saved[field]);
              return (
                <form
                  key={row.serviceType}
                  className={recordEditorSurface}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (changed) save(row);
                  }}
                >
                  <fieldset
                    aria-label={word(row.serviceType)}
                    disabled={!ready || action !== null}
                    className="flex h-full min-w-0 flex-col"
                  >
                    <h3 className="border-b bg-muted/25 px-4 py-3 text-base font-semibold">
                      {word(row.serviceType)}
                    </h3>
                    <div className="flex flex-1 flex-col divide-y px-4 py-1">
                      {fields.map((field) => {
                        const mandatory =
                          (row.serviceType === 'solar' && field === 'signatureRequired') ||
                          (row.serviceType === 'electricity' && field === 'paymentRequired');
                        return (
                          <label
                            key={field}
                            className="touch-label flex min-h-11 items-center gap-2.5 py-2 text-sm has-[:enabled]:cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              className="size-4 shrink-0 accent-primary"
                              checked={row[field]}
                              disabled={!data.canEdit || mandatory}
                              onChange={(event) =>
                                setDrafts((previous) =>
                                  previous.map((item) =>
                                    item.serviceType === row.serviceType
                                      ? { ...item, [field]: event.target.checked }
                                      : item
                                  )
                                )
                              }
                            />
                            <span className="min-w-0 font-medium">
                              {word('rule.' + field)}
                              {mandatory ? (
                                <span className="block text-xs font-normal text-muted-foreground">
                                  {word('mandatoryRequirement')}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {data.canEdit ? (
                      <RecordEditorActions className="sm:px-4">
                        <Button type="submit" disabled={!changed}>
                          {word('saveActivationRules')}
                        </Button>
                      </RecordEditorActions>
                    ) : null}
                  </fieldset>
                </form>
              );
            })}
          </div>
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => {
            setBusy(false);
            setAction(null);
          }}
          onDenied={scope.deny}
          onPendingChange={setBusy}
          onUnconfirmed={() => {
            setUnconfirmed(action);
            setRequiredRead(resource.nextReadAttempt());
          }}
          confirmationDisabled={!ready || !data?.canEdit}
          summary={
            <>
              {savedActionRule && (
                <section className="space-y-2 rounded-lg border bg-muted/25 p-3">
                  <h3 className="text-sm font-medium">
                    {tContractAuthoring('rulesChanged', locale)}
                  </h3>
                  <dl className="space-y-1.5 text-sm">
                    {fields
                      .filter((field) => savedActionRule[field] !== action.body[field])
                      .map((field) => (
                        <div
                          key={field}
                          className="flex flex-wrap items-baseline justify-between gap-1"
                        >
                          <dt>{word('rule.' + field)}</dt>
                          <dd>
                            {tContractAuthoring('ruleChange', locale)
                              .replace('{before}', word(savedActionRule[field] ? 'yes' : 'no'))
                              .replace('{after}', word(action.body[field] ? 'yes' : 'no'))}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </section>
              )}
              {requiredRead !== null && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || loading}
                    onClick={refresh}
                  >
                    {word('refresh')}
                  </Button>
                  {error && <p role="alert">{word('error')}</p>}
                </div>
              )}
            </>
          }
          onSuccess={async (result) => {
            if (
              !data ||
              !validRule(result) ||
              result.serviceType !== action.serviceType ||
              result.revision !== action.body.expectedRevision + 1 ||
              !fields.every((field) => result[field] === action.body[field])
            )
              throw new Error('Activation rule receipt mismatch');
            resource.accept({
              ...data,
              rules: data.rules.map((row) =>
                row.serviceType === result.serviceType ? result : row
              ),
            });
            setUnconfirmed(null);
            resource.retry();
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </div>
  );
}
