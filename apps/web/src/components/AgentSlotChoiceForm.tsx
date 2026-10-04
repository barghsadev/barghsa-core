import { useEffect, useRef, type FormEvent } from 'react';
import { Button, Label } from '@barghsa/ui';
import type { Locale } from '@barghsa/i18n/app';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';
import type { AgentSlot, AssignmentAgent } from '../lib/assignment-settings.js';
export function AgentSlotChoiceForm({
  slot,
  agents,
  draft,
  stale,
  ready,
  locked,
  blocked,
  resetBlocked,
  locale,
  label,
  shared,
  onChange,
  onReset,
  begin,
  current,
  finish,
  propose,
}: {
  slot: AgentSlot;
  agents: AssignmentAgent[];
  draft?: { id: string; basis: string } | undefined;
  stale: boolean;
  ready: boolean;
  locked: boolean;
  blocked: boolean;
  resetBlocked: boolean;
  locale: Locale;
  label: (key: string) => string;
  shared: string[];
  onChange: (id: string) => void;
  onReset: () => void;
  begin: (cancel: () => void) => number | null;
  current: (epoch: number) => boolean;
  finish: (epoch: number) => void;
  propose: (epoch: number, agentId: string | null, errors: (fields: unknown[]) => boolean) => void;
}) {
  const copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale);
  const source = useRef(agents);
  source.current = agents;
  const form = useWizardForm<{ agentId: string }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema({ agentId: copy('agentId') }, (value: { agentId: string }) =>
        value.agentId &&
        (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.agentId) ||
          !source.current.some((agent) => agent.id === value.agentId))
          ? ['agentId']
          : []
      );
    },
    () => ({ agentId: draft?.id ?? slot.agent?.id ?? '' }),
    copy('unavailable')
  );
  const owned = useActionFieldErrors(form.form, { agentId: copy('agentId') }, copy('invalid'));
  const choice = draft?.id ?? slot.agent?.id ?? '',
    selected = agents.find((agent) => agent.id === choice),
    missing = !!choice && !selected;
  const reset = form.form.reset;
  useEffect(() => {
    if (!draft) reset({ agentId: choice });
  }, [draft, choice, reset]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || blocked || stale || choice === (slot.agent?.id ?? '')) return;
    const epoch = begin(() => form.setValidationPending(false));
    if (epoch === null) return;
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit((value) => {
        if (current(epoch)) propose(epoch, value.agentId || null, owned);
      })();
    } finally {
      if (current(epoch)) {
        form.setValidationPending(false);
        finish(epoch);
      }
    }
  }
  return (
    <form
      noValidate
      aria-busy={form.pending || undefined}
      className="min-w-0 space-y-3"
      onSubmit={(event) => void submit(event)}
    >
      {stale && <p role="alert">{label('stale')}</p>}
      {missing && <p role="alert">{label('unavailable')}</p>}
      {catalogueRootMessage(form.errors) && <p role="alert">{catalogueRootMessage(form.errors)}</p>}
      <fieldset disabled={locked} className="flex min-w-0 flex-wrap items-end gap-3">
        <legend className="sr-only">{label(slot.slotKey)}</legend>
        <div className="flex min-w-0 flex-col gap-2">
          <Label htmlFor={`slot-${slot.slotKey}`}>
            {label('agent')} · {label(slot.slotKey)}
          </Label>
          <select
            {...form.bind('agentId')}
            id={`slot-${slot.slotKey}`}
            className="max-w-full rounded-md border bg-background p-2"
            value={choice}
            onChange={(event) => {
              form.field('agentId')[1](event.target.value);
              onChange(event.target.value);
            }}
          >
            <option value="">{label('unassigned')}</option>
            {missing && (
              <option value={choice}>
                {slot.agent?.id === choice ? slot.agent.title : label('unavailableChoice')}
              </option>
            )}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.title}
                {agent.enabled ? '' : ` (${label('disabled')})`}
              </option>
            ))}
          </select>
          <CatalogueFieldFeedback
            id={form.errorId('agentId')}
            error={form.errors.agentId}
            message={copy('agentId')}
          />
        </div>
        <CatalogueSaveButton
          label={label('save')}
          ariaLabel={`${label('save')} ${label(slot.slotKey)}`}
          pending={form.pending}
          disabled={!ready || blocked || stale || missing || choice === (slot.agent?.id ?? '')}
        />
        {draft && (
          <Button
            type="button"
            variant="outline"
            disabled={!ready || resetBlocked}
            aria-label={`${label('reset')} ${label(slot.slotKey)}`}
            onClick={onReset}
          >
            {label('reset')}
          </Button>
        )}
      </fieldset>
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
}
