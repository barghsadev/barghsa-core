import type { ReactNode } from 'react';
import type { Locale } from '@barghsa/i18n/app';
import { Badge, DataTable, TextCell } from '@barghsa/ui';
import type { Model } from '../lib/ai-model-form.js';

/** Read-only presentation; the owning page supplies protected action handlers. */
export function AiModelRecordTable({
  models,
  locale,
  caption,
  label,
  numerals,
  formatNumber,
  formatTime,
  renderTitle,
  renderActions,
}: {
  models: Model[];
  locale: Locale;
  caption: string;
  label: (key: string) => string;
  numerals: 'latn' | 'arabext';
  formatNumber: (value: number) => string;
  formatTime: (value: string) => string;
  renderTitle?: (model: Model) => ReactNode;
  renderActions: (model: Model) => ReactNode;
}) {
  const usd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    numberingSystem: numerals,
  });
  const formatUsd = (micros: number) => usd.format(micros / 1_000_000);
  const name = (model: Model) => (
    <div className="space-y-1">
      <h2 className="font-semibold">
        {renderTitle ? renderTitle(model) : <TextCell value={model.title} />}
      </h2>
      <p className="text-sm text-muted-foreground" dir="auto">
        <TextCell value={model.modelName} />
      </p>
    </div>
  );
  const provider = (model: Model) =>
    model.providerType === 'anthropic' ? 'Anthropic' : label('openai');
  const status = (model: Model) => (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Badge variant={model.isEnabled ? 'secondary' : 'outline'}>
          {label(model.isEnabled ? 'enabled' : 'disabled')}
        </Badge>
        <Badge variant="outline">{label(model.status)}</Badge>
      </div>
      {model.circuitOpen && (
        <p className="font-medium text-destructive" role="status">
          {label('circuitOpen')}
          {model.circuitCooldownUntil && (
            <span className="block font-normal">
              {label('circuitRetry')}: {formatTime(model.circuitCooldownUntil)}
            </span>
          )}
        </p>
      )}
      {model.lastTestLatencyMs !== null && (
        <p className="text-xs text-muted-foreground">
          {label('latency')} <bdi>{formatNumber(model.lastTestLatencyMs)} ms</bdi>
        </p>
      )}
      {model.budget && (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{label('budgetTitle')}</p>
          {model.budget.monthlyTokenLimit !== null && (
            <p>
              {label('budgetTokens')}:{' '}
              <bdi>
                {formatNumber(model.budget.usedInputTokens + model.budget.usedOutputTokens)} /{' '}
                {formatNumber(model.budget.monthlyTokenLimit)}
              </bdi>
            </p>
          )}
          {model.budget.monthlyCostLimitMicros !== null && (
            <p>
              {label('budgetCost')}: <bdi>{formatUsd(model.budget.usedCostMicros)}</bdi> /{' '}
              <bdi>{formatUsd(model.budget.monthlyCostLimitMicros)}</bdi>
            </p>
          )}
        </div>
      )}
    </div>
  );
  const actions = (model: Model) => (
    <div role="group" aria-label={model.title} className="flex flex-wrap gap-2">
      {renderActions(model)}
    </div>
  );
  return (
    <DataTable
      locale={locale}
      numerals={numerals}
      caption={caption}
      scrollLabel={caption}
      data={models}
      keyExtractor={(model) => model.id}
      sortable={false}
      className="max-h-[40rem]"
      tableClassName="min-w-[42rem] text-start"
      columns={[
        {
          id: 'name',
          header: label('name'),
          rowHeader: true,
          cell: name,
          cellClassName: 'align-top p-4 text-start font-normal',
        },
        {
          id: 'provider',
          header: label('provider'),
          cell: provider,
          cellClassName: 'align-top p-4',
        },
        { id: 'status', header: label('status'), cell: status, cellClassName: 'align-top p-4' },
        { id: 'actions', header: label('actions'), cell: actions, cellClassName: 'align-top p-4' },
      ]}
      renderCard={(model) => (
        <div className="space-y-4 [overflow-wrap:anywhere]">
          {name(model)}
          <p className="text-sm">{provider(model)}</p>
          {status(model)}
          {actions(model)}
        </div>
      )}
    />
  );
}
