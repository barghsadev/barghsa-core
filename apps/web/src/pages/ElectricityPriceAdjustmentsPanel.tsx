import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useServerListQuery } from '../hooks/useServerQuery.js';
import { useEffect, useId, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/app';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { Button, Card, CardContent } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  parseElectricityPriceAdjustmentRow,
  type ElectricityPriceAdjustmentRow,
} from '../lib/electricity-price-adjustment-row.js';

export function ElectricityPriceAdjustmentsPanel({
  contractId,
  profileId,
  versionId,
  formatTimestamp,
}: {
  contractId: string;
  profileId: string;
  versionId: string | null;
  formatTimestamp?: (value: string) => string;
}) {
  const locale = useLocale();
  const timestamp =
    formatTimestamp ?? ((value: string) => formatInTimezone(value, 'Asia/Tehran', locale));
  const numbers = useNumberFormatting(locale);
  function percentage(basisPoints: string) {
    const value = BigInt(basisPoints);
    const whole = numbers.number(value / 100n);
    const remainder = value % 100n;
    if (remainder === 0n) return whole;
    const fraction = numbers
      .number(Number(remainder < 0n ? -remainder : remainder) / 100, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      })
      .slice(numbers.number(0).length);
    const sign =
      value < 0n && value > -100n ? numbers.number(-1).replace(numbers.number(1), '') : '';
    return `${sign}${whole}${fraction}`;
  }
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const scopeKey = JSON.stringify([actor, profileRevision, profileId, contractId, versionId]);
  const reader = useId();
  const client = useQueryClient();
  const readOwner = useRef({ scopeKey, epoch: 0 });
  if (readOwner.current.scopeKey !== scopeKey)
    readOwner.current = { scopeKey, epoch: readOwner.current.epoch + 1 };
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  const pending = useRef(false);
  if (scope.current !== scopeKey) {
    scope.current = scopeKey;
    ++generation.current;
  }
  const [loadedAdjustments, setAdjustments] = useState<ElectricityPriceAdjustmentRow[]>([]);
  const [acceptedScope, setAcceptedScope] = useState<string | null>(null);
  const adjustments = acceptedScope === scopeKey ? loadedAdjustments : [];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const copy = (key: string) => t(`electricity.priceAdjustment.${key}`, locale);
  function reload() {
    if (scope.current !== scopeKey || pending.current) return;
    ++generation.current;
    pending.current = true;
    setLoading(true);
    setRevision((value) => value + 1);
  }

  const queryKey = queryKeys.contracts.list(
    {
      context: 'customer',
      ownerId: profileId.trim() ? profileId : reader,
      accountId: actor,
      revision: profileRevision,
    },
    new URLSearchParams({
      reader,
      kind: 'price-adjustments',
      contractId,
      versionId: versionId ?? '',
      epoch: String(readOwner.current.epoch),
    }),
    revision
  );
  const query = useServerListQuery<{ status: number; value: unknown }>({
    queryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(
        `/api/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`,
        { credentials: 'include', signal }
      );
      if ([401, 403, 404].includes(response.status))
        return { status: response.status, value: null };
      if (!response.ok) throw new Error('Price history unavailable');
      return { status: response.status, value: (await response.json()) as unknown };
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    const token = generation.current;
    const current = () => !controller.signal.aborted && token === generation.current;
    pending.current = true;
    setLoading(true);
    setError(false);
    void query
      .refetch()
      .then((reply) => {
        if (!current()) return null;
        if (!reply.isSuccess || !reply.data) throw new Error('Price history unavailable');
        if ([401, 403, 404].includes(reply.data.status)) {
          setAdjustments([]);
          setAcceptedScope(null);
          setError(true);
          return null;
        }
        const result: unknown = reply.data.value;
        if (
          !result ||
          typeof result !== 'object' ||
          !('adjustments' in result) ||
          !Array.isArray(result.adjustments)
        )
          throw new Error('Invalid price history');
        const rows = result.adjustments.map(parseElectricityPriceAdjustmentRow);
        if (
          rows.some((row) => !row || row.contractId !== contractId) ||
          new Set(rows.map((row) => row?.adjustmentId)).size !== rows.length
        )
          throw new Error('Invalid price history');
        return rows.filter((row): row is ElectricityPriceAdjustmentRow => row !== null);
      })
      .then((result) => {
        if (result && current()) {
          setAdjustments(result);
          setAcceptedScope(scopeKey);
        }
      })
      .catch(() => {
        if (current()) setError(true);
      })
      .finally(() => {
        if (current()) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey, exact: true });
      if (token === generation.current) ++generation.current;
    };
  }, [scopeKey, contractId, revision]);

  if (!loading && !error && adjustments.length === 0) return null;
  return (
    <Card data-testid="electricity-price-history">
      <CardContent className="space-y-4 pt-6 text-sm">
        <h2 className="font-semibold">{copy('title')}</h2>
        {loading ? <p role="status">{copy('loading')}</p> : null}
        {error ? (
          <div role="alert" className="flex items-center gap-3">
            <span>{copy('error')}</span>
            <Button
              data-testid="electricity-price-history-retry"
              variant="outline"
              disabled={loading}
              onClick={reload}
            >
              {copy('retry')}
            </Button>
          </div>
        ) : null}
        {adjustments.map((adjustment) => {
          const credit = BigInt(adjustment.adjustmentAmountIrR) < 0n;
          const amount = credit
            ? (-BigInt(adjustment.adjustmentAmountIrR)).toString()
            : adjustment.adjustmentAmountIrR;
          return (
            <section key={adjustment.adjustmentId} className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium">{copy(credit ? 'credit' : 'charge')}</h3>
                <span className="rounded-full bg-muted px-3 py-1 text-xs">
                  {copy(`status.${adjustment.status}`)}
                </span>
              </div>
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{copy('reason')}</dt>
                  <dd>{adjustment.reason}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('basis')}</dt>
                  <dd>{adjustment.contractualBasis}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('effective')}</dt>
                  <dd>{timestamp(adjustment.effectiveFrom)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('percentage')}</dt>
                  <dd>{percentage(adjustment.percentageBps)}%</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('oldFuture')}</dt>
                  <dd>{numbers.irrDigits(adjustment.calculation.quote.oldFutureIrR)} IRR</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('newFuture')}</dt>
                  <dd>{numbers.irrDigits(adjustment.calculation.quote.newFutureIrR)} IRR</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    {copy(credit ? 'creditAmount' : 'amount')}
                  </dt>
                  <dd>{numbers.irrDigits(amount)} IRR</dd>
                </div>
              </dl>
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer font-medium">{copy('calculation')}</summary>
                <ul className="mt-2 space-y-2">
                  {adjustment.calculation.quote.components.map((component) => (
                    <li key={component.invoiceId} className="border-t pt-2">
                      <strong>{copy(`source.${component.source}`)}</strong>
                      <p>
                        {copy('baseValue')}: {numbers.irrDigits(component.basisIrR)} IRR
                      </p>
                      <p>
                        {copy('componentStart')}: {timestamp(component.eligibleFrom)}
                      </p>
                      <p>
                        {copy('componentChange')}: {numbers.irrDigits(component.oldFutureIrR)} IRR
                        {' → '}
                        {numbers.irrDigits(component.changeIrR)} IRR
                      </p>
                    </li>
                  ))}
                </ul>
              </details>
              {adjustment.status === 'proposed' ? <p>{copy('beforeFinalization')}</p> : null}
              {adjustment.adjustmentInvoiceId ? (
                <a
                  className="text-primary underline"
                  href={`/invoices/${encodeURIComponent(adjustment.adjustmentInvoiceId)}`}
                >
                  {copy(credit ? 'viewCredit' : 'viewInvoice')}
                </a>
              ) : null}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
