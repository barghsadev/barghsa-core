import { useEffect, useRef, type FormEvent } from 'react';
import { Badge, Button, Label, NativeSelect } from '@barghsa/ui';
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
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from './RecordEditorLayout.js';
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
  savedAt,
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
  savedAt?: string | undefined;
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
    missing = !!choice && !selected,
    changed = choice !== (slot.agent?.id ?? ''),
    dedicatedEditor = savedAt !== undefined;
  const comparison = [
    { label: label('current'), agent: slot.agent, saved: true },
    ...(changed ? [{ label: copy('proposedAssignment'), agent: selected, saved: false }] : []),
  ];
  const reset = form.form.reset;
  useEffect(() => {
    if (!draft) reset({ agentId: choice });
  }, [draft, choice, reset]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || blocked || stale || !changed) return;
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
      className={recordEditorSurface}
      onSubmit={(event) => void submit(event)}
    >
      <fieldset disabled={locked} className="min-w-0">
        <legend className="sr-only">{label(slot.slotKey)}</legend>
        <RecordEditorSection title={label('edit')}>
          {stale && <p role="alert">{label('stale')}</p>}
          {missing && <p role="alert">{label('unavailable')}</p>}
          {catalogueRootMessage(form.errors) && (
            <p role="alert">{catalogueRootMessage(form.errors)}</p>
          )}
          {dedicatedEditor && (
            <dl
              aria-label={label('assignmentReview')}
              data-slot="slot-assignment-summary"
              className={`grid min-w-0 gap-2 ${changed ? 'grid-cols-2' : ''}`}
            >
              {comparison.map(({ label: title, agent, saved }) => (
                <div
                  key={title}
                  className={`min-w-0 space-y-1 rounded-lg px-3 py-2 ${saved ? 'bg-muted/50' : 'bg-primary/8'}`}
                >
                  <dt className="text-xs font-medium text-muted-foreground">{title}</dt>
                  <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-medium">
                    <bdi className="min-w-0 [overflow-wrap:anywhere]">
                      {agent?.title ||
                        label(!saved && missing ? 'unavailableChoice' : 'unassigned')}
                    </bdi>
                    {agent && (
                      <Badge variant="outline">
                        {label(agent.enabled ? 'eligibleAgent' : 'disabled')}
                      </Badge>
                    )}
                  </dd>
                  {saved && (
                    <dd className="text-xs text-muted-foreground">
                      <time dateTime={slot.updatedAt}>{savedAt}</time>
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
          <div className={recordEditorField}>
            <Label htmlFor={`slot-${slot.slotKey}`}>
              {dedicatedEditor ? label('agent') : `${label('agent')} · ${label(slot.slotKey)}`}
            </Label>
            <NativeSelect
              {...form.bind('agentId')}
              id={`slot-${slot.slotKey}`}
              className="w-full"
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
            </NativeSelect>
            <CatalogueFieldFeedback
              compact
              id={form.errorId('agentId')}
              error={form.errors.agentId}
              message={copy('agentId')}
            />
          </div>
          {selected && !selected.enabled && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              {label('disabledHelp')}
            </p>
          )}
          {dedicatedEditor && changed && !choice && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning" role="status">
              {label('fallback')}
            </p>
          )}
          {shared.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {label('shared')}: {shared.join(locale === 'fa' ? '، ' : ', ')}
            </p>
          )}
        </RecordEditorSection>
        <RecordEditorActions>
          {draft && (
            <Button
              type="button"
              variant="ghost"
              disabled={!ready || resetBlocked}
              aria-label={`${label('reset')} ${label(slot.slotKey)}`}
              onClick={onReset}
            >
              {label('reset')}
            </Button>
          )}
          <CatalogueSaveButton
            label={label('save')}
            ariaLabel={`${label('save')} ${label(slot.slotKey)}`}
            pending={form.pending}
            disabled={!ready || blocked || stale || missing || !changed}
          />
        </RecordEditorActions>
      </fieldset>
    </form>
  );
}
