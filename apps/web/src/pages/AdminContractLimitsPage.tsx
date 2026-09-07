import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import type { ContractElectricityLimits } from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
const fields: Array<{ key: keyof ContractElectricityLimits; min: number; max: number }> = [
  { key: 'maxQuantityIncreasePercent', min: 0, max: 1000 },
  { key: 'maxContractDuration', min: 1, max: 1200 },
  { key: 'leadTimeDays', min: 0, max: 36500 },
];
export default function AdminContractLimitsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.contractLimits.${key}`, locale);
  const [config, setConfig] = useState<ContractElectricityLimits | null>(null),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    setConfig(null);
    void (async () => {
      try {
        const response = await fetch('/api/admin/config/contract-electricity-limits', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 403) {
          setDenied(true);
          return;
        }
        if (!response.ok) throw new Error('Unavailable');
        const value = (await response.json()) as ContractElectricityLimits;
        if (!controller.signal.aborted) setConfig(value);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setAction({
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
    });
  }
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{label('title')}</h1>
          <p className="text-muted-foreground">{label('description')}</p>
        </div>
        <Button variant="outline" disabled={loading} onClick={() => setRevision((v) => v + 1)}>
          {label('refresh')}
        </Button>
      </header>
      {loading ? (
        <p role="status">{label('loading')}</p>
      ) : denied ? (
        <p role="alert">{label('forbidden')}</p>
      ) : error ? (
        <div role="alert">
          {label('error')}{' '}
          <Button onClick={() => setRevision((v) => v + 1)}>{label('retry')}</Button>
        </div>
      ) : (
        config && (
          <>
            {saved && <p role="status">{label('saved')}</p>}
            <p className="rounded border bg-white p-3">{label('scope')}</p>
            <form onSubmit={submit} className="max-w-xl space-y-5 rounded-lg border bg-white p-5">
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
              <Button type="submit">{label('save')}</Button>
            </form>
          </>
        )
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
