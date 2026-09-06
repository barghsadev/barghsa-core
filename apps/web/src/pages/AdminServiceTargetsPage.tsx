import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n';
import { Button, Input, Label } from '@barghsa/ui';
import {
  SERVICE_RESPONSE_TARGET_TYPES,
  MAX_SERVICE_RESPONSE_TARGET_HOURS,
  type ServiceResponseTargets,
} from '@barghsa/shared/admin';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

export default function AdminServiceTargetsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.targets.${key}`, locale);
  const [targets, setTargets] = useState<ServiceResponseTargets>({
    ticket: null,
    verification_case: null,
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/admin/config/service-response-targets', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Unavailable');
      const data = (await response.json()) as ServiceResponseTargets;
      if (current === generation.current) setTargets(data);
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  function save(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setAction({
      title: label('save'),
      description: SERVICE_RESPONSE_TARGET_TYPES.map(
        (type) =>
          `${t(`admin.teams.${type}`, locale)}: ${targets[type] === null ? label('disabled') : `${new Intl.NumberFormat(locale).format(targets[type]!)} ${label('hours')}`}`
      ).join('; '),
      path: '/api/admin/config/service-response-targets',
      method: 'PUT',
      body: { ...targets },
      forbiddenMessage: label('forbidden'),
    });
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header>
        <h1 className="text-2xl font-semibold">{label('title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{label('note')}</p>
      </header>
      {saved && <p role="status">{t('admin.teams.saved', locale)}</p>}
      {loading ? (
        <p role="status">{t('admin.teams.loading', locale)}</p>
      ) : error ? (
        <div role="alert">
          {t('admin.teams.error', locale)}{' '}
          <Button variant="outline" onClick={() => void load()}>
            {t('admin.teams.retry', locale)}
          </Button>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-4 rounded-lg border bg-white p-4">
          <fieldset disabled={!!action} className="space-y-5">
            {SERVICE_RESPONSE_TARGET_TYPES.map((type) => (
              <fieldset key={type} className="space-y-2 border-b pb-4">
                <legend className="font-semibold">{t(`admin.teams.${type}`, locale)}</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={targets[type] !== null}
                    onChange={(event) =>
                      setTargets({ ...targets, [type]: event.target.checked ? 24 : null })
                    }
                  />
                  {label('enabled')} — {t(`admin.teams.${type}`, locale)}
                </label>
                {targets[type] !== null && (
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
                      value={Number.isNaN(targets[type]) ? '' : targets[type]!}
                      onChange={(event) =>
                        setTargets({ ...targets, [type]: event.target.valueAsNumber })
                      }
                    />
                  </div>
                )}
              </fieldset>
            ))}
            <p className="text-sm text-gray-600">{label('range')}</p>
            <Button type="submit">{label('save')}</Button>
          </fieldset>
        </form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            await load();
          }}
        />
      )}
    </section>
  );
}
