import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { assistantChatFormText } from '@barghsa/i18n/assistant-chat-forms';
import { withCsrf } from '../lib/csrf.js';
import { inputErrorFields } from '../lib/input-error-fields.js';
import { chatSlots, readTestChatResult, type TestChatResult } from '../lib/assistant-chat.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useChatRetryAfter } from '../hooks/useChatRetryAfter.js';
import {
  CatalogueFieldFeedback,
  CatalogueSaveButton,
  catalogueRootMessage,
} from './CatalogueEditorFeedback.js';

interface AgentOption {
  id: string;
  title: string;
  enabled: boolean;
}
type Draft = { agentId: string; slotKey: string; message: string };
type Request = {
  agentId: string;
  message: string;
  slotKey?: string;
  conversationId?: string;
  requestId: string;
};
const blank = () => ({ agentId: '', slotKey: '', message: '' });
interface Turn {
  message: string;
  result: TestChatResult;
}

export function AdminAgentTestChat({
  agents,
  locale,
  disabled = false,
  onDenied,
}: {
  agents: AgentOption[];
  locale: 'fa' | 'en';
  disabled?: boolean;
  onDenied?: () => void;
}) {
  const label = (key: string) => t(`admin.agents.testChat.${key}`, locale);
  const copy = (key: Parameters<typeof assistantChatFormText>[0]) =>
    assistantChatFormText(key, locale);
  const numbers = useNumberFormatting(locale);
  const live = useRef({ agents, disabled, onDenied });
  live.current = { agents, disabled, onDenied };
  const messages = { agentId: copy('agentId'), slotKey: copy('slotKey'), message: copy('message') };
  const form = useWizardForm<Draft>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<Draft>(messages, (value) => {
        const invalid: (keyof Draft)[] = [];
        if (!live.current.agents.some((a) => a.enabled && a.id === value.agentId))
          invalid.push('agentId');
        if (value.slotKey && !chatSlots.some((key) => key === value.slotKey))
          invalid.push('slotKey');
        if (!value.message.trim() || value.message.trim().length > 4000) invalid.push('message');
        return invalid;
      });
    },
    blank,
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(form.form, messages, copy('invalid'));
  const { agentId, slotKey, message } = form.values;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [quota, setQuota] = useState<number | null>(null);
  const [pending, setPending] = useState<Request | null>(null);
  const captured = useRef<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [serverFields, setServerFields] = useState<(keyof Draft)[]>([]);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const cooldown = useChatRetryAfter();
  function bind(field: keyof Draft) {
    const binding = form.bind(field);
    return {
      ...binding,
      'aria-invalid': serverFields.includes(field) || binding['aria-invalid'],
      'aria-describedby': serverFields.includes(field)
        ? form.errorId(field)
        : binding['aria-describedby'],
    };
  }
  const feedback = (field: keyof Draft) =>
    serverFields.includes(field) ? { message: messages[field] } : form.errors[field];
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, []);

  function clear(resetAgent = false) {
    setServerFields([]);
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    captured.current = null;
    setTurns([]);
    setConversationId(undefined);
    setPending(null);
    setError('');
    setQuota(null);
    setBusy(false);
    form.form.reset(resetAgent ? blank() : { ...form.form.getValues(), message: '' });
  }
  const selectedRemoved = !!agentId && !agents.some((a) => a.enabled && a.id === agentId);
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => {
    if (selectedRemoved) clearRef.current(true);
  }, [selectedRemoved]);

  async function send(payload: Request) {
    if (
      !mounted.current ||
      live.current.disabled ||
      denied ||
      controller.current ||
      cooldown.blocked() ||
      !live.current.agents.some((a) => a.enabled && a.id === payload.agentId)
    )
      return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/ai/test-chat', {
        method: 'POST',
        credentials: 'include',
        signal: request.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (request.signal.aborted || !mounted.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          clear(true);
          setDenied(true);
          setError(copy('denied'));
          live.current.onDenied?.();
          return;
        }
        const fields = inputErrorFields(
          await response.json().catch(() => null),
          response.status
        ).fields;
        if (request.signal.aborted || !mounted.current) return;
        if (response.status === 429) {
          setQuota(0);
          cooldown.read(response);
          setError(label('rateLimited'));
        } else if (fields && ownedFields(fields)) {
          setServerFields(fields as (keyof Draft)[]);
          setError(copy('invalid'));
        } else if (response.status === 422) {
          setError(label('policyBlocked'));
        } else if (response.status === 409) {
          setError(label('unavailable'));
        } else {
          setError(label('error'));
        }
        if (response.status < 500 && response.status !== 429) {
          setPending(null);
          captured.current = null;
        }
        return;
      }
      const result = readTestChatResult(await response.json(), payload.conversationId);
      if (request.signal.aborted || !mounted.current) return;
      if (response.status !== 200 || !result) throw new Error('Invalid answer');
      setTurns((current) => [...current, { message: payload.message, result }]);
      setConversationId(result.conversationId);
      setQuota(result.remainingQuota);
      form.form.reset({ agentId: payload.agentId, slotKey: payload.slotKey ?? '', message: '' });
      setPending(null);
      captured.current = null;
    } catch {
      if (!request.signal.aborted && mounted.current) setError(label('error'));
    } finally {
      if (controller.current === request) {
        controller.current = null;
        if (mounted.current) setBusy(false);
      }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      disabled ||
      denied ||
      captured.current ||
      controller.current ||
      form.isPending() ||
      cooldown.blocked()
    )
      return;
    const epoch = generation.current;
    setServerFields([]);
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit(
        async (value) => {
          if (
            !mounted.current ||
            epoch !== generation.current ||
            live.current.disabled ||
            denied ||
            !live.current.agents.some((a) => a.enabled && a.id === value.agentId)
          )
            return;
          const payload: Request = {
            agentId: value.agentId,
            message: value.message.trim(),
            ...(value.slotKey ? { slotKey: value.slotKey } : {}),
            ...(conversationId ? { conversationId } : {}),
            requestId: crypto.randomUUID(),
          };
          captured.current = payload;
          setPending(payload);
          await send(payload);
        },
        (errors) => {
          const field = (['agentId', 'slotKey', 'message'] as const).find((name) => errors[name]);
          requestAnimationFrame(() => {
            if (field && mounted.current && generation.current === epoch && !live.current.disabled)
              form.form.setFocus(field as keyof Draft);
          });
        }
      )();
    } finally {
      if (mounted.current) form.setValidationPending(false);
    }
  }
  const locked = disabled || denied || busy || form.pending;

  return (
    <section aria-label={label('title')} className="space-y-4 rounded-lg border p-4">
      <form
        noValidate
        aria-busy={busy || form.pending}
        onSubmit={(event) => void submit(event)}
        className="space-y-4"
      >
        {catalogueRootMessage(form.errors) && (
          <p role="alert">{catalogueRootMessage(form.errors)}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{label('title')}</h2>
          <Button type="button" variant="outline" onClick={() => clear()} disabled={locked}>
            {label('newConversation')}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">{label('isolated')}</p>
        <div className="flex flex-col gap-2">
          <label htmlFor="test-chat-agent">{label('agent')}</label>
          <select
            id="test-chat-agent"
            {...bind('agentId')}
            onBlur={() => {
              if (!form.isPending() && !controller.current) form.bind('agentId').onBlur();
            }}
            className="rounded-md border bg-background p-2"
            value={agentId}
            disabled={locked}
            onChange={(event) => {
              clear();
              form.field('agentId')[1](event.target.value);
            }}
          >
            <option value="">{label('chooseAgent')}</option>
            {agents
              .filter((agent) => agent.enabled)
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.title}
                </option>
              ))}
          </select>
          <CatalogueFieldFeedback
            id={form.errorId('agentId')}
            error={feedback('agentId')}
            message={messages.agentId}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="test-chat-slot">{label('slot')}</label>
          <select
            id="test-chat-slot"
            {...bind('slotKey')}
            onBlur={() => {
              if (!form.isPending() && !controller.current) form.bind('slotKey').onBlur();
            }}
            className="rounded-md border bg-background p-2"
            value={slotKey}
            disabled={locked}
            onChange={(event) => {
              clear();
              form.field('slotKey')[1](event.target.value);
            }}
          >
            <option value="">{label('adminScope')}</option>
            {(
              [
                'individual_chatbot',
                'legal_entity_chatbot',
                'staff_chatbot',
                'website_chatbot',
                'telegram_chatbot',
              ] as const
            ).map((key) => (
              <option key={key} value={key}>
                {label(key)}
              </option>
            ))}
          </select>
          <CatalogueFieldFeedback
            id={form.errorId('slotKey')}
            error={feedback('slotKey')}
            message={messages.slotKey}
          />
          <p className="text-xs text-muted-foreground">{label('scopeHelp')}</p>
        </div>
        <div
          role="log"
          aria-live="polite"
          className="max-h-96 space-y-4 overflow-y-auto rounded-md bg-muted/30 p-3"
        >
          {!turns.length && <p className="text-sm text-muted-foreground">{label('empty')}</p>}
          {turns.map((turn, index) => (
            <div key={index} className="space-y-2">
              <div className="ms-auto max-w-[85%] rounded-lg bg-primary p-3 text-primary-foreground whitespace-pre-wrap break-words">
                {turn.message}
              </div>
              <div className="me-auto max-w-[85%] rounded-lg border bg-background p-3 whitespace-pre-wrap break-words">
                {turn.result.reply}
              </div>
              <p className="text-xs text-muted-foreground">
                {label(
                  turn.result.attribution === 'retrieved_context'
                    ? 'retrievedContext'
                    : 'generalGuidance'
                )}
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer">{label('metadata')}</summary>
                <div className="space-y-2 p-2">
                  <p>
                    {label('tokens')}:{' '}
                    {turn.result.tokenUsage
                      ? `${numbers.number(turn.result.tokenUsage.input)} / ${numbers.number(turn.result.tokenUsage.output)}`
                      : label('unknown')}
                  </p>
                  <p>
                    {label('latency')}:{' '}
                    {copy('milliseconds').replace('{count}', numbers.number(turn.result.latencyMs))}
                  </p>
                  <p>
                    {label('sources')}: {numbers.number(turn.result.sources.length)}
                  </p>
                  {turn.result.sources.map((source, sourceIndex) => (
                    <details key={`${source.kbId}-${sourceIndex}`}>
                      <summary>
                        {source.title}
                        {source.documentTitle ? ` / ${source.documentTitle}` : ''}
                      </summary>
                      <p className="whitespace-pre-wrap break-words">{source.excerpt}</p>
                    </details>
                  ))}
                  <p>
                    {label('policies')}: {numbers.number(turn.result.policyResults.length)}
                  </p>
                  <ul>
                    {turn.result.policyResults.map((policy) => (
                      <li key={policy.id}>
                        {policy.title} — {copy(policy.result)}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </div>
          ))}
        </div>
        {quota !== null && (
          <p role="status" className="text-sm">
            {label('remaining')}: {numbers.number(quota)}/{numbers.number(10)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {pending && !busy && (
          <Button
            type="button"
            variant="outline"
            disabled={locked || cooldown.seconds > 0}
            onClick={() => void send(pending)}
          >
            {label('retry')}
          </Button>
        )}
        {cooldown.seconds > 0 && (
          <p role="status">{copy('wait').replace('{seconds}', numbers.number(cooldown.seconds))}</p>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor="test-chat-message" className="sr-only">
            {label('message')}
          </label>
          <textarea
            id="test-chat-message"
            className="min-h-16 flex-1 rounded-md border bg-background p-2"
            {...bind('message')}
            onBlur={() => {
              if (!form.isPending() && !controller.current) form.bind('message').onBlur();
            }}
            disabled={locked || !!pending}
            value={message}
            onChange={(event) => {
              setServerFields((fields) => fields.filter((field) => field !== 'message'));
              form.field('message')[1](event.target.value);
            }}
            placeholder={label('message')}
          />
          <CatalogueFieldFeedback
            id={form.errorId('message')}
            error={feedback('message')}
            message={messages.message}
          />
          <CatalogueSaveButton
            label={busy ? label('sending') : label('send')}
            pending={busy || form.pending}
            disabled={locked || !!pending || cooldown.seconds > 0}
          />
        </div>
      </form>
    </section>
  );
}
