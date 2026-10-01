import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label, ListPage } from '@barghsa/ui';
import {
  SERVICE_RESPONSE_TARGET_TYPES,
  MAX_SERVICE_RESPONSE_TARGET_HOURS,
  type ServiceResponseTargets,
  type ServiceResponseTargetType,
} from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { isResponseTargets, targetBasis } from '../lib/assignment-settings.js';

type TargetsReview = TeamAction & {
  proposal: ServiceResponseTargets;
  basis: string;
  epoch: number;
};
export default function AdminServiceTargetsPage() {
  const locale = useLocale(),
    numbers = useNumberFormatting(locale),
    label = (key: string) => t(`admin.targets.${key}`, locale);
  const [draft, setDraft] = useState<{ values: ServiceResponseTargets; basis: string } | null>(
    null
  );
  const [saved, setSaved] = useState(false),
    [invalid, setInvalid] = useState(false);
  const [action, setAction] = useState<TargetsReview | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const clearPrivate = useCallback(() => {
    setDraft(null);
    setSaved(false);
    setInvalid(false);
    setAction(null);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const catalogue = useCatalogueResource(
    scope,
    '/api/admin/config/service-response-targets',
    isResponseTargets
  );
  const currentBasis = catalogue.data ? targetBasis(catalogue.data) : null;
  const values = draft?.values ?? catalogue.data;
  const stale = !!draft && draft.basis !== currentBasis;
  const ready = catalogue.data !== null && !catalogue.loading && !catalogue.error && !scope.denied;
  const dirty =
    !!draft &&
    !!catalogue.data &&
    SERVICE_RESPONSE_TARGET_TYPES.some((type) => draft.values[type] !== catalogue.data![type]);
  const reviewed = useRef({ action, basis: currentBasis });
  reviewed.current = { action, basis: currentBasis };
  useEffect(() => {
    if (action && (action.epoch !== scope.version || action.basis !== currentBasis))
      setAction(null);
  }, [action, currentBasis, scope.version]);
  function edit(type: ServiceResponseTargetType, value: number | null) {
    if (!values || !catalogue.data) return;
    setSaved(false);
    setInvalid(false);
    setDraft({
      values: { ...values, [type]: value },
      basis: draft?.basis ?? targetBasis(catalogue.data),
    });
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!ready || !values || !dirty || stale || action) return;
    if (!isResponseTargets(values)) {
      setInvalid(true);
      return;
    }
    setSaved(false);
    const proposal = { ...values };
    setAction({
      proposal,
      basis: currentBasis!,
      epoch: scope.version,
      title: label('save'),
      description: SERVICE_RESPONSE_TARGET_TYPES.map(
        (type) =>
          `${t(`admin.teams.${type}`, locale)}: ${proposal[type] === null ? label('disabled') : `${numbers.number(proposal[type]!)} ${label('hours')}`}`
      ).join('; '),
      path: '/api/admin/config/service-response-targets',
      method: 'PUT',
      body: proposal,
      forbiddenMessage: label('forbidden'),
    });
  }
  const refresh = () => (scope.denied ? scope.recover() : catalogue.retry());
  const recovery = (dialog = false) => (
    <div className="space-y-2">
      {catalogue.error && dialog && <p role="alert">{t('admin.teams.error', locale)}</p>}
      <Button
        ref={dialog ? undefined : refreshButton}
        type="button"
        variant="outline"
        disabled={catalogue.loading}
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
    </div>
  );
  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{label('note')}</p>
      </header>
      {saved && <p role="status">{t('admin.teams.saved', locale)}</p>}
      <ListPage>
        <ListPage.Toolbar>{recovery()}</ListPage.Toolbar>
        <ListPage.Content
          loading={catalogue.loading}
          error={catalogue.error || scope.denied}
          empty={false}
          emptyView={null}
          retainContent={catalogue.data !== null}
          loadingView={<p role="status">{t('admin.teams.loading', locale)}</p>}
          errorView={
            <p role="alert">{scope.denied ? label('forbidden') : t('admin.teams.error', locale)}</p>
          }
        >
          {values && (
            <form
              onSubmit={save}
              className="min-w-0 space-y-4 rounded-lg border bg-card text-card-foreground p-4"
            >
              {stale && <p role="alert">{label('stale')}</p>}
              {invalid && <p role="alert">{label('range')}</p>}
              <fieldset disabled={!!action} className="min-w-0 space-y-5">
                {SERVICE_RESPONSE_TARGET_TYPES.map((type) => (
                  <fieldset key={type} className="min-w-0 space-y-2 border-b pb-4">
                    <legend className="font-semibold">{t(`admin.teams.${type}`, locale)}</legend>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={values[type] !== null}
                        onChange={(event) => edit(type, event.target.checked ? 24 : null)}
                      />
                      {label('enabled')} — {t(`admin.teams.${type}`, locale)}
                    </label>
                    {values[type] !== null && (
                      <div className="max-w-xs">
                        <Label htmlFor={`target-${type}`}>
                          {label('hours')} — {t(`admin.teams.${type}`, locale)}
                        </Label>
                        <Input
                          id={`target-${type}`}
                          type="number"
                          min={1}
                          max={MAX_SERVICE_RESPONSE_TARGET_HOURS}
                          step={1}
                          required
                          value={Number.isNaN(values[type]) ? '' : values[type]!}
                          onChange={(event) => edit(type, event.target.valueAsNumber)}
                        />
                      </div>
                    )}
                  </fieldset>
                ))}
                <p className="text-sm text-muted-foreground">{label('range')}</p>
                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={!ready || stale || !dirty}>
                    {label('save')}
                  </Button>
                  {draft && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setDraft(null);
                        setInvalid(false);
                        setSaved(false);
                      }}
                    >
                      {label('reset')}
                    </Button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
        </ListPage.Content>
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          summary={recovery(true)}
          onDenied={scope.deny}
          confirmationDisabled={
            !ready || stale || action.epoch !== scope.version || action.basis !== currentBasis
          }
          finalFocus={() => refreshButton.current}
          onClose={() => setAction(null)}
          onSuccess={async (result) => {
            if (
              scope.live.current !== action.epoch ||
              reviewed.current.action !== action ||
              reviewed.current.basis !== action.basis
            )
              return;
            if (!isResponseTargets(result) || targetBasis(result) !== targetBasis(action.proposal))
              throw new Error('Invalid targets acknowledgement');
            if (!catalogue.accept(result)) return;
            setDraft(null);
            setInvalid(false);
            setSaved(true);
            catalogue.retry();
          }}
        />
      )}
    </section>
  );
}
