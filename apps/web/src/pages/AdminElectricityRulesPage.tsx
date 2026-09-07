import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Input, Label } from '@barghsa/ui';
import type { GreenElectricityConfig, GreenElectricityOrderMode } from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
interface Safety {
  simpleOrder: { blocked: boolean; reasons: string[] };
  advancedOrder: { blocked: boolean; reasons: string[] };
}
const modes: GreenElectricityOrderMode[] = ['simpleOrder', 'advancedOrder'];
export default function AdminElectricityRulesPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.green.${key}`, locale);
  const [config, setConfig] = useState<GreenElectricityConfig | null>(null),
    [safety, setSafety] = useState<Safety | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [denied, setDenied] = useState(false),
    [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setDenied(false);
    setConfig(null);
    setSafety(null);
    void (async () => {
      try {
        const responses = await Promise.all([
          fetch('/api/admin/config/green-electricity-rules', { signal: controller.signal }),
          fetch('/api/admin/config/green-electricity-rules/safety-status', {
            signal: controller.signal,
          }),
        ]);
        if (controller.signal.aborted) return;
        if (responses.some((r) => r.status === 403)) {
          setDenied(true);
          return;
        }
        if (responses.some((r) => !r.ok)) throw new Error('Unavailable');
        const [rules, status] = await Promise.all(responses.map((r) => r.json()));
        if (!controller.signal.aborted) {
          setConfig(rules);
          setSafety(status);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [revision]);
  function update(
    mode: GreenElectricityOrderMode,
    field: keyof GreenElectricityConfig[GreenElectricityOrderMode],
    value: number | boolean
  ) {
    setSaved(false);
    setConfig((current) =>
      current ? { ...current, [mode]: { ...current[mode], [field]: value } } : null
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setAction({
      title: label('save'),
      description: label('confirm'),
      path: '/api/admin/config/green-electricity-rules',
      method: 'PUT',
      body: config,
      forbiddenMessage: label('forbidden'),
      errorMessages: {
        'VALIDATION:INPUT_INVALID': label('activationFailed'),
        'CONFIG:STORED_VALUE_INVALID': label('corrupt'),
      },
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
            <p className="rounded border bg-white p-3">{label('snapshot')}</p>
            <form onSubmit={submit} className="space-y-5">
              <div className="grid gap-5 lg:grid-cols-2">
                {modes.map((mode) => (
                  <fieldset key={mode} className="space-y-4 rounded-lg border bg-white p-5">
                    <legend className="px-2 text-lg font-semibold">{label(mode)}</legend>
                    {safety?.[mode].blocked && (
                      <p
                        role="alert"
                        className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-950"
                      >
                        {label('blocked')}{' '}
                        {safety[mode].reasons.map((reason) => label(reason)).join(' · ')}
                      </p>
                    )}
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={config[mode].mandatoryGreenEnabled}
                        onChange={(e) => update(mode, 'mandatoryGreenEnabled', e.target.checked)}
                      />
                      {label('enabled')}
                    </label>
                    <div className="space-y-1">
                      <Label htmlFor={`${mode}-threshold`}>{label('threshold')}</Label>
                      <Input
                        id={`${mode}-threshold`}
                        type="number"
                        required
                        min={0}
                        max={Number.MAX_SAFE_INTEGER}
                        step={1}
                        value={
                          Number.isFinite(config[mode].averagePowerThresholdKw)
                            ? config[mode].averagePowerThresholdKw
                            : ''
                        }
                        onChange={(e) =>
                          update(
                            mode,
                            'averagePowerThresholdKw',
                            e.target.value === '' ? NaN : Number(e.target.value)
                          )
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${mode}-share`}>
                        {label('share')}:{' '}
                        {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
                          config[mode].mandatoryGreenSharePercent
                        )}
                        %
                      </Label>
                      <input
                        className="w-full"
                        id={`${mode}-share`}
                        type="range"
                        min={0}
                        max={100}
                        step={0.1}
                        value={config[mode].mandatoryGreenSharePercent}
                        onChange={(e) =>
                          update(mode, 'mandatoryGreenSharePercent', Number(e.target.value))
                        }
                      />
                    </div>
                  </fieldset>
                ))}
              </div>
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
