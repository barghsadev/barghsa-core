import {
  useLayoutEffect,
  useRef,
  type ComponentPropsWithRef,
  type ReactNode,
  type Ref,
} from 'react';
import { ArrowUp } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/app';
import { assistantChatFormText } from '@barghsa/i18n/assistant-chat-forms';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { KnowledgeAnswer } from '../lib/assistant-chat.js';

export function ChatMessage({
  sender,
  message,
  locale,
  timestamp,
  timestampLabel,
  formatTimestamp,
  knowledge,
  children,
}: {
  sender: 'user' | 'assistant' | 'account';
  message?: string;
  children?: ReactNode;
  locale: Locale;
  timestamp: string | number | null;
  timestampLabel: string;
  formatTimestamp: (value: string | number) => string;
  knowledge?: Pick<KnowledgeAnswer, 'sources' | 'policyChecks'>;
}) {
  const label = (key: string) => t(`assistant.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  return (
    <article
      aria-label={assistantChatFormText(
        sender === 'user'
          ? 'yourMessage'
          : sender === 'account'
            ? 'accountMessage'
            : 'assistantMessage',
        locale
      )}
      data-message-role={sender}
      className={
        sender === 'user'
          ? 'ms-auto w-fit max-w-[88%] rounded-2xl rounded-ee-sm bg-primary px-4 py-3 text-primary-foreground [overflow-wrap:anywhere]'
          : 'me-auto max-w-[92%] space-y-3 rounded-2xl rounded-es-sm bg-muted px-4 py-3 text-foreground [overflow-wrap:anywhere]'
      }
    >
      {sender !== 'user' && (
        <p
          className={
            sender === 'account'
              ? 'text-sm font-semibold'
              : 'text-xs font-semibold text-muted-foreground'
          }
        >
          {sender === 'account'
            ? label('account.title')
            : knowledge
              ? label('answer')
              : assistantChatFormText('assistantMessage', locale)}
        </p>
      )}
      {message !== undefined && <p className="whitespace-pre-wrap leading-7">{message}</p>}
      {children}
      {knowledge && (
        <>
          <details className="border-t pt-3 text-sm">
            <summary className="min-h-9 cursor-pointer py-2 font-medium text-primary">
              {label('sources')} · {numbers.number(knowledge.sources.length)}
            </summary>
            <ul className="mt-3 space-y-3">
              {knowledge.sources.map((source, index) => (
                <li key={`${source.kbId}-${index}`} className="space-y-1">
                  <p className="font-medium">{source.title}</p>
                  {source.documentTitle && (
                    <p className="text-xs text-muted-foreground">{source.documentTitle}</p>
                  )}
                  <p className="text-sm leading-6 text-muted-foreground">{source.excerpt}</p>
                </li>
              ))}
            </ul>
          </details>
          <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
            {knowledge.policyChecks === null ? (
              <p>{label('policies.unrecorded')}</p>
            ) : knowledge.policyChecks.length === 0 ? (
              <p>{label('policies.none')}</p>
            ) : (
              <>
                <p>{label('policies.checked')}</p>
                <ul aria-label={label('policies.checked')} className="flex flex-wrap gap-2">
                  {knowledge.policyChecks.map((check) => (
                    <li
                      key={check.type}
                      className="rounded-full border bg-card px-2.5 py-1.5 text-foreground"
                    >
                      {label(`policies.${check.type}`)} · {numbers.number(check.count)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}
      {timestamp === null ? (
        <p className="text-xs text-muted-foreground">{label('timeUnrecorded')}</p>
      ) : (
        <p className={`mt-1 text-xs ${sender === 'user' ? 'text-end' : 'text-muted-foreground'}`}>
          {sender !== 'user' && `${timestampLabel} `}
          <time
            dateTime={typeof timestamp === 'string' ? timestamp : new Date(timestamp).toISOString()}
            aria-label={timestampLabel}
          >
            {formatTimestamp(timestamp)}
          </time>
        </p>
      )}
    </article>
  );
}

export function ChatInput({
  textareaProps,
  label,
  sendLabel,
  busy,
  disabled,
  active = true,
  feedback,
  footer,
  children,
}: {
  textareaProps: ComponentPropsWithRef<'textarea'> & { id: string; value: string };
  label: string;
  sendLabel: string;
  busy: boolean;
  disabled: boolean;
  active?: boolean;
  feedback?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    if (!active || !input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.min(input.current.scrollHeight, 240)}px`;
  }, [textareaProps.value, active]);
  return (
    <div className="space-y-3">
      {children}
      <label htmlFor={textareaProps.id} className="sr-only">
        {label}
      </label>
      <textarea
        {...textareaProps}
        ref={(node) => {
          input.current = node;
          const ref = textareaProps.ref;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        rows={2}
        disabled={busy || textareaProps.disabled}
        className="min-h-20 max-h-60 w-full resize-none overflow-y-auto rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onKeyDown={(event) => {
          textareaProps.onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            event.nativeEvent.keyCode !== 229
          ) {
            event.preventDefault();
            if (!disabled && !busy && !textareaProps.disabled)
              event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {feedback}
      <div className="flex items-center justify-between gap-3">
        {footer ?? <span />}
        <button
          type="submit"
          disabled={disabled || busy}
          aria-busy={busy || undefined}
          onMouseDown={(event) => {
            // WebKit restores scroll on textarea blur; keep the tap target stable until click.
            event.preventDefault();
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
            />
          ) : (
            <ArrowUp className="size-4 rtl:-rotate-90" aria-hidden="true" />
          )}
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

export function ChatWelcome({
  greeting,
  description,
  profileContext,
  children,
}: {
  greeting: string | null;
  description: string;
  profileContext: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {greeting && <p className="font-semibold text-foreground">{greeting}</p>}
        <p className="max-w-sm text-base leading-7 text-foreground">{description}</p>
        <p className="text-sm text-muted-foreground">{profileContext}</p>
      </div>
      {children}
    </div>
  );
}

export function ChatPromptSuggestions({
  label,
  suggestions,
  disabled,
  onPick,
  disclosureRef,
}: {
  label: string;
  suggestions: { key: string; label: string }[];
  disabled: boolean;
  onPick: (key: string) => void;
  disclosureRef: Ref<HTMLDetailsElement>;
}) {
  return (
    <details ref={disclosureRef}>
      <summary className="min-h-9 cursor-pointer py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {label}
      </summary>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={label}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.key}
            type="button"
            disabled={disabled}
            className="min-h-9 rounded-full border bg-background px-3 py-1.5 text-start text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            onClick={() => onPick(suggestion.key)}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </details>
  );
}
