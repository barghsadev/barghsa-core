import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { SettingsFormSection } from '../components/SettingsFormSection.js';
const fields: Array<{ key: keyof ContractElectricityLimits; min: number; max: number }> = [
  { key: 'maxQuantityIncreasePercent', min: 0, max: 1000 },
  { key: 'maxContractDuration', min: 1, max: 1200 },
  { key: 'leadTimeDays', min: 0, max: 36500 },
];
function validLimits(value: unknown): value is ContractElectricityLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return fields.every(({ key, min, max }) => {
    const number = (value as Record<string, unknown>)[key];
    return (
      typeof number === 'number' && Number.isSafeInteger(number) && number >= min && number <= max
    );
  });
}
const basis = (value: ContractElectricityLimits) =>
  JSON.stringify(fields.map(({ key }) => value[key]));
export default function AdminContractLimitsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.contractLimits.${key}`, locale);
  const [config, setConfig] = useState<ContractElectricityLimits | null>(null),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const accepted = useRef<ContractElectricityLimits | null>(null),
    actionRef = useRef<TeamAction | null>(null),
    generation = useRef(0);
  const closeAction = useCallback(() => {
    generation.current++;
    actionRef.current = null;
    setAction(null);
  }, []);
  const clear = useCallback(() => {
    closeAction();
    accepted.current = null;
    setConfig(null);
    setSaved(false);
  }, [closeAction]);
  const scope = useCatalogueScope(clear);
  const resource = useCatalogueResource(
    scope,
    '/api/admin/config/contract-electricity-limits',
    validLimits
  );
  const ready = !scope.denied && !!resource.data && !resource.loading && !resource.error;
  useEffect(
    () => () => {
      generation.current++;
      actionRef.current = null;
    },
    []
  );
  useEffect(() => {
    if (!resource.data || resource.loading || resource.error) return;
    if (!accepted.current || basis(accepted.current) !== basis(resource.data)) {
      closeAction();
      setConfig({ ...resource.data });
      setSaved(false);
    }
    accepted.current = resource.data;
  }, [resource.data, resource.loading, resource.error, closeAction]);
  function refresh() {
    if (scope.denied) scope.recover();
    else resource.retry();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!config || !ready || !validLimits(config)) return;
    closeAction();
    setSaved(false);
    const next: TeamAction = {
      title: label('save'),
      description: label('confirm'),
      path: '/api/admin/config/contract-electricity-limits',
      method: 'PUT',
      body: {
        max_quantity_increase_percent: config.maxQuantityIncreasePercent,
        max_contract_duration_months: config.maxContractDuration,
        lead_time_days: config.leadTimeDays,
      },
      forbiddenMessage: label('forbidden'),
    };
    actionRef.current = next;
    setAction(next);
  }
  const completionGeneration = generation.current;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button variant="outline" disabled={resource.loading} onClick={refresh}>
          {label('refresh')}
        </Button>
      </header>
      {saved && <p role="status">{label('saved')}</p>}
      {resource.loading && <p role="status">{label('loading')}</p>}
      {scope.denied && <p role="alert">{label('forbidden')}</p>}
      {resource.error && (
        <div role="alert">
          {label('error')}{' '}
          <Button variant="outline" onClick={resource.retry}>
            {label('retry')}
          </Button>
        </div>
      )}
      {config && (
        <>
          <SettingsFormSection
            title={t('admin.settings.contractTerms', locale)}
            description={label('scope')}
            onSubmit={submit}
            className="max-w-xl"
            saved={saved}
            savedMessage={label('saved')}
            actions={
              <Button type="submit" disabled={!!action || !ready || !validLimits(config)}>
                {label('save')}
              </Button>
            }
          >
            <fieldset disabled={!!action} className="space-y-5">
              {fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`contract-limit-${field.key}`}>{label(field.key)}</Label>
                  <Input
                    id={`contract-limit-${field.key}`}
                    type="number"
                    required
                    min={field.min}
                    max={field.max}
                    step={1}
                    value={Number.isFinite(config[field.key]) ? config[field.key] : ''}
                    onChange={(event) => {
                      const value = event.target.value === '' ? NaN : Number(event.target.value);
                      setSaved(false);
                      setConfig((current) => (current ? { ...current, [field.key]: value } : null));
                    }}
                    aria-describedby={`contract-limit-help-${field.key}`}
                  />
                  <p
                    className="text-sm text-muted-foreground"
                    id={`contract-limit-help-${field.key}`}
                  >
                    {label(`${field.key}Help`)}
                  </p>
                </div>
              ))}
            </fieldset>
          </SettingsFormSection>
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={closeAction}
          confirmationDisabled={!ready}
          summary={
            <div className="space-y-2">
              <Button type="button" variant="outline" disabled={resource.loading} onClick={refresh}>
                {label('refresh')}
              </Button>
              {resource.error && (
                <div role="alert">
                  {label('error')}{' '}
                  <Button type="button" variant="outline" onClick={resource.retry}>
                    {label('retry')}
                  </Button>
                </div>
              )}
            </div>
          }
          onSuccess={async (result) => {
            if (
              generation.current !== completionGeneration ||
              actionRef.current !== action ||
              scope.denied
            )
              return;
            const body = action.body as Record<string, number>;
            if (
              !validLimits(result) ||
              result.maxQuantityIncreasePercent !== body.max_quantity_increase_percent ||
              result.maxContractDuration !== body.max_contract_duration_months ||
              result.leadTimeDays !== body.lead_time_days
            )
              throw new Error('Invalid limits acknowledgement');
            closeAction();
            accepted.current = result;
            setConfig({ ...result });
            setSaved(true);
            resource.retry();
          }}
        />
      )}
    </section>
  );
}
