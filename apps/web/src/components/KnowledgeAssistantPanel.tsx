import { useEffect, useRef, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/app';
import { assistantChatFormText } from '@barghsa/i18n/assistant-chat-forms';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { withCsrf } from '../lib/csrf.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useWizardForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useChatRetryAfter } from '../hooks/useChatRetryAfter.js';
import { inputErrorFields } from '../lib/input-error-fields.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { readKnowledgeAnswer, type KnowledgeAnswer } from '../lib/assistant-chat.js';
import { CatalogueFieldFeedback, catalogueRootMessage } from './CatalogueEditorFeedback.js';
import { knowledgeSuggestions } from '../lib/knowledge-assistant.js';
import {
  ChatInput,
  ChatMessage,
  ChatPromptSuggestions,
  ChatWelcome,
} from './AssistantChatComponents.js';
type AccountSnapshot = {
  receivedAt: number;
  profileName: string;
  walletBalance: string | null;
  pendingInvoices: number | null;
};
type Turn = {
  id: string;
  question: string;
  at: number;
  answer?: KnowledgeAnswer;
  account?: AccountSnapshot;
};
type PendingRequest = { requestId: string; message: string };

export default function KnowledgeAssistantPanel({
  locale,
  slotKey,
  profileId,
  profileName,
  open,
  onOpenChange,
  embedded = false,
  pathname = '/ai',
}: {
  locale: Locale;
  slotKey: 'individual_chatbot' | 'legal_entity_chatbot';
  profileId: string;
  profileName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  embedded?: boolean;
  pathname?: string;
}) {
  const copy = (key: Parameters<typeof assistantChatFormText>[0]) =>
    assistantChatFormText(key, locale);
  const form = useWizardForm<{ message: string }>(
    async () => {
      const { contentFormSchema } = await import('../lib/catalogue-form-schemas.js');
      return contentFormSchema<{ message: string }>({ message: copy('question') }, (value) =>
        !value.message.trim() || value.message.trim().length > 1000 ? ['message'] : []
      );
    },
    { message: '' },
    copy('unavailable')
  );
  const ownedFields = useActionFieldErrors(
    form.form,
    { message: copy('question') },
    copy('invalid')
  );
  const [draft, setDraft] = form.field('message');
  const numbers = useNumberFormatting(locale);
  const cooldown = useChatRetryAfter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<PendingRequest | null>(null);
  const [denied, setDenied] = useState(false);
  // Local resolver completions must not erase feedback from an already returned API result.
  const [serverMessageError, setServerMessageError] = useState(false);
  const captured = useRef<PendingRequest | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const promptDisclosure = useRef<HTMLDetailsElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const label = (key: string) => t(`assistant.${key}`, locale);
  const accountTime = useAccountTime(locale);
  const suggestions = knowledgeSuggestions(pathname, slotKey);
  const timestamp = (value: string | number) =>
    accountTime.format(value, { dateStyle: 'short', timeStyle: 'short' });

  const reset = form.form.reset;
  function deny() {
    setServerMessageError(false);
    captured.current = null;
    setTurns([]);
    reset({ message: '' });
    setRetry(null);
    setDenied(true);
    setError(copy('denied'));
  }
  useEffect(() => {
    mounted.current = true;
    setTurns([]);
    setRetry(null);
    setError(null);
    setBusy(false);
    setAccountLoading(false);
    setDenied(false);
    setServerMessageError(false);
    captured.current = null;
    controller.current = null;
    reset({ message: '' });
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
    };
  }, [profileId, slotKey, reset]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, turns, busy, error]);

  async function send(payload: PendingRequest, newQuestion = false) {
    if (!mounted.current || denied || controller.current || cooldown.blocked()) return;
    if (promptDisclosure.current) promptDisclosure.current.open = false;
    if (newQuestion)
      setTurns((current) => [
        ...current,
        { id: payload.requestId, question: payload.message, at: Date.now() },
      ]);
    setBusy(true);
    setAccountLoading(false);
    setError(null);
    setRetry(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch('/api/ai/knowledge/questions', {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json', 'Accept-Language': locale }),
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        if (abort.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          deny();
          return;
        }
        const fields = inputErrorFields(body, response.status).fields;
        const code = authErrorCode(body);
        if (fields && ownedFields(fields)) {
          setServerMessageError(true);
          captured.current = null;
          setError(copy('invalid'));
          return;
        }
        setError(
          code === 'AI_KNOWLEDGE_NO_SOURCE'
            ? label('noSource')
            : code === 'AI_KNOWLEDGE_POLICY_BLOCKED'
              ? label('policyBlocked')
              : code === 'AI_MODEL_BUDGET_EXHAUSTED'
                ? label('budget')
                : code === 'AI_KNOWLEDGE_BUSY'
                  ? label('busy')
                  : response.status === 429
                    ? label('limit')
                    : response.status === 409
                      ? label('changed')
                      : label('error')
        );
        if (response.status === 429) cooldown.read(response);
        if (
          response.status >= 500 ||
          (response.status === 429 && code !== 'AI_MODEL_BUDGET_EXHAUSTED')
        )
          setRetry(payload);
        else captured.current = null;
        return;
      }
      const answer = readKnowledgeAnswer(await response.json());
      if (abort.signal.aborted) return;
      if (response.status !== 200 || !answer) throw new Error('Invalid answer');
      setTurns((current) =>
        current.map((turn) => (turn.id === payload.requestId ? { ...turn, answer } : turn))
      );
      reset({ message: '' });
      captured.current = null;
    } catch {
      if (abort.signal.aborted) return;
      setError(label('error'));
      setRetry(payload);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (!abort.signal.aborted) setBusy(false);
      }
    }
  }
  async function submit() {
    if (denied || controller.current || captured.current || form.isPending() || cooldown.blocked())
      return;
    const epoch = generation.current;
    setServerMessageError(false);
    form.setValidationPending(true);
    try {
      await form.form.handleSubmit(async (value) => {
        if (!mounted.current || generation.current !== epoch || denied) return;
        const payload = { message: value.message.trim(), requestId: crypto.randomUUID() };
        captured.current = payload;
        await send(payload, true);
      })();
    } finally {
      if (mounted.current) form.setValidationPending(false);
    }
  }

  async function showAccountStatus() {
    if (denied || form.isPending() || captured.current || controller.current) return;
    const id = crypto.randomUUID();
    if (promptDisclosure.current) promptDisclosure.current.open = false;
    setTurns((current) => [...current, { id, question: label('account.action'), at: Date.now() }]);
    setBusy(true);
    setAccountLoading(true);
    setError(null);
    setRetry(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch('/api/dashboard', {
        credentials: 'include',
        cache: 'no-store',
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        deny();
        return;
      }
      if (!response.ok) throw new Error('Dashboard unavailable');
      const result: unknown = await response.json();
      if (abort.signal.aborted) return;
      if (!result || typeof result !== 'object') throw new Error('Invalid dashboard response');
      const dashboard = result as {
        profile?: { id?: unknown; name?: unknown };
        access?: { wallet?: unknown; invoices?: unknown };
        wallet?: { balance?: unknown; currency?: unknown } | null;
        pendingInvoices?: unknown;
      };
      if (dashboard.profile?.id !== profileId) {
        setError(label('account.changed'));
        return;
      }
      if (
        dashboard.access !== undefined &&
        (!dashboard.access ||
          typeof dashboard.access.wallet !== 'boolean' ||
          typeof dashboard.access.invoices !== 'boolean')
      )
        throw new Error('Invalid dashboard response');
      // During a rolling deployment, an older dashboard response can still
      // provide a wallet. Invoice access stays hidden until the new flag exists.
      const walletAllowed = dashboard.access?.wallet ?? dashboard.wallet != null;
      const invoicesAllowed = dashboard.access?.invoices ?? false;
      const balance = dashboard.wallet?.balance;
      const invoiceCount = dashboard.pendingInvoices;
      if (
        (walletAllowed &&
          (dashboard.wallet?.currency !== 'IRR' ||
            typeof balance !== 'string' ||
            !/^-?\d+$/.test(balance))) ||
        (invoicesAllowed &&
          (typeof invoiceCount !== 'number' ||
            !Number.isSafeInteger(invoiceCount) ||
            invoiceCount < 0))
      )
        throw new Error('Invalid dashboard response');
      const account: AccountSnapshot = {
        receivedAt: Date.now(),
        profileName:
          typeof dashboard.profile.name === 'string' && dashboard.profile.name.trim()
            ? dashboard.profile.name
            : label('account.unnamed'),
        walletBalance: walletAllowed && typeof balance === 'string' ? balance : null,
        pendingInvoices: invoicesAllowed && typeof invoiceCount === 'number' ? invoiceCount : null,
      };
      setTurns((current) => current.map((turn) => (turn.id === id ? { ...turn, account } : turn)));
    } catch {
      if (!abort.signal.aborted) setError(label('account.error'));
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        if (!abort.signal.aborted) {
          setTurns((current) => current.filter((turn) => turn.id !== id || turn.account));
          setAccountLoading(false);
          setBusy(false);
        }
      }
    }
  }

  const promptChips = (
    <ChatPromptSuggestions
      label={label('suggestions')}
      suggestions={suggestions.map((key) => ({ key, label: t(key, locale) }))}
      disabled={denied || busy || form.pending || !!retry}
      disclosureRef={promptDisclosure}
      onPick={(key) => {
        setDraft(t(key, locale));
        setServerMessageError(false);
        setRetry(null);
        setError(null);
        input.current?.focus();
      }}
    />
  );

  const conversation = (
    <>
      <div
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6"
        role="log"
        aria-live="polite"
      >
        {turns.length === 0 && (
          <ChatWelcome
            greeting={profileName ? label('welcomeNamed').replace('{name}', profileName) : null}
            description={label('welcome')}
            profileContext={label('profileContext').replace(
              '{name}',
              profileName ?? label(slotKey === 'legal_entity_chatbot' ? 'legal' : 'individual')
            )}
          >
            {promptChips}
          </ChatWelcome>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            <ChatMessage
              sender="user"
              message={turn.question}
              locale={locale}
              timestamp={turn.at}
              timestampLabel={label('sentAt')}
              formatTimestamp={timestamp}
            />
            {turn.answer && (
              <ChatMessage
                sender="assistant"
                message={turn.answer.reply}
                locale={locale}
                timestamp={turn.answer.answeredAt}
                timestampLabel={label('answeredAt')}
                formatTimestamp={timestamp}
                knowledge={turn.answer}
              />
            )}
            {turn.account && (
              <ChatMessage
                sender="account"
                locale={locale}
                timestamp={turn.account.receivedAt}
                timestampLabel={copy('receivedAt')}
                formatTimestamp={timestamp}
              >
                <div>
                  <p className="text-xs text-muted-foreground">
                    {turn.account.profileName} · {label('account.direct')}
                  </p>
                </div>
                <dl className="space-y-3 border-t pt-3 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt>{label('account.wallet')}</dt>
                    <dd className="text-end font-semibold tabular-nums">
                      {turn.account.walletBalance === null
                        ? label('account.unavailable')
                        : numbers.money(turn.account.walletBalance)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt>{label('account.invoices')}</dt>
                    <dd className="text-end font-semibold tabular-nums">
                      {turn.account.pendingInvoices === null
                        ? label('account.unavailable')
                        : numbers.number(turn.account.pendingInvoices)}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-x-4 gap-y-2 border-t pt-3 text-sm font-medium text-primary">
                  {turn.account.walletBalance !== null && (
                    <Link to="/wallet" onClick={() => onOpenChange(false)}>
                      {label('account.viewWallet')}
                    </Link>
                  )}
                  {turn.account.pendingInvoices !== null && (
                    <Link to="/invoices" onClick={() => onOpenChange(false)}>
                      {label('account.viewInvoices')}
                    </Link>
                  )}
                </div>
              </ChatMessage>
            )}
          </div>
        ))}
        {busy && (
          <p className="text-sm text-muted-foreground">
            {label(accountLoading ? 'account.loading' : 'working')}
          </p>
        )}
        {error && (
          <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3">
            <p className="text-sm text-destructive">{error}</p>
            {retry && (
              <div className="flex flex-col gap-2">
                <p className="text-sm">{copy('retryHelp')}</p>
                <div className="flex flex-wrap gap-4">
                  <button
                    type="button"
                    disabled={busy || form.pending || cooldown.seconds > 0}
                    className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    onClick={() => void send(retry)}
                  >
                    {label('retry')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || form.pending}
                    className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      const request = retry;
                      captured.current = null;
                      setRetry(null);
                      setError(null);
                      setTurns((current) =>
                        current.filter((turn) => turn.id !== request.requestId)
                      );
                      requestAnimationFrame(() => form.form.setFocus('message'));
                    }}
                  >
                    {copy('edit')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        noValidate
        aria-busy={busy || form.pending}
        className="space-y-3 border-t bg-card px-5 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {accountTime.notice}
        {catalogueRootMessage(form.errors) && (
          <p role="alert">{catalogueRootMessage(form.errors)}</p>
        )}
        {cooldown.seconds > 0 && (
          <p role="status">{copy('wait').replace('{seconds}', numbers.number(cooldown.seconds))}</p>
        )}
        <ChatInput
          label={label('input')}
          sendLabel={label('send')}
          busy={busy || form.pending}
          disabled={denied || busy || form.pending || !!retry || cooldown.seconds > 0}
          active={open}
          textareaProps={{
            ...form.bind('message'),
            'aria-invalid': serverMessageError || form.bind('message')['aria-invalid'],
            'aria-describedby': serverMessageError
              ? form.errorId('message')
              : form.bind('message')['aria-describedby'],
            onBlur: () => {
              if (!form.isPending() && !controller.current) form.bind('message').onBlur();
            },
            ref: (node) => {
              input.current = node;
              form.bind('message').ref(node);
            },
            id: 'knowledge-question',
            value: draft,
            placeholder: label('input'),
            disabled: denied || busy || form.pending || !!retry,
            onChange: (event) => {
              setDraft(event.target.value);
              setServerMessageError(false);
              setRetry(null);
              setError(null);
            },
          }}
          feedback={
            <CatalogueFieldFeedback
              id={form.errorId('message')}
              error={serverMessageError ? { message: copy('question') } : form.errors.message}
              message={copy('question')}
            />
          }
          footer={
            <p className="text-xs text-muted-foreground">
              {turns.at(-1)?.answer
                ? label('remaining').replace(
                    '{count}',
                    numbers.number(turns.at(-1)!.answer!.remainingQuota)
                  )
                : null}
            </p>
          }
        >
          {turns.length > 0 && promptChips}
          <button
            type="button"
            disabled={denied || busy || form.pending || !!retry}
            className="text-start text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => void showAccountStatus()}
          >
            {label('account.action')}
          </button>
        </ChatInput>
      </form>
    </>
  );
  if (embedded)
    return (
      <section
        className="flex h-[calc(100dvh-12rem)] min-h-[32rem] max-h-[56rem] flex-col overflow-hidden rounded-2xl border bg-card shadow-sm"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        aria-label={label('title')}
      >
        <header className="border-b bg-muted/35 px-5 py-5">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <BookOpenText className="size-5" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide">
              {label(slotKey === 'legal_entity_chatbot' ? 'legal' : 'individual')}
            </span>
          </div>
          <h1 className="text-xl font-semibold">{label('title')}</h1>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">{label('scope')}</p>
        </header>
        {conversation}
      </section>
    );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === 'fa' ? 'left' : 'right'}
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        closeLabel={label('close')}
        className="w-full gap-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b bg-muted/35 px-5 py-5 pe-14">
          <div className="mb-2 flex items-center gap-2 text-primary">
            <BookOpenText className="size-5" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide">
              {label(slotKey === 'legal_entity_chatbot' ? 'legal' : 'individual')}
            </span>
          </div>
          <SheetTitle className="text-lg font-semibold">{label('title')}</SheetTitle>
          <SheetDescription className="max-w-prose leading-6">{label('scope')}</SheetDescription>
        </SheetHeader>
        {conversation}
      </SheetContent>
    </Sheet>
  );
}
