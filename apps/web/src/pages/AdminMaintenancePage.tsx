import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label } from '@barghsa/ui';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import type { MaintenanceCapability } from '../hooks/useMaintenance.js';

interface MaintenanceSetting {
  capability: MaintenanceCapability;
  active: boolean;
  reason: { fa: string; en: string } | null;
  estimatedUntil: string | null;
  owner: string | null;
  version: number;
  updatedAt: string | null;
}

interface Draft {
  active: boolean;
  reasonFa: string;
  reasonEn: string;
  owner: string;
  estimatedUntil: string;
}

function localInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function AdminMaintenancePage() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tMaintenance(key, locale);
  const [settings, setSettings] = useState<MaintenanceSetting[]>([]);
  const [selected, setSelected] = useState<MaintenanceSetting | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void fetch('/api/admin/maintenance', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 403) {
          if (!controller.signal.aborted) setState('denied');
          return null;
        }
        if (!response.ok) throw new Error('maintenance');
        return response.json() as Promise<MaintenanceSetting[]>;
      })
      .then((result) => {
        if (!controller.signal.aborted && result) {
          setSettings(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [revision]);

  function edit(setting: MaintenanceSetting) {
    setSelected(setting);
    setDraft({
      active: setting.active,
      reasonFa: setting.reason?.fa ?? '',
      reasonEn: setting.reason?.en ?? '',
      owner: setting.owner ?? '',
      estimatedUntil: localInput(setting.estimatedUntil),
    });
    setSaved(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft) return;
    const instant = draft.estimatedUntil ? new Date(draft.estimatedUntil) : null;
    if (draft.active && (!instant || Number.isNaN(instant.getTime()) || instant <= new Date()))
      return;
    setAction({
      title: copy('save'),
      description: copy('confirm'),
      path: `/api/admin/maintenance/${selected.capability}`,
      method: 'PUT',
      body: {
        active: draft.active,
        reason: draft.active ? { fa: draft.reasonFa.trim(), en: draft.reasonEn.trim() } : null,
        owner: draft.active ? draft.owner.trim() : null,
        estimatedUntil: draft.active ? instant?.toISOString() : null,
        expectedVersion: selected.version,
      },
      forbiddenMessage: copy('denied'),
      conflictMessage: copy('versionConflict'),
    });
  }

  return (
    <section className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy('adminTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy('adminDescription')}</p>
        </div>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          {copy('refresh')}
        </Button>
      </header>
      {saved && <p role="status">{copy('saved')}</p>}
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'denied' && <p role="alert">{copy('denied')}</p>}
      {state === 'error' && <p role="alert">{copy('loadError')}</p>}
      {state === 'ready' && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {settings.map((setting) => (
              <div
                key={setting.capability}
                className="rounded-lg border bg-card p-4 text-card-foreground"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{copy(setting.capability)}</h2>
                    <p className="text-sm text-muted-foreground">
                      {copy(setting.active ? 'active' : 'inactive')}
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => edit(setting)}>
                    {copy('manage')}
                  </Button>
                </div>
                {setting.active && setting.reason && (
                  <p className="mt-3 text-sm">{setting.reason[locale]}</p>
                )}
                {setting.active && setting.estimatedUntil && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {copy('estimatedUntil')}:{' '}
                    <time dateTime={setting.estimatedUntil}>
                      {time.format(setting.estimatedUntil)}
                    </time>
                  </p>
                )}
                {setting.active && setting.owner && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {copy('owner')}: {setting.owner}
                  </p>
                )}
              </div>
            ))}
          </div>
          {selected && draft && (
            <form
              onSubmit={submit}
              className="max-w-2xl space-y-4 rounded-lg border bg-card p-5 text-card-foreground"
            >
              <h2 className="text-lg font-semibold">{copy(selected.capability)}</h2>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
                />
                {copy('active')}
              </label>
              {draft.active && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="maintenance-reason-fa">{copy('reasonFa')}</Label>
                    <textarea
                      id="maintenance-reason-fa"
                      className="w-full rounded-md border bg-background p-2"
                      required
                      maxLength={500}
                      value={draft.reasonFa}
                      onChange={(event) => setDraft({ ...draft, reasonFa: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maintenance-reason-en">{copy('reasonEn')}</Label>
                    <textarea
                      id="maintenance-reason-en"
                      className="w-full rounded-md border bg-background p-2"
                      required
                      maxLength={500}
                      value={draft.reasonEn}
                      onChange={(event) => setDraft({ ...draft, reasonEn: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maintenance-owner">{copy('owner')}</Label>
                    <Input
                      id="maintenance-owner"
                      required
                      maxLength={100}
                      value={draft.owner}
                      onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maintenance-until">{copy('estimatedUntil')}</Label>
                    <Input
                      id="maintenance-until"
                      type="datetime-local"
                      required
                      value={draft.estimatedUntil}
                      onChange={(event) =>
                        setDraft({ ...draft, estimatedUntil: event.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">{copy('deviceTime')}</p>
                  </div>
                </>
              )}
              <Button type="submit">{copy('save')}</Button>
            </form>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSelected(null);
            setDraft(null);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </section>
  );
}
