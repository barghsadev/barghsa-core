import { useState, type FormEvent } from 'react';
import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/admin-ui';
import { withCsrf } from '../lib/csrf.js';

interface AgentOption {
  id: string;
  title: string;
  enabled: boolean;
}
interface Result {
  conversationId: string;
  reply: string;
  sources: Array<{ kbId: string; title: string; excerpt: string }>;
  policyResults: Array<{ id: string; title: string; type: string; result: string }>;
  tokenUsage: { input: number; output: number } | null;
  latencyMs: number;
  remainingQuota: number;
}
interface Turn {
  message: string;
  result: Result;
}

export function AdminAgentTestChat({
  agents,
  locale,
}: {
  agents: AgentOption[];
  locale: 'fa' | 'en';
}) {
  const label = (key: string) => t(`admin.agents.testChat.${key}`, locale);
  const [agentId, setAgentId] = useState('');
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [quota, setQuota] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    agentId: string;
    message: string;
    conversationId?: string | undefined;
    requestId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function clear() {
    setTurns([]);
    setConversationId(undefined);
    setPending(null);
    setError('');
  }

  async function send(payload: NonNullable<typeof pending>) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/ai/test-chat', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        if (response.status === 429) {
          setQuota(0);
          setError(label('rateLimited'));
        } else if (response.status === 422) {
          setError(label('policyBlocked'));
        } else if (response.status === 409) {
          setError(label('unavailable'));
        } else {
          setError(label('error'));
        }
        if (response.status < 500) setPending(null);
        return;
      }
      const result = (await response.json()) as Result;
      setTurns((current) => [...current, { message: payload.message, result }]);
      setConversationId(result.conversationId);
      setQuota(result.remainingQuota);
      setMessage('');
      setPending(null);
    } catch {
      setError(label('error'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!agentId || !message.trim() || busy) return;
    const payload = {
      agentId,
      message: message.trim(),
      conversationId,
      requestId: crypto.randomUUID(),
    };
    setPending(payload);
    void send(payload);
  }

  return (
    <section aria-label={label('title')} className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{label('title')}</h2>
        <Button type="button" variant="outline" onClick={clear} disabled={busy}>
          {label('newConversation')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{label('isolated')}</p>
      <div className="flex flex-col gap-2">
        <label htmlFor="test-chat-agent">{label('agent')}</label>
        <select
          id="test-chat-agent"
          className="rounded-md border bg-background p-2"
          value={agentId}
          disabled={busy}
          onChange={(event) => {
            setAgentId(event.target.value);
            clear();
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
      </div>
      <div
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
            <details className="text-sm">
              <summary className="cursor-pointer">{label('metadata')}</summary>
              <div className="space-y-2 p-2">
                <p>
                  {label('tokens')}:{' '}
                  {turn.result.tokenUsage
                    ? `${turn.result.tokenUsage.input} / ${turn.result.tokenUsage.output}`
                    : label('unknown')}
                </p>
                <p>
                  {label('latency')}: {turn.result.latencyMs} ms
                </p>
                <p>
                  {label('sources')}: {turn.result.sources.length}
                </p>
                {turn.result.sources.map((source, sourceIndex) => (
                  <details key={`${source.kbId}-${sourceIndex}`}>
                    <summary>{source.title}</summary>
                    <p className="whitespace-pre-wrap break-words">{source.excerpt}</p>
                  </details>
                ))}
                <p>
                  {label('policies')}: {turn.result.policyResults.length}
                </p>
                <ul>
                  {turn.result.policyResults.map((policy) => (
                    <li key={policy.id}>
                      {policy.title} — {policy.result}
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
          {label('remaining')}: {quota}/10
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pending && !busy && (
        <Button type="button" variant="outline" onClick={() => void send(pending)}>
          {label('retry')}
        </Button>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="test-chat-message" className="sr-only">
          {label('message')}
        </label>
        <textarea
          id="test-chat-message"
          className="min-h-16 flex-1 rounded-md border bg-background p-2"
          maxLength={4000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={label('message')}
        />
        <Button type="submit" disabled={!agentId || !message.trim() || busy || Boolean(pending)}>
          {busy ? label('sending') : label('send')}
        </Button>
      </form>
    </section>
  );
}
