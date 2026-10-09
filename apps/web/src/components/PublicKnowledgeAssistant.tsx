import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { t, type Locale } from '@barghsa/i18n/app';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { Button } from '@barghsa/ui';
import { ChatInput, ChatMessage } from './AssistantChatComponents.js';
import { chatRecord, readKnowledgeAnswer, type KnowledgeAnswer } from '../lib/assistant-chat.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { useChatRetryAfter } from '../hooks/useChatRetryAfter.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

/** A public, stateless question. No account request, cookie or conversation history is sent. */
export function PublicKnowledgeAssistant({ locale }: { locale: Locale }) {
  return <KnowledgeQuestionAssistant locale={locale} staff={false} />;
}

export function StaffKnowledgeAssistant({ locale }: { locale: Locale }) {
  return <KnowledgeQuestionAssistant locale={locale} staff />;
}

function KnowledgeQuestionAssistant(props: { locale: Locale; staff: boolean }) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedKnowledgeQuestionAssistant
      key={JSON.stringify([props.staff, props.staff ? actor : null, props.staff ? revision : 0])}
      {...props}
    />
  );
}
function OwnedKnowledgeQuestionAssistant({ locale, staff }: { locale: Locale; staff: boolean }) {
  const client = useQueryClient();
  const reader = useId();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const accountId = staff ? actor : null;
  const contextRevision = staff ? revision : 0;
  const copy = (key: string) => t('assistant.public.' + key, locale);
  const scopeCopy = (key: string) => t('assistant.' + (staff ? 'staff.' : 'public.') + key, locale);
  const endpoint = staff ? '/api/staff/knowledge' : '/api/public/knowledge';
  const credentials = staff ? 'include' : 'omit';
  const [available, setAvailable] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState('');
  const [question, setQuestion] = useState<{ text: string; at: number } | null>(null);
  const [answer, setAnswer] = useState<KnowledgeAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState(false);
  const sending = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const cooldown = useChatRetryAfter();
  const numbers = useNumberFormatting(locale);
  const timestamp = (value: string | number) =>
    formatInTimezone(value, 'Asia/Tehran', locale, { timeStyle: 'short' });
  useEffect(() => {
    const controller = new AbortController();
    const key = queryKeys.catalogue.detail(
      {
        context: staff ? 'staff' : 'account',
        ownerId: staff ? (accountId ?? 'current-account') : reader,
        accountId,
        revision: contextRevision,
      },
      JSON.stringify([reader, endpoint, locale, attempt])
    );
    const cancel = () => void client.cancelQueries({ queryKey: key, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    setAvailable(null);
    setAnswer(null);
    setQuestion(null);
    setBusy(false);
    setError(null);
    setFieldError(false);
    sending.current = null;
    void client
      .fetchQuery({
        queryKey: key,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: async ({ signal }) => {
          const response = await fetch(endpoint + '/availability', { credentials, signal });
          return { ok: response.ok, value: (await response.json()) as unknown };
        },
      })
      .then(async (response) => {
        const data: unknown = response.value;
        if (
          !response.ok ||
          !chatRecord(data) ||
          Object.keys(data).length !== 1 ||
          typeof data.available !== 'boolean'
        )
          throw new Error('Invalid availability');
        if (!controller.signal.aborted) setAvailable(data.available);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => {
      controller.abort();
      controller.signal.removeEventListener('abort', cancel);
      sending.current?.abort();
    };
  }, [locale, attempt, endpoint, credentials, client, reader, staff, accountId, contextRevision]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!available || sending.current || cooldown.blocked()) return;
    const message = draft.trim();
    if (!message || message.length > 1000) {
      setFieldError(true);
      input.current?.focus();
      return;
    }
    const controller = new AbortController();
    sending.current = controller;
    setBusy(true);
    setError(null);
    setFieldError(false);
    setQuestion({ text: message, at: Date.now() });
    setAnswer(null);
    try {
      const headers = { 'Content-Type': 'application/json', 'Accept-Language': locale };
      const response = await fetch(endpoint + '/questions', {
        method: 'POST',
        credentials,
        headers: staff ? withCsrf(headers) : headers,
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (staff && (response.status === 401 || response.status === 403)) {
          setAvailable(false);
          setAnswer(null);
          setQuestion(null);
          setDraft('');
          return;
        }
        if (response.status === 429) cooldown.read(response);
        if (response.status === 409) setAvailable(false);
        const code = authErrorCode(body);
        if (response.status === 400) {
          setFieldError(true);
          input.current?.focus();
        } else
          setError(
            copy(
              code === 'AI_WEBSITE_POLICY_BLOCKED' || code === 'AI_KNOWLEDGE_POLICY_BLOCKED'
                ? 'blocked'
                : code === 'AI_WEBSITE_BUSY'
                  ? 'busy'
                  : response.status === 409
                    ? 'unavailable'
                    : 'failure'
            )
          );
        return;
      }
      const result = readKnowledgeAnswer(body);
      if (!result) throw new Error('Invalid knowledge answer');
      setAnswer(result);
      setDraft('');
    } catch {
      if (!controller.signal.aborted) setError(copy('failure'));
    } finally {
      if (sending.current === controller) {
        sending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return (
    <section
      data-slot={staff ? 'staff-knowledge' : 'public-knowledge'}
      aria-labelledby={staff ? 'staff-knowledge-title' : 'public-knowledge-title'}
      className="space-y-5 border-t border-border pt-6"
    >
      <div className="space-y-2">
        <h2
          id={staff ? 'staff-knowledge-title' : 'public-knowledge-title'}
          className="text-lg font-semibold"
        >
          {scopeCopy('title')}
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">{scopeCopy('description')}</p>
        <p id="public-knowledge-scope" className="text-xs leading-5 text-muted-foreground">
          {scopeCopy('scope')}
        </p>
      </div>
      {available === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copy('loading')}
        </p>
      ) : !available ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted-foreground">
            {copy('unavailable')}
          </p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {copy('refresh')}
          </Button>
        </div>
      ) : (
        <>
          <div role="log" aria-live="polite" aria-busy={busy || undefined} className="space-y-4">
            {question && (
              <ChatMessage
                sender="user"
                message={question.text}
                locale={locale}
                timestamp={question.at}
                timestampLabel={t('assistant.sentAt', locale)}
                formatTimestamp={timestamp}
              />
            )}
            {answer && (
              <ChatMessage
                sender="assistant"
                message={answer.reply}
                knowledge={answer}
                locale={locale}
                timestamp={answer.answeredAt}
                timestampLabel={t('assistant.answeredAt', locale)}
                formatTimestamp={timestamp}
              />
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <form onSubmit={(event) => void submit(event)}>
            <ChatInput
              label={copy('question')}
              sendLabel={copy('send')}
              busy={busy}
              disabled={cooldown.seconds > 0}
              textareaProps={{
                id: 'public-knowledge-question',
                value: draft,
                ref: input,
                required: true,
                maxLength: 1000,
                placeholder: copy('placeholder'),
                'aria-invalid': fieldError || undefined,
                'aria-describedby':
                  'public-knowledge-scope' + (fieldError ? ' public-knowledge-error' : ''),
                onChange: (event) => {
                  setDraft(event.target.value);
                  setFieldError(false);
                },
              }}
              feedback={
                fieldError && (
                  <p id="public-knowledge-error" role="alert" className="text-sm text-destructive">
                    {copy('invalid')}
                  </p>
                )
              }
              footer={
                <p role="status" className="text-xs text-muted-foreground">
                  {cooldown.seconds > 0
                    ? copy('cooldown').replace('{seconds}', numbers.number(cooldown.seconds))
                    : answer
                      ? copy('quota').replace('{count}', numbers.number(answer.remainingQuota))
                      : ''}
                </p>
              }
            />
          </form>
        </>
      )}
    </section>
  );
}
