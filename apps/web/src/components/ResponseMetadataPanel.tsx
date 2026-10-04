import { t } from '@barghsa/i18n/admin-ui';
import { assistantChatFormText } from '@barghsa/i18n/assistant-chat-forms';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { chatTokenTotal, type TestChatResult } from '../lib/assistant-chat.js';

export function ResponseMetadataPanel({
  result,
  locale,
}: {
  result: TestChatResult;
  locale: 'fa' | 'en';
}) {
  const label = (key: string) => t(`admin.agents.testChat.${key}`, locale);
  const copy = (key: Parameters<typeof assistantChatFormText>[0]) =>
    assistantChatFormText(key, locale);
  const numbers = useNumberFormatting(locale);
  const total = chatTokenTotal(result.tokenUsage);
  return (
    <details className="text-sm [overflow-wrap:anywhere]">
      <summary className="min-h-9 cursor-pointer py-2 font-medium">{label('metadata')}</summary>
      <div className="space-y-3 rounded-md border bg-muted/20 p-3">
        <details open>
          <summary className="min-h-9 cursor-pointer py-2 font-medium">
            {label('sources')} · {numbers.number(result.sources.length)}
          </summary>
          {result.sources.length === 0 ? (
            <p className="text-muted-foreground">{copy('noSources')}</p>
          ) : (
            <ul className="space-y-2">
              {result.sources.map((source, index) => (
                <li key={`${source.kbId}-${index}`}>
                  <details>
                    <summary className="min-h-9 cursor-pointer py-2">
                      {source.title}
                      {source.documentTitle ? ` / ${source.documentTitle}` : ''}
                    </summary>
                    <p className="whitespace-pre-wrap leading-6 text-muted-foreground">
                      {source.excerpt}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </details>
        <details open className="border-t pt-2">
          <summary className="min-h-9 cursor-pointer py-2 font-medium">
            {label('policies')} · {numbers.number(result.policyResults.length)}
          </summary>
          {result.policyResults.length === 0 ? (
            <p className="text-muted-foreground">{copy('noPolicies')}</p>
          ) : (
            <ul className="space-y-3">
              {result.policyResults.map((policy) => (
                <li key={policy.id} className="space-y-1">
                  <p className="font-medium">
                    {policy.title} — {copy(policy.result)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {copy('priority')}:{' '}
                    {policy.priority === null
                      ? copy('unrecorded')
                      : numbers.number(policy.priority)}
                  </p>
                  {policy.ruleChecks?.length ? (
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {policy.ruleChecks.map((check) => (
                        <li key={check.rule}>
                          {copy(`rule.${check.rule}`)} — {copy(`outcome.${check.outcome}`)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">{copy('rulesUnrecorded')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
        <details open className="border-t pt-2">
          <summary className="min-h-9 cursor-pointer py-2 font-medium">{label('tokens')}</summary>
          <dl className="space-y-2 tabular-nums">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt>{copy('tokenParts')}</dt>
              <dd dir="ltr" className="font-medium">
                {result.tokenUsage
                  ? `${numbers.number(result.tokenUsage.input)} / ${numbers.number(result.tokenUsage.output)}`
                  : copy('unrecorded')}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt>{copy('tokenTotal')}</dt>
              <dd className="font-medium">
                {total === null ? copy('unrecorded') : numbers.number(total)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{copy('tokenTotalHelp')}</p>
        </details>
        <details open className="border-t pt-2">
          <summary className="min-h-9 cursor-pointer py-2 font-medium">{label('latency')}</summary>
          <p className="tabular-nums">
            {copy('milliseconds').replace('{count}', numbers.number(result.latencyMs))}
          </p>
        </details>
      </div>
    </details>
  );
}
