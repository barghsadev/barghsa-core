import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Card, CardContent, Input, Label } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';

interface PriceAdjustment {
  adjustmentId: string;
  status: 'proposed' | 'finalized' | 'cancelled';
  effectiveFrom: string;
  percentageBps: string;
  reason: string;
  contractualBasis: string;
  adjustmentAmountIrR: string;
  calculationSha256: string;
  adjustmentInvoiceId: string | null;
  calculation: { quote: { oldFutureIrR: string; newFutureIrR: string } };
}
interface StaffPriceState {
  contractId: string;
  versionId: string;
  periodEnd: string;
  canPropose: boolean;
  canCancel: boolean;
  canFinalize: boolean;
  blockedByIncrease: boolean;
  adjustments: PriceAdjustment[];
}

export function percentToBps(value: string): string | null {
  const match = /^(-?)(\d{1,16})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const absolute = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  const signed = match[1] === '-' ? -absolute : absolute;
  if (signed === 0n || signed <= -10_000n || signed > 9_223_372_036_854_775_807n) return null;
  return signed.toString();
}

export default function AdminElectricityPriceAdjustmentsPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const initialContractId =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('contractId') ?? '');
  const [contractInput, setContractInput] = useState(initialContractId);
  const [contractId, setContractId] = useState<string | null>(initialContractId || null);
  const [data, setData] = useState<StaffPriceState | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [percentage, setPercentage] = useState('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'forbidden' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [proposalKey, setProposalKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!contractId) return;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    void fetch(
      `/api/staff/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`,
      {
        credentials: 'include',
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        if (response.status === 403) throw new Error('forbidden');
        if (!response.ok) throw new Error('load');
        return response.json() as Promise<StaffPriceState>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error && caught.message === 'forbidden' ? 'forbidden' : 'load'
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contractId, revision]);

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percentageBps = percentToBps(percentage);
    if (!data || !percentageBps || !effectiveFrom || !reason.trim() || !basis.trim() || saving)
      return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/staff/electricity/contracts/${encodeURIComponent(data.contractId)}/price-adjustments`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            expectedVersionId: data.versionId,
            effectiveFrom: new Date(effectiveFrom).toISOString(),
            percentageBps,
            reason: reason.trim(),
            contractualBasis: basis.trim(),
            idempotencyKey: proposalKey,
          }),
        }
      );
      if (response.status === 403) {
        setError('forbidden');
        return;
      }
      if (!response.ok) throw new Error('Proposal failed');
      setProposalKey(crypto.randomUUID());
      setReason('');
      setBasis('');
      setPercentage('');
      setEffectiveFrom('');
      setRevision((value) => value + 1);
    } catch {
      setError('save');
    } finally {
      setSaving(false);
    }
  }

  function confirm(adjustment: PriceAdjustment, operation: 'finalize' | 'cancel') {
    setAction({
      title: copy(operation),
      description: copy(`${operation}Confirm`),
      path: `/api/staff/electricity/price-adjustments/${encodeURIComponent(adjustment.adjustmentId)}/${operation}`,
      method: 'POST',
      body: {
        idempotencyKey: crypto.randomUUID(),
        ...(operation === 'finalize'
          ? { expectedCalculationSha256: adjustment.calculationSha256 }
          : {}),
      },
      conflictMessage: copy('conflict'),
      forbiddenMessage: copy('forbidden'),
    });
  }

  const proposed =
    data?.adjustments.some((adjustment) => adjustment.status === 'proposed') ?? false;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{copy('title')}</h1>
        <p className="text-muted-foreground">{copy('description')}</p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setContractId(contractInput.trim());
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="electricity-price-contract">{copy('contractId')}</Label>
          <Input
            id="electricity-price-contract"
            value={contractInput}
            onChange={(event) => setContractInput(event.target.value)}
            required
          />
        </div>
        <Button type="submit">{copy('open')}</Button>
      </form>
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {error ? <p role="alert">{copy(error)}</p> : null}
      {data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {copy('termEnds')}: {new Date(data.periodEnd).toLocaleString(locale)}
            </p>
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              {copy('refresh')}
            </Button>
          </div>
          {!data.canPropose && !proposed ? (
            <p role="status">{copy(data.blockedByIncrease ? 'waitForIncrease' : 'notEligible')}</p>
          ) : null}
          {data.canPropose && !proposed ? (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <h2 className="font-semibold">{copy('newProposal')}</h2>
                <form
                  className="grid gap-4 sm:grid-cols-2"
                  onSubmit={(event) => void propose(event)}
                >
                  <div className="space-y-1">
                    <Label htmlFor="price-percent">{copy('percentage')}</Label>
                    <Input
                      id="price-percent"
                      inputMode="decimal"
                      value={percentage}
                      onChange={(event) => setPercentage(event.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">{copy('percentageHelp')}</p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="price-effective">{copy('effective')}</Label>
                    <Input
                      id="price-effective"
                      type="datetime-local"
                      value={effectiveFrom}
                      onChange={(event) => setEffectiveFrom(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="price-reason">{copy('reason')}</Label>
                    <Input
                      id="price-reason"
                      value={reason}
                      maxLength={1000}
                      onChange={(event) => setReason(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="price-basis">{copy('basis')}</Label>
                    <Input
                      id="price-basis"
                      value={basis}
                      maxLength={2000}
                      onChange={(event) => setBasis(event.target.value)}
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={saving || !percentToBps(percentage)}>
                      {copy('publish')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : proposed ? (
            <p className="text-sm">{copy('resolveProposal')}</p>
          ) : null}
          <div className="space-y-3">
            {data.adjustments.map((adjustment) => (
              <Card key={adjustment.adjustmentId}>
                <CardContent className="space-y-3 pt-6 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">{copy('adjustment')}</h2>
                    <span>{copy(`status.${adjustment.status}`)}</span>
                  </div>
                  <p>
                    {copy('effective')}: {new Date(adjustment.effectiveFrom).toLocaleString(locale)}
                  </p>
                  <p>
                    {copy('reason')}: {adjustment.reason}
                  </p>
                  <p>
                    {copy('basis')}: {adjustment.contractualBasis}
                  </p>
                  <p>
                    {copy('oldFuture')}:{' '}
                    {numbers.irrDigits(adjustment.calculation.quote.oldFutureIrR)} IRR
                  </p>
                  <p>
                    {copy('newFuture')}:{' '}
                    {numbers.irrDigits(adjustment.calculation.quote.newFutureIrR)} IRR
                  </p>
                  <p>
                    {copy('amount')}: {numbers.irrDigits(adjustment.adjustmentAmountIrR)} IRR
                  </p>
                  {adjustment.adjustmentInvoiceId ? (
                    <p>
                      {copy('invoice')}:{' '}
                      <a className="text-primary underline" href="/admin/invoices">
                        {adjustment.adjustmentInvoiceId}
                      </a>
                    </p>
                  ) : null}
                  {adjustment.status === 'proposed' ? (
                    <div className="flex flex-wrap gap-2">
                      {data.canFinalize ? (
                        <Button onClick={() => confirm(adjustment, 'finalize')}>
                          {copy('finalize')}
                        </Button>
                      ) : (
                        <p>{copy('finalizePermission')}</p>
                      )}
                      {data.canCancel ? (
                        <Button variant="outline" onClick={() => confirm(adjustment, 'cancel')}>
                          {copy('cancel')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
