import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Button,
  Card,
  CardContent,
  FinancialReviewSummary,
  Input,
  Label,
  ListPage,
} from '@barghsa/ui';
import {
  parseElectricityPriceAdjustmentReview,
  type ElectricityPriceAdjustmentCalculation,
  type ElectricityPriceAdjustmentReview,
} from '@barghsa/shared/finance';
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
  calculation: ElectricityPriceAdjustmentCalculation;
}
interface StaffPriceState {
  contractId: string;
  profileId: string;
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

function bpsToPercent(value: string, locale: 'en' | 'fa') {
  const signed = BigInt(value);
  const absolute = signed < 0n ? -signed : signed;
  const whole = new Intl.NumberFormat(locale).format(absolute / 100n);
  const fraction = absolute % 100n;
  const decimals = fraction
    ? `${locale === 'fa' ? '٫' : '.'}${new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false }).format(fraction)}`
    : '';
  return `${signed < 0n ? '-' : ''}${whole}${decimals}%`;
}

export default function AdminElectricityPriceAdjustmentsPage() {
  const locale = useLocale();
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const initialContractId =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('contractId') ?? '');
  const [contractInput, setContractInput] = useState(initialContractId);
  const [contractId, setContractId] = useState<string | null>(initialContractId || null);
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
            dir="ltr"
            value={contractInput}
            onChange={(event) => setContractInput(event.target.value)}
            required
          />
        </div>
        <Button type="submit">{copy('open')}</Button>
      </form>
      {contractId ? <PriceWorkspace key={contractId} contractId={contractId} /> : null}
    </section>
  );
}

function PriceWorkspace({ contractId }: { contractId: string }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const [data, setData] = useState<StaffPriceState | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [percentage, setPercentage] = useState('');
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<'load' | 'forbidden' | null>(null);
  const accessDenied = useRef(false);
  const reviewGeneration = useRef(0);
  const acceptedData = useRef<StaffPriceState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'load' | 'save' | 'reviewError' | 'forbidden' | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<ElectricityPriceAdjustmentReview | null>(null);
  const [selectedAdjustment, setSelectedAdjustment] = useState<PriceAdjustment | null>(null);
  const [proposalKey, setProposalKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!contractId) return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    void fetch(
      `/api/staff/electricity/contracts/${encodeURIComponent(contractId)}/price-adjustments`,
      {
        credentials: 'include',
        signal: controller.signal,
      }
    )
      .then(async (response) => {
        if ([401, 403].includes(response.status)) throw new Error('forbidden');
        if (!response.ok) throw new Error('load');
        return response.json() as Promise<StaffPriceState>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.contractId !== contractId || !Array.isArray(value.adjustments))
          throw new Error('load');
        if (
          acceptedData.current &&
          JSON.stringify(acceptedData.current) !== JSON.stringify(value)
        ) {
          ++reviewGeneration.current;
          setReview(null);
          setSelectedAdjustment(null);
          setAction(null);
          setSaving(false);
          setProposalKey(crypto.randomUUID());
        }
        accessDenied.current = false;
        acceptedData.current = value;
        setData(value);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        const forbidden = caught instanceof Error && caught.message === 'forbidden';
        setLoadError(forbidden ? 'forbidden' : 'load');
        if (forbidden) deny();
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contractId, revision]);

  useEffect(
    () => () => {
      ++reviewGeneration.current;
    },
    []
  );
  function deny() {
    accessDenied.current = true;
    ++reviewGeneration.current;
    acceptedData.current = null;
    setData(null);
    setEffectiveFrom('');
    setPercentage('');
    setReason('');
    setBasis('');
    setReview(null);
    setSelectedAdjustment(null);
    setAction(null);
    setSaving(false);
    setProposalKey(crypto.randomUUID());
    setError(null);
    setLoadError('forbidden');
  }

  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percentageBps = percentToBps(percentage);
    if (
      !data ||
      !data.canPropose ||
      data.adjustments.some((item) => item.status === 'proposed') ||
      loading ||
      loadError ||
      accessDenied.current ||
      !percentageBps ||
      !effectiveFrom ||
      !reason.trim() ||
      !basis.trim() ||
      saving
    )
      return;
    const generation = ++reviewGeneration.current;
    setSaving(true);
    setError(null);
    try {
      const proposal = {
        expectedVersionId: data.versionId,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        percentageBps,
        reason: reason.trim(),
        contractualBasis: basis.trim(),
      };
      const response = await fetch(
        `/api/staff/electricity/contracts/${encodeURIComponent(data.contractId)}/price-adjustments/review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(proposal),
        }
      );
      if (generation !== reviewGeneration.current || accessDenied.current) return;
      if ([401, 403].includes(response.status)) {
        deny();
        return;
      }
      if (!response.ok) throw new Error('Review failed');
      const financialReview = parseElectricityPriceAdjustmentReview(await response.json());
      if (generation !== reviewGeneration.current || accessDenied.current) return;
      if (
        !financialReview ||
        financialReview.scope.resourceId !== data.contractId ||
        financialReview.scope.profileId !== data.profileId ||
        financialReview.data.calculation.versionId !== proposal.expectedVersionId ||
        financialReview.data.calculation.quote.effectiveFrom !== proposal.effectiveFrom ||
        financialReview.data.calculation.quote.percentageBps !== proposal.percentageBps ||
        financialReview.data.calculation.reason !== proposal.reason ||
        financialReview.data.calculation.contractualBasis !== proposal.contractualBasis
      )
        throw new Error('Review mismatch');
      setReview(financialReview);
      setSelectedAdjustment(null);
      setAction({
        title: copy('publish'),
        description: copy('publishConfirm'),
        path: `/api/staff/electricity/contracts/${encodeURIComponent(data.contractId)}/price-adjustments`,
        method: 'POST',
        body: {
          ...proposal,
          expectedReviewHash: financialReview.hash,
          idempotencyKey: proposalKey,
        },
        conflictMessage: copy('conflict'),
        forbiddenMessage: copy('forbidden'),
      });
    } catch {
      if (generation === reviewGeneration.current) setError('reviewError');
    } finally {
      if (generation === reviewGeneration.current) setSaving(false);
    }
  }

  function confirm(adjustment: PriceAdjustment, operation: 'finalize' | 'cancel') {
    if (
      !data ||
      loading ||
      loadError ||
      accessDenied.current ||
      adjustment.status !== 'proposed' ||
      !(operation === 'finalize' ? data.canFinalize : data.canCancel)
    )
      return;
    ++reviewGeneration.current;
    setSaving(false);
    setReview(null);
    setSelectedAdjustment(adjustment);
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

  const confirmationGeneration = reviewGeneration.current;
  const proposed =
    data?.adjustments.some((adjustment) => adjustment.status === 'proposed') ?? false;
  return (
    <ListPage role="region" aria-label={copy('listTitle')}>
      <ListPage.Toolbar>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {copy('refresh')}
        </Button>
      </ListPage.Toolbar>
      {loadError ? (
        <div role="alert" className="space-y-2">
          <p>{copy(loadError)}</p>
          {loadError !== 'forbidden' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setRevision((value) => value + 1)}
            >
              {copy('retry')}
            </Button>
          )}
        </div>
      ) : null}
      {loading ? <p role="status">{copy('loading')}</p> : null}
      {error ? <p role="alert">{copy(error)}</p> : null}
      {data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {copy('termEnds')}: {new Date(data.periodEnd).toLocaleString(locale)}
            </p>
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
                    <Button
                      type="submit"
                      disabled={saving || loading || !!loadError || !percentToBps(percentage)}
                    >
                      {copy('reviewProposal')}
                    </Button>
                    {saving ? <p role="status">{copy('reviewLoading')}</p> : null}
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : proposed ? (
            <p className="text-sm">{copy('resolveProposal')}</p>
          ) : null}
          <ListPage.Content
            loading={loading}
            error={!!loadError}
            empty={!data.adjustments.length}
            retainContent={!!data.adjustments.length}
            emptyView={<p>{copy('empty')}</p>}
            loadingView={null}
            errorView={null}
          >
            <div className="space-y-3">
              {data.adjustments.map((adjustment) => (
                <Card key={adjustment.adjustmentId}>
                  <CardContent className="space-y-3 pt-6 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold">{copy('adjustment')}</h2>
                      <span>{copy(`status.${adjustment.status}`)}</span>
                    </div>
                    <p>
                      {copy('effective')}:{' '}
                      {new Date(adjustment.effectiveFrom).toLocaleString(locale)}
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
                        <a
                          className="text-primary underline"
                          href={`/admin/invoices?invoiceId=${encodeURIComponent(adjustment.adjustmentInvoiceId)}`}
                        >
                          <bdi dir="ltr" className="break-all">
                            {adjustment.adjustmentInvoiceId}
                          </bdi>
                        </a>
                      </p>
                    ) : null}
                    {adjustment.status === 'proposed' ? (
                      <div className="flex flex-wrap gap-2">
                        {data.canFinalize ? (
                          <Button
                            disabled={loading || !!loadError}
                            onClick={() => confirm(adjustment, 'finalize')}
                          >
                            {copy('finalize')}
                          </Button>
                        ) : (
                          <p>{copy('finalizePermission')}</p>
                        )}
                        {data.canCancel ? (
                          <Button
                            variant="outline"
                            disabled={loading || !!loadError}
                            onClick={() => confirm(adjustment, 'cancel')}
                          >
                            {copy('cancel')}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ListPage.Content>
        </div>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            review ? (
              <PriceAdjustmentFinancialReview
                calculation={review.data.calculation}
                profileId={review.data.profileId}
                periodStart={review.data.periodStart}
                periodEnd={review.data.periodEnd}
                locale={locale}
              />
            ) : selectedAdjustment && data ? (
              <PriceAdjustmentFinancialReview
                calculation={selectedAdjustment.calculation}
                profileId={data.profileId}
                periodEnd={data.periodEnd}
                locale={locale}
              />
            ) : null
          }
          onClose={() => {
            if (confirmationGeneration !== reviewGeneration.current) return;
            ++reviewGeneration.current;
            setAction(null);
            setReview(null);
            setSelectedAdjustment(null);
          }}
          onSuccess={async () => {
            if (accessDenied.current || confirmationGeneration !== reviewGeneration.current) return;
            ++reviewGeneration.current;
            if (review) {
              setProposalKey(crypto.randomUUID());
              setReason('');
              setBasis('');
              setPercentage('');
              setEffectiveFrom('');
            }
            setAction(null);
            setReview(null);
            setSelectedAdjustment(null);
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </ListPage>
  );
}

function PriceAdjustmentFinancialReview({
  calculation,
  profileId,
  periodStart,
  periodEnd,
  locale,
}: {
  calculation: ElectricityPriceAdjustmentCalculation;
  profileId: string;
  periodStart?: string;
  periodEnd: string;
  locale: 'en' | 'fa';
}) {
  const copy = (key: string) => t(`admin.electricityPrice.${key}`, locale);
  const money = (value: string) => `${new Intl.NumberFormat(locale).format(BigInt(value))} IRR`;
  const { quote } = calculation;
  return (
    <FinancialReviewSummary
      title={copy('reviewTitle')}
      rows={[
        { id: 'contract', label: copy('contractId'), value: calculation.contractId },
        { id: 'profile', label: copy('profileId'), value: profileId },
        { id: 'invoice', label: copy('originalInvoice'), value: calculation.originalInvoiceId },
        { id: 'version', label: copy('versionId'), value: calculation.versionId },
        ...(periodStart
          ? [
              {
                id: 'start',
                label: copy('termStarts'),
                value: new Date(periodStart).toLocaleString(locale),
              },
            ]
          : []),
        { id: 'end', label: copy('termEnds'), value: new Date(periodEnd).toLocaleString(locale) },
        {
          id: 'effective',
          label: copy('effective'),
          value: new Date(quote.effectiveFrom).toLocaleString(locale),
        },
        {
          id: 'percentage',
          label: copy('percentage'),
          value: bpsToPercent(quote.percentageBps, locale),
        },
        { id: 'old', label: copy('oldFuture'), value: money(quote.oldFutureIrR) },
        { id: 'new', label: copy('newFuture'), value: money(quote.newFutureIrR) },
        ...quote.components.map((component, index) => ({
          id: `component-${index}`,
          label: `${copy('basisComponent')} ${index + 1} · ${component.invoiceId}`,
          value: `${money(component.basisIrR)} → ${money(component.changeIrR)}`,
        })),
      ]}
      total={{ label: copy('amount'), value: money(quote.amountIrR) }}
      notice={`${copy('reason')}: ${calculation.reason} · ${copy('basis')}: ${calculation.contractualBasis}`}
    />
  );
}
