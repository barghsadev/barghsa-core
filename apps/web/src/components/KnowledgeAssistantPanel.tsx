import { useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpenText } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/app';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { withCsrf } from '../lib/csrf.js';

type Source = {
  kbId: string;
  title: string;
  documentTitle: string | null;
  excerpt: string;
};
type Answer = {
  reply: string;
  sources: Source[];
  attribution: 'retrieved_context';
  remainingQuota: number;
};
type AccountSnapshot = {
  profileName: string;
  walletBalance: string | null;
  pendingInvoices: number | null;
};
type Turn = {
  id: string;
  question: string;
  at: number;
  answer?: Answer;
  account?: AccountSnapshot;
};
type PendingRequest = { requestId: string; message: string };

const suggestions = [
  'assistant.suggestion.documents',
  'assistant.suggestion.payment',
  'assistant.suggestion.support',
];

export default function KnowledgeAssistantPanel({
  locale,
  slotKey,
  profileId,
  open,
  onOpenChange,
}: {
  locale: Locale;
  slotKey: 'individual_chatbot' | 'legal_entity_chatbot';
  profileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<PendingRequest | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const label = (key: string) => t(`assistant.${key}`, locale);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' });
  }, [open, turns, busy, error]);

  async function send(request?: PendingRequest) {
    if (busy) return;
    const message = request?.message ?? draft.trim();
    if (!message || message.length > 1000) return;
    const payload = request ?? { requestId: crypto.randomUUID(), message };
    if (!request) {
      setTurns((current) => [
        ...current,
        { id: payload.requestId, question: message, at: Date.now() },
      ]);
      setDraft('');
    }
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
        const body = (await response.json().catch(() => null)) as {
          error?: { code?: string };
        } | null;
        const code = body?.error?.code;
        setError(
          code === 'AI_KNOWLEDGE_NO_SOURCE'
            ? label('noSource')
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
        if (
          response.status >= 500 ||
          (response.status === 429 && code !== 'AI_MODEL_BUDGET_EXHAUSTED')
        )
          setRetry(payload);
        return;
      }
      const answer = (await response.json()) as Answer;
      setTurns((current) =>
        current.map((turn) => (turn.id === payload.requestId ? { ...turn, answer } : turn))
      );
    } catch {
      if (abort.signal.aborted) return;
      setError(label('error'));
      setRetry(payload);
    } finally {
      if (controller.current === abort) controller.current = null;
      setBusy(false);
    }
  }

  async function showAccountStatus() {
    if (busy) return;
    const id = crypto.randomUUID();
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
      if (!response.ok) throw new Error('Dashboard unavailable');
      const result: unknown = await response.json();
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
      setTurns((current) => current.filter((turn) => turn.id !== id || turn.account));
      if (controller.current === abort) controller.current = null;
      setAccountLoading(false);
      setBusy(false);
    }
  }

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

        <div
          className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6"
          role="log"
          aria-live="polite"
        >
          {turns.length === 0 && (
            <div className="space-y-5">
              <p className="max-w-sm text-base leading-7 text-foreground">{label('welcome')}</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="rounded-full border bg-card px-3 py-2 text-start text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    onClick={() => {
                      setDraft(t(key, locale));
                      input.current?.focus();
                    }}
                  >
                    {t(key, locale)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              <div className="ms-auto w-fit max-w-[88%] rounded-2xl rounded-ee-sm bg-primary px-4 py-3 text-primary-foreground">
                <p className="whitespace-pre-wrap leading-6">{turn.question}</p>
                <time className="mt-1 block text-end text-xs opacity-75">
                  {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
                    turn.at
                  )}
                </time>
              </div>
              {turn.answer && (
                <div className="max-w-[92%] space-y-3 rounded-2xl rounded-es-sm bg-muted px-4 py-3 text-foreground">
                  <p className="text-xs font-semibold text-muted-foreground">{label('answer')}</p>
                  <p className="whitespace-pre-wrap leading-7">{turn.answer.reply}</p>
                  <details className="border-t pt-3 text-sm">
                    <summary className="cursor-pointer font-medium text-primary">
                      {label('sources')} ·{' '}
                      {new Intl.NumberFormat(locale).format(turn.answer.sources.length)}
                    </summary>
                    <ul className="mt-3 space-y-3">
                      {turn.answer.sources.map((source, index) => (
                        <li key={`${source.kbId}-${index}`} className="space-y-1">
                          <p className="font-medium">{source.title}</p>
                          {source.documentTitle && (
                            <p className="text-xs text-muted-foreground">{source.documentTitle}</p>
                          )}
                          <p className="text-sm leading-6 text-muted-foreground">
                            {source.excerpt}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
              {turn.account && (
                <div className="max-w-[92%] space-y-4 rounded-2xl rounded-es-sm bg-muted px-4 py-4 text-foreground">
                  <div>
                    <p className="text-sm font-semibold">{label('account.title')}</p>
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
                          : formatCurrencyIrr(turn.account.walletBalance, locale)}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt>{label('account.invoices')}</dt>
                      <dd className="text-end font-semibold tabular-nums">
                        {turn.account.pendingInvoices === null
                          ? label('account.unavailable')
                          : new Intl.NumberFormat(locale).format(turn.account.pendingInvoices)}
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
                </div>
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
                <button
                  type="button"
                  className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  onClick={() => void send(retry)}
                >
                  {label('retry')}
                </button>
              )}
            </div>
          )}
          <div ref={end} />
        </div>

        <form
          className="space-y-3 border-t bg-card px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <button
            type="button"
            disabled={busy}
            className="text-start text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
            onClick={() => void showAccountStatus()}
          >
            {label('account.action')}
          </button>
          <label htmlFor="knowledge-question" className="sr-only">
            {label('input')}
          </label>
          <textarea
            ref={input}
            id="knowledge-question"
            className="min-h-20 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            maxLength={1000}
            rows={2}
            value={draft}
            placeholder={label('input')}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
              setRetry(null);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {turns.at(-1)?.answer
                ? label('remaining').replace(
                    '{count}',
                    new Intl.NumberFormat(locale).format(turns.at(-1)!.answer!.remainingQuota)
                  )
                : null}
            </p>
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <ArrowUp className="size-4 rtl:-rotate-90" aria-hidden="true" />
              {label('send')}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
