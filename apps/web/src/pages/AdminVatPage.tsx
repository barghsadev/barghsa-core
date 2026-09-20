import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, DatePicker, datePickerAtTime, Input, Label } from '@barghsa/ui';
import { tVat } from '@barghsa/i18n/vat';
import {
  CHARGE_CATEGORIES,
  PRODUCT_OVERRIDE_CATEGORY,
  vatWindowStatus,
  type VatConfigDto,
  type VatProductOverrideDto,
} from '@barghsa/shared/finance';
import { useTimezone } from '../hooks/useTimezone.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
type Product = { id: string; title: Record<string, string>; type: string };
type Editor =
  | { kind: 'rate' }
  | { kind: 'override' }
  | { kind: 'endRate' | 'endOverride'; id: string; title: string };
const categories = [...CHARGE_CATEGORIES, PRODUCT_OVERRIDE_CATEGORY];
export default function AdminVatPage() {
  const preference = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tVat(`admin.vat.${key}`, locale);
  const [rates, setRates] = useState<VatConfigDto[]>([]),
    [overrides, setOverrides] = useState<VatProductOverrideDto[]>([]),
    [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading'),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<Editor | null>(null);
  const [category, setCategory] = useState<string>('electricity'),
    [percent, setPercent] = useState('0'),
    [productId, setProductId] = useState(''),
    [rateId, setRateId] = useState('');
  const [scheduled, setScheduled] = useState(false),
    [date, setDate] = useState<Date | undefined>(),
    [time, setTime] = useState('00:00'),
    [invalidDate, setInvalidDate] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null),
    [saved, setSaved] = useState(false);
  const zone = preference.timezone;
  const productTitle = (id: string) => {
    const product = products.find((row) => row.id === id);
    return product?.title[locale] || product?.title.en || product?.title.fa || label('product');
  };
  const dateText = (value: string) => new Date(value).toLocaleString(locale, { timeZone: zone });
  function overrideStatus(row: VatProductOverrideDto) {
    const rate = rates.find((value) => value.id === row.vatConfigId);
    if (!rate) return 'expired';
    const from = Math.max(Date.parse(row.effectiveFrom), Date.parse(rate.effectiveFrom));
    const until = Math.min(
      row.effectiveUntil ? Date.parse(row.effectiveUntil) : Infinity,
      rate.effectiveUntil ? Date.parse(rate.effectiveUntil) : Infinity
    );
    if (until <= from) return 'expired';
    return vatWindowStatus(
      new Date(from).toISOString(),
      Number.isFinite(until) ? new Date(until).toISOString() : null
    );
  }
  useEffect(() => {
    const abort = new AbortController();
    setState('loading');
    setRates([]);
    setOverrides([]);
    setProducts([]);
    setEditor(null);
    void (async () => {
      try {
        const responses = await Promise.all(
          ['', '/overrides', '/products'].map((path) =>
            fetch(`/api/admin/finance/vat${path}`, { signal: abort.signal })
          )
        );
        if (responses.some((response) => response.status === 403)) {
          if (!abort.signal.aborted) setState('denied');
          return;
        }
        if (responses.some((response) => !response.ok)) throw new Error('Load failed');
        const data = await Promise.all(responses.map((response) => response.json()));
        if (abort.signal.aborted) return;
        setRates(data[0] as VatConfigDto[]);
        setOverrides(data[1] as VatProductOverrideDto[]);
        setProducts(data[2] as Product[]);
        setState('ready');
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [revision]);
  function open(next: Editor) {
    setEditor(next);
    setScheduled(false);
    setDate(undefined);
    setTime('00:00');
    setInvalidDate(false);
    setPercent('0');
    setCategory('electricity');
    setProductId('');
    setRateId('');
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor || preference.status !== 'ready') return;
    let instant: string | undefined;
    if (scheduled) {
      const match = /^(\d{2}):(\d{2})$/.exec(time);
      if (!date || !match) {
        setInvalidDate(true);
        return;
      }
      const value = datePickerAtTime(date, Number(match[1]), Number(match[2]), zone);
      if (!value) {
        setInvalidDate(true);
        return;
      }
      instant = value.toISOString();
    }
    const ending = editor.kind === 'endRate' || editor.kind === 'endOverride';
    const path =
      editor.kind === 'rate'
        ? ''
        : editor.kind === 'override'
          ? '/overrides'
          : editor.kind === 'endRate'
            ? `/${editor.id}/end`
            : `/overrides/${editor.id}/end`;
    const body = ending
      ? { ...(instant ? { effectiveUntil: instant } : {}) }
      : editor.kind === 'rate'
        ? {
            category,
            rateBasisPoints: Math.round(Number(percent) * 100),
            ...(instant ? { effectiveFrom: instant } : {}),
          }
        : { productId, vatConfigId: rateId, ...(instant ? { effectiveFrom: instant } : {}) };
    setSaved(false);
    setAction({
      path: `/api/admin/finance/vat${path}`,
      method: 'POST',
      title: label(ending ? 'end' : 'save'),
      description: label(ending ? 'confirmEnd' : 'confirmSave'),
      body,
      forbiddenMessage: label('denied'),
      conflictMessage: label('conflict'),
      errorMessages: {
        'VALIDATION:PARSE:ZOD_ERROR': label('invalid'),
        VAT_RATE_INVALID: label('invalid'),
        VAT_RATE_INVALID_EFFECTIVE_FROM: label('invalidWindow'),
        VAT_RATE_INVALID_EFFECTIVE_UNTIL: label('invalidWindow'),
        VAT_OVERRIDE_INVALID_EFFECTIVE_FROM: label('invalidWindow'),
        VAT_OVERRIDE_INVALID_EFFECTIVE_UNTIL: label('invalidWindow'),
        VAT_OVERRIDE_CONFIG_INACTIVE: label('inactiveRate'),
        VAT_REFERENCE_MISSING: label('missing'),
      },
    });
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h1 className="text-2xl font-semibold">{label('title')}</h1>
      <p className="text-sm text-muted-foreground">{label('precedence')}</p>
      <p className="text-sm">
        {preference.status === 'ready' && (
          <>
            {label('timezone')}: <bdi>{zone}</bdi>
          </>
        )}
      </p>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            preference.retry();
            setState('loading');
            setRevision((value) => value + 1);
          }}
        >
          {label('refresh')}
        </Button>
      </div>
      {saved && <p role="status">{label('saved')}</p>}
      {(state === 'loading' || preference.status === 'loading') && (
        <p role="status">{label('loading')}</p>
      )}
      {(state === 'error' || preference.status === 'error') && <p role="alert">{label('error')}</p>}
      {state === 'denied' && <p role="alert">{label('denied')}</p>}
      {state === 'ready' && preference.status === 'ready' && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => open({ kind: 'rate' })}>{label('addRate')}</Button>
            <Button variant="outline" onClick={() => open({ kind: 'override' })}>
              {label('addOverride')}
            </Button>
          </div>
          {editor && (
            <form
              aria-label={label('editor')}
              onSubmit={submit}
              className="flex flex-col gap-4 border-y py-5"
            >
              {'title' in editor && <h2 className="font-semibold">{editor.title}</h2>}
              {editor.kind === 'rate' && (
                <>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="vat-category">{label('category')}</Label>
                    <select
                      id="vat-category"
                      className="max-w-full rounded-md border bg-background p-2"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                    >
                      {categories.map((value) => (
                        <option key={value} value={value}>
                          {label(`category.${value}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="vat-percent">{label('percent')}</Label>
                    <Input
                      id="vat-percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      required
                      value={percent}
                      onChange={(event) => setPercent(event.target.value)}
                    />
                  </div>
                </>
              )}
              {editor.kind === 'override' && (
                <>
                  <p>{label('overrideHelp')}</p>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="vat-product">{label('product')}</Label>
                    <select
                      id="vat-product"
                      className="max-w-full rounded-md border bg-background p-2"
                      required
                      value={productId}
                      onChange={(event) => setProductId(event.target.value)}
                    >
                      <option value="">{label('chooseProduct')}</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {productTitle(product.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <Label htmlFor="vat-rate">{label('rate')}</Label>
                    <select
                      id="vat-rate"
                      className="max-w-full rounded-md border bg-background p-2"
                      required
                      value={rateId}
                      onChange={(event) => setRateId(event.target.value)}
                    >
                      <option value="">{label('chooseRate')}</option>
                      {rates.map((rate) => (
                        <option key={rate.id} value={rate.id}>
                          {label(`category.${rate.category}`)} ·{' '}
                          {numbers.percent(rate.rateBasisPoints / 10000)} ·{' '}
                          {dateText(rate.effectiveFrom)}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={scheduled}
                  onChange={(event) => setScheduled(event.target.checked)}
                />
                {label('schedule')}
              </label>
              {!scheduled && <p className="text-sm">{label('immediate')}</p>}
              {scheduled && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <Label htmlFor="vat-date">{label('date')}</Label>
                    <DatePicker
                      id="vat-date"
                      label={label('date')}
                      placeholder={label('chooseDate')}
                      locale={locale}
                      timezone={zone}
                      {...(date ? { value: date } : {})}
                      onChange={setDate}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="vat-time">{label('time')}</Label>
                    <Input
                      id="vat-time"
                      type="time"
                      required
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                    />
                  </div>
                </div>
              )}
              {invalidDate && <p role="alert">{label('invalidDate')}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={scheduled && !date}>
                  {label(
                    editor.kind === 'endRate' || editor.kind === 'endOverride' ? 'end' : 'save'
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
          )}
          <section>
            <h2 className="text-xl font-semibold">{label('rates')}</h2>
            {!rates.length ? (
              <p>{label('empty')}</p>
            ) : (
              <div
                className="mt-3 max-w-full overflow-x-auto rounded-md border"
                role="region"
                aria-label={label('rates')}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll every table column.
                tabIndex={0}
              >
                <table className="w-full text-start text-sm" aria-label={label('rates')}>
                  <thead className="bg-muted">
                    <tr>
                      {['category', 'percent', 'from', 'until', 'status', 'actions'].map(
                        (column) => (
                          <th key={column} scope="col" className="p-3 text-start">
                            {label(column)}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rates.map((rate) => (
                      <tr key={rate.id}>
                        <th scope="row" className="p-3 text-start font-medium">
                          {label(`category.${rate.category}`)}
                        </th>
                        <td className="p-3">{numbers.percent(rate.rateBasisPoints / 10000)}</td>
                        <td className="p-3">
                          <time dateTime={rate.effectiveFrom}>{dateText(rate.effectiveFrom)}</time>
                        </td>
                        <td className="p-3">
                          {rate.effectiveUntil ? (
                            <time dateTime={rate.effectiveUntil}>
                              {dateText(rate.effectiveUntil)}
                            </time>
                          ) : (
                            label('openEnded')
                          )}
                        </td>
                        <td className="p-3">{label(`status.${rate.status}`)}</td>
                        <td className="p-3">
                          {rate.effectiveUntil === null && (
                            <Button
                              variant="outline"
                              aria-label={`${label('end')} ${label(`category.${rate.category}`)}`}
                              onClick={() =>
                                open({
                                  kind: 'endRate',
                                  id: rate.id,
                                  title: label(`category.${rate.category}`),
                                })
                              }
                            >
                              {label('end')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section>
            <h2 className="text-xl font-semibold">{label('overrides')}</h2>
            {!overrides.length ? (
              <p>{label('empty')}</p>
            ) : (
              <div
                className="mt-3 max-w-full overflow-x-auto rounded-md border"
                role="region"
                aria-label={label('overrides')}
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll every table column.
                tabIndex={0}
              >
                <table className="w-full text-start text-sm" aria-label={label('overrides')}>
                  <thead className="bg-muted">
                    <tr>
                      {['product', 'percent', 'from', 'until', 'status', 'actions'].map(
                        (column) => (
                          <th key={column} scope="col" className="p-3 text-start">
                            {label(column)}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {overrides.map((row) => (
                      <tr key={row.id}>
                        <th scope="row" className="p-3 text-start font-medium">
                          {productTitle(row.productId)}
                        </th>
                        <td className="p-3">{numbers.percent(row.rateBasisPoints / 10000)}</td>
                        <td className="p-3">
                          <time dateTime={row.effectiveFrom}>{dateText(row.effectiveFrom)}</time>
                        </td>
                        <td className="p-3">
                          {row.effectiveUntil ? (
                            <time dateTime={row.effectiveUntil}>
                              {dateText(row.effectiveUntil)}
                            </time>
                          ) : (
                            label('openEnded')
                          )}
                        </td>
                        <td className="p-3">{label(`status.${overrideStatus(row)}`)}</td>
                        <td className="p-3">
                          {row.effectiveUntil === null && (
                            <Button
                              variant="outline"
                              aria-label={`${label('endOverride')} ${productTitle(row.productId)}`}
                              onClick={() =>
                                open({
                                  kind: 'endOverride',
                                  id: row.id,
                                  title: productTitle(row.productId),
                                })
                              }
                            >
                              {label('endOverride')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setEditor(null);
            setSaved(true);
            setRevision((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
