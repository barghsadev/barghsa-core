import { useEffect, useState, type FormEvent } from 'react';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';
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
  const [options, setOptions] = useState<Options | null>(null);
  const [source, setSource] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [changeDescription, setChangeDescription] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [action, setAction] = useState<TeamAction | null>(null);
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
  function submit(event: FormEvent) {
    event.preventDefault();
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
    if (
      !id ||
      !['template', 'document'].includes(kind!) ||
      !title.trim() ||
      !text.trim() ||
      !changeDescription.trim() ||
      !validLines
    ) {
      setError(true);
      return;
    }
    setError(false);
    setAction({
      title: copy('solarCreateContract'),
      description: title.trim(),
      path: `/api/admin/solar/requests/${encodeURIComponent(requestId)}/create-contract`,
      method: 'POST',
      body: {
        profileId,
        idempotencyKey: crypto.randomUUID(),
        title: title.trim(),
        text: text.trim(),
        changeDescription: changeDescription.trim(),
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
      },
    });
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
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {copy('solarCreateContract')}
        </button>
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
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
