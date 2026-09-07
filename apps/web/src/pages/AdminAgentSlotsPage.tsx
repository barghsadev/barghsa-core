import { useEffect, useState } from 'react';
import { Button, Label } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
interface Agent {
  id: string;
  title: string;
  enabled: boolean;
}
interface Slot {
  slotKey: string;
  agent: Agent | null;
  alsoUsedIn: string[];
}
export default function AdminAgentSlotsPage() {
  const locale = useLocale(),
    label = (key: string) => t(`admin.slots.${key}`, locale);
  const [slots, setSlots] = useState<Slot[]>([]),
    [agents, setAgents] = useState<Agent[]>([]),
    [choices, setChoices] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0),
    [state, setState] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading'),
    [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setSlots([]);
    setAgents([]);
    setChoices({});
    void (async () => {
      try {
        const responses = await Promise.all(
          ['/api/admin/agent-slots', '/api/admin/agents'].map((path) =>
            fetch(path, { signal: abort.signal })
          )
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const [slotRows, agentRows] = await Promise.all(
          responses.map((response) => response.json())
        );
        if (abort.signal.aborted) return;
        setSlots(slotRows as Slot[]);
        setAgents(agentRows as Agent[]);
        setChoices(
          Object.fromEntries(
            (slotRows as Slot[]).map((slot) => [slot.slotKey, slot.agent?.id ?? ''])
          )
        );
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [revision]);
  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <p>{label('description')}</p>
      <div>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          {label('refresh')}
        </Button>
      </div>
      {saved && <p role="status">{label('saved')}</p>}
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'ready' && (
        <div className="divide-y">
          {slots.map((slot) => {
            const choice = choices[slot.slotKey] ?? '',
              selected = agents.find((agent) => agent.id === choice),
              shared = slots
                .filter(
                  (other) => other.slotKey !== slot.slotKey && choice && other.agent?.id === choice
                )
                .map((other) => label(other.slotKey));
            return (
              <form
                key={slot.slotKey}
                className="flex flex-col gap-3 py-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSaved(false);
                  setAction({
                    title: label('save'),
                    description: `${label(slot.slotKey)}: ${selected?.title ?? label('unassigned')}. ${label('confirm')}`,
                    path: `/api/admin/agent-slots/${slot.slotKey}/agent`,
                    method: 'PUT',
                    body: { agentId: choice || null },
                    forbiddenMessage: label('denied'),
                    conflictMessage: label('conflict'),
                  });
                }}
              >
                <h2 className="text-lg font-semibold">{label(slot.slotKey)}</h2>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor={`slot-${slot.slotKey}`}>
                      {label('agent')} · {label(slot.slotKey)}
                    </Label>
                    <select
                      id={`slot-${slot.slotKey}`}
                      className="max-w-full rounded-md border bg-background p-2"
                      value={choice}
                      onChange={(event) =>
                        setChoices({ ...choices, [slot.slotKey]: event.target.value })
                      }
                    >
                      <option value="">{label('unassigned')}</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.title}
                          {agent.enabled ? '' : ` (${label('disabled')})`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    disabled={choice === (slot.agent?.id ?? '')}
                    aria-label={`${label('save')} ${label(slot.slotKey)}`}
                  >
                    {label('save')}
                  </Button>
                </div>
                {selected && !selected.enabled && (
                  <p className="text-sm" role="status">
                    {label('disabledHelp')}
                  </p>
                )}
                {shared.length > 0 && (
                  <p className="text-sm">
                    {label('shared')}: {shared.join(locale === 'fa' ? '، ' : ', ')}
                  </p>
                )}
              </form>
            );
          })}
        </div>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
