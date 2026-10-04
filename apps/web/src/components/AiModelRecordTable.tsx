import type { ReactNode } from 'react';
import type { Locale } from '@barghsa/i18n/app';
import { DataTable, TextCell } from '@barghsa/ui';
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
  renderActions,
}: {
  models: Model[];
  locale: Locale;
  caption: string;
  label: (key: string) => string;
  numerals: 'latn' | 'arabext';
  formatNumber: (value: number) => string;
  formatTime: (value: string) => string;
  renderActions: (model: Model) => ReactNode;
}) {
  const usd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    numberingSystem: numerals,
  });
  const formatUsd = (micros: number) => usd.format(micros / 1_000_000);
  const name = (model: Model) => (
    <div className="space-y-2">
      <h2 className="font-semibold">
        <TextCell value={model.title} />
      </h2>
      <p className="break-all" dir="ltr">
        <TextCell value={model.baseUrl} />
      </p>
    </div>
  );
  const provider = (model: Model) => (
    <div className="space-y-2">
      <p>{model.providerType === 'anthropic' ? 'Anthropic' : label('openai')}</p>
      <p>
        {label('token')}: <span dir="ltr">{model.apiTokenMasked || label('noToken')}</span>
      </p>
    </div>
  );
  const status = (model: Model) => (
    <div className="space-y-2">
      <p className="font-medium">{label(model.isEnabled ? 'enabled' : 'disabled')}</p>
      <p>{label(model.status)}</p>
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
      {model.lastTestedAt && (
        <p>
          {label('lastTest')}: {formatTime(model.lastTestedAt)}
        </p>
      )}
      {model.lastTestLatencyMs !== null && (
        <p>
          {label('latency')}: <bdi>{formatNumber(model.lastTestLatencyMs)} ms</bdi>
        </p>
      )}
      {model.lastTestError && (
        <p className="break-words text-destructive" dir="auto">
          {model.lastTestError}
        </p>
      )}
      <div className="border-t pt-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{label('budgetTitle')}</p>
        {model.budget ? (
          <>
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
          </>
        ) : (
          <p>{label('budgetNone')}</p>
        )}
      </div>
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
      tableClassName="min-w-[760px] table-fixed text-start"
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
        {
          id: 'modelName',
          header: label('modelName'),
          cell: (model) => (
            <span dir="ltr" className="break-all">
              <TextCell value={model.modelName} />
            </span>
          ),
          cellClassName: 'align-top p-4',
        },
        { id: 'status', header: label('status'), cell: status, cellClassName: 'align-top p-4' },
        { id: 'actions', header: label('actions'), cell: actions, cellClassName: 'align-top p-4' },
      ]}
      renderCard={(model) => (
        <div className="space-y-4 [overflow-wrap:anywhere]">
          {name(model)}
          <div>
            <p className="text-sm text-muted-foreground">{label('provider')}</p>
            {provider(model)}
          </div>
          <p>
            <span className="text-muted-foreground">{label('modelName')}: </span>
            <span dir="ltr">
              <TextCell value={model.modelName} />
            </span>
          </p>
          <div>
            <h3 className="font-semibold">{label('status')}</h3>
            {status(model)}
          </div>
          {actions(model)}
        </div>
      )}
    />
  );
}
