import { useEffect, useState, type FormEvent } from 'react';
import { FinancialReviewSummary } from '@barghsa/ui';
import { tSolar } from '@barghsa/i18n/solar';
import { contractText } from '@barghsa/i18n/contracts';
import { formatCurrencyIrr } from '@barghsa/i18n/numbers';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

interface Options {
  templates: Array<{ version_id: string; name: string; version_number: number }>;
  documents: Array<{ id: string; original_name: string }>;
}
interface Line {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
  isTaxable: boolean;
}
interface SolarContractReview {
  hash: string;
  data: {
    title: string;
    text: string;
    changeDescription: string;
    commercialValue:
      { kind: 'fixed'; amountIrr: string } | { kind: 'variable'; description: string };
    source: { kind: string; label: string; versionNumber: number | null };
    invoiceLines: Array<{
      description: string;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      vatAmount: string;
    }>;
    totals: { subtotal: string; vat: string; total: string };
    dueRule: { configDays: number | null };
  };
}
const emptyLine = (): Line => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  vatRate: '0',
  isTaxable: false,
});

export function SolarContractForm({
  requestId,
  profileId,
  onCreated,
}: {
  requestId: string;
  profileId: string;
  onCreated: (contractId: string) => void;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const contractCopy = (key: string) => contractText(key, locale);
  const [options, setOptions] = useState<Options | null>(null);
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [changeDescription, setChangeDescription] = useState('');
  const [valueKind, setValueKind] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [variableDescription, setVariableDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<SolarContractReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/solar/requests/${encodeURIComponent(requestId)}/contract-options`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('options');
        return response.json() as Promise<Options>;
      })
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [requestId]);
  function updateLine(index: number, next: Partial<Line>) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...next } : line))
    );
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (event.target !== event.currentTarget || reviewing) return;
    const [kind, id] = source.split(':');
    const validLines = lines.every(
      (line) =>
        line.description.trim() &&
        /^\d{1,19}$/.test(line.unitPrice) &&
        Number.isInteger(Number(line.quantity)) &&
        Number(line.quantity) > 0 &&
        Number.isInteger(Number(line.vatRate)) &&
        Number(line.vatRate) >= 0 &&
        Number(line.vatRate) <= 10_000
    );
    const validValue =
      valueKind === 'fixed'
        ? /^(0|[1-9][0-9]{0,18})$/.test(fixedAmount) &&
          BigInt(fixedAmount) <= 9_223_372_036_854_775_807n
        : valueKind === 'variable' &&
          variableDescription.trim().length > 0 &&
          variableDescription.trim().length <= 500;
    if (
      !id ||
      !['template', 'document'].includes(kind!) ||
      !title.trim() ||
      !text.trim() ||
      !changeDescription.trim() ||
      !validValue ||
      !validLines
    ) {
      setError(true);
      return;
    }
    setError(false);
    setReviewing(true);
    const body = {
      profileId,
      idempotencyKey: crypto.randomUUID(),
      title: title.trim(),
      text: text.trim(),
      changeDescription: changeDescription.trim(),
      commercialValue:
        valueKind === 'fixed'
          ? { kind: 'fixed', amountIrr: fixedAmount }
          : { kind: 'variable', description: variableDescription.trim() },
      source:
        kind === 'template'
          ? { kind: 'template', templateVersionId: id }
          : { kind: 'document', documentId: id },
      invoiceLines: lines.map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPrice: line.unitPrice,
        vatRate: Number(line.vatRate),
        isTaxable: line.isTaxable,
      })),
    };
    const path = `/api/admin/solar/requests/${encodeURIComponent(requestId)}/create-contract`;
    try {
      const response = await fetch(`${path}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('review');
      const snapshot = (await response.json()) as SolarContractReview;
      setReview(snapshot);
      setAction({
        title: copy('solarCreateContract'),
        description: title.trim(),
        path,
        method: 'POST',
        body: { ...body, expectedReviewHash: snapshot.hash },
      });
    } catch {
      setError(true);
    } finally {
      setReviewing(false);
    }
  }
  return (
    <form className="space-y-3 rounded-md border p-4" onSubmit={submit}>
      <h3 className="font-semibold">{copy('solarCreateContract')}</h3>
      {!options && !error && <p role="status">{copy('loading')}</p>}
      {options && (
        <label className="block">
          {copy('solarContractSource')}
          <select
            required
            className="mt-1 w-full rounded-md border p-2"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">{copy('solarSelectSource')}</option>
            {options.templates.map((item) => (
              <option key={item.version_id} value={`template:${item.version_id}`}>
                {item.name} · v{item.version_number}
              </option>
            ))}
            {options.documents.map((item) => (
              <option key={item.id} value={`document:${item.id}`}>
                {item.original_name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        {copy('solarContractTitle')}
        <input
          required
          maxLength={200}
          className="mt-1 w-full rounded-md border p-2"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="block">
        {copy('solarContractText')}
        <textarea
          required
          maxLength={60000}
          rows={8}
          className="mt-1 w-full rounded-md border p-2"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="block">
        {copy('solarContractReason')}
        <input
          required
          maxLength={1000}
          className="mt-1 w-full rounded-md border p-2"
          value={changeDescription}
          onChange={(event) => setChangeDescription(event.target.value)}
        />
      </label>
      <p className="text-sm text-muted-foreground">{contractCopy('commercialValueNotice')}</p>
      <label className="block">
        {contractCopy('statedContractValue')}
        <select
          required
          className="mt-1 w-full rounded-md border p-2"
          value={valueKind}
          onChange={(event) => setValueKind(event.target.value)}
        >
          <option value="">{copy('solarSelectContractValue')}</option>
          <option value="fixed">{contractCopy('fixedContractValue')}</option>
          <option value="variable">{contractCopy('variableContractValue')}</option>
        </select>
      </label>
      {valueKind === 'fixed' ? (
        <label className="block">
          {contractCopy('fixedContractAmount')}
          <input
            required
            inputMode="numeric"
            dir="ltr"
            pattern="(0|[1-9][0-9]*)"
            className="mt-1 w-full rounded-md border p-2"
            value={fixedAmount}
            onChange={(event) => setFixedAmount(event.target.value.trim())}
          />
        </label>
      ) : null}
      {valueKind === 'variable' ? (
        <label className="block">
          {contractCopy('variableContractDescription')}
          <textarea
            required
            maxLength={500}
            className="mt-1 w-full rounded-md border p-2"
            value={variableDescription}
            onChange={(event) => setVariableDescription(event.target.value)}
          />
        </label>
      ) : null}
      <h4 className="font-medium">{copy('solarInvoiceLines')}</h4>
      {lines.map((line, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
          <label>
            {copy('solarInvoiceDescription')}
            <input
              required
              className="mt-1 w-full rounded-md border p-2"
              maxLength={1000}
              value={line.description}
              onChange={(event) => updateLine(index, { description: event.target.value })}
            />
          </label>
          <label>
            {copy('solarInvoiceQuantity')}
            <input
              required
              type="number"
              min="1"
              max="2147483647"
              className="mt-1 w-full rounded-md border p-2"
              value={line.quantity}
              onChange={(event) => updateLine(index, { quantity: event.target.value })}
            />
          </label>
          <label>
            {copy('solarInvoicePrice')}
            <input
              required
              inputMode="numeric"
              dir="ltr"
              pattern="[0-9]+"
              className="mt-1 w-full rounded-md border p-2"
              value={line.unitPrice}
              onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
            />
          </label>
          <label>
            {copy('solarInvoiceVat')}
            <input
              required
              type="number"
              min="0"
              max="10000"
              className="mt-1 w-full rounded-md border p-2"
              value={line.vatRate}
              onChange={(event) => updateLine(index, { vatRate: event.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={line.isTaxable}
              onChange={(event) => updateLine(index, { isTaxable: event.target.checked })}
            />
            {copy('solarInvoiceTaxable')}
          </label>
          {lines.length > 1 && (
            <button
              type="button"
              className="underline"
              onClick={() =>
                setLines((current) => current.filter((_, position) => position !== index))
              }
            >
              {copy('solarRemoveLine')}
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="underline"
        onClick={() =>
          setLines((current) => (current.length < 100 ? [...current, emptyLine()] : current))
        }
      >
        {copy('solarAddLine')}
      </button>
      {error && <p role="alert">{copy('solarContractError')}</p>}
      <div>
        <button
          type="submit"
          disabled={reviewing}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          {copy(reviewing ? 'loading' : 'solarCreateContract')}
        </button>
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            review && (
              <FinancialReviewSummary
                title={copy('solarContractReviewTitle')}
                rows={[
                  {
                    id: 'source',
                    label: copy('solarContractSource'),
                    value: `${review.data.source.label}${review.data.source.versionNumber ? ` · v${review.data.source.versionNumber}` : ''}`,
                  },
                  { id: 'title', label: copy('solarContractTitle'), value: review.data.title },
                  {
                    id: 'reason',
                    label: copy('solarContractReason'),
                    value: review.data.changeDescription,
                  },
                  {
                    id: 'commercial',
                    label: contractCopy('statedContractValue'),
                    value:
                      review.data.commercialValue.kind === 'fixed'
                        ? formatCurrencyIrr(review.data.commercialValue.amountIrr, locale)
                        : review.data.commercialValue.description,
                  },
                  ...review.data.invoiceLines.map((line, index) => ({
                    id: `line-${index}`,
                    label: `${line.description} · ${line.quantity} × ${formatCurrencyIrr(line.unitPrice, locale)}`,
                    value: formatCurrencyIrr(line.lineTotal, locale),
                  })),
                  {
                    id: 'vat',
                    label: copy('solarReviewVat'),
                    value: formatCurrencyIrr(review.data.totals.vat, locale),
                  },
                  {
                    id: 'due',
                    label: copy('solarReviewDue'),
                    value:
                      review.data.dueRule.configDays === null
                        ? '—'
                        : `${review.data.dueRule.configDays} ${copy('solarReviewDaysAfterIssue')}`,
                  },
                ]}
                total={{
                  label: copy('solarReviewInvoiceTotal'),
                  value: formatCurrencyIrr(review.data.totals.total, locale),
                }}
                notice={
                  <>
                    <p>{copy('solarReviewOutcome')}</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer">{copy('solarContractText')}</summary>
                      <p className="mt-2 whitespace-pre-wrap break-words">{review.data.text}</p>
                    </details>
                  </>
                }
              />
            )
          }
          onClose={() => {
            setAction(null);
            setReview(null);
          }}
          onSuccess={async (result) => {
            const created = result as { contractId?: string };
            if (!created.contractId) throw new Error('Missing contract');
            onCreated(created.contractId);
          }}
        />
      )}
    </form>
  );
}
