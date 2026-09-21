import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { documentRequest } from '../lib/documents.js';
import type { ContractActivationRule } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
const fields = ['signatureRequired', 'paymentRequired', 'serviceStartRequired'] as const;
export function ContractActivationRules() {
  const locale = useLocale(),
    [open, setOpen] = useState(false);
  const word = (key: string) => contractText(key, locale);
  return (
    <section className="rounded-xl border bg-card p-5" aria-label={word('activationRules')}>
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls="contract-activation-rules"
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
  const locale = useLocale(),
    word = (key: string) => contractText(key, locale);
  const [data, setData] = useState<{ rules: ContractActivationRule[]; canEdit: boolean } | null>(
      null
    ),
    [drafts, setDrafts] = useState<ContractActivationRule[]>([]),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0),
    [action, setAction] = useState<TeamAction | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    setAction(null);
    setDrafts([]);
    void documentRequest<{ rules: ContractActivationRule[]; canEdit: boolean }>(
      '/api/admin/contract-activation-rules',
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setData(value);
          setDrafts(value.rules);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [reload]);
  function save(row: ContractActivationRule) {
    setAction({
      title: word('saveActivationRules'),
      description: word(row.serviceType) + '. ' + word('activationRulesNotice'),
      path: '/api/admin/contract-activation-rules/' + row.serviceType,
      method: 'PUT',
      body: {
        expectedRevision: row.revision,
        signatureRequired: row.signatureRequired,
        paymentRequired: row.paymentRequired,
        serviceStartRequired: row.serviceStartRequired,
        idempotencyKey: crypto.randomUUID(),
      },
      conflictMessage: word('activationRulesConflict'),
      forbiddenMessage: word('denied'),
    });
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{word('activationRulesNotice')}</p>
      <Button
        className="self-start"
        variant="ghost"
        onClick={() => setReload((value) => value + 1)}
      >
        {word('refresh')}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {!data.canEdit ? <p>{word('activationRulesReadOnly')}</p> : null}
          <div className="grid gap-4 md:grid-cols-3">
            {drafts.map((row) => {
              const saved = data.rules.find((item) => item.serviceType === row.serviceType)!;
              const changed = fields.some((field) => row[field] !== saved[field]);
              return (
                <fieldset
                  key={row.serviceType}
                  className="flex flex-col gap-4 rounded-lg border p-4"
                >
                  <legend className="px-1 font-medium">{word(row.serviceType)}</legend>
                  {fields.map((field) => {
                    const mandatory =
                      (row.serviceType === 'solar' && field === 'signatureRequired') ||
                      (row.serviceType === 'electricity' && field === 'paymentRequired');
                    return (
                      <label key={field} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
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
                        <span>
                          {word('rule.' + field)}
                          {mandatory ? (
                            <span className="block text-xs text-muted-foreground">
                              {word('mandatoryRequirement')}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                  {data.canEdit ? (
                    <Button disabled={!changed} onClick={() => save(row)}>
                      {word('saveActivationRules')}
                    </Button>
                  ) : null}
                </fieldset>
              );
            })}
          </div>
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}
