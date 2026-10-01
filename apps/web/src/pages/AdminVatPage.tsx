import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  DatePicker,
  datePickerAtTime,
  Input,
  Label,
  ListPage,
  ScrollArea,
} from '@barghsa/ui';
import { ConfigPreviewCard } from '../components/ConfigPreviewCard.js';
import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { tVat } from '@barghsa/i18n/vat';
import {
  CHARGE_CATEGORIES,
  PRODUCT_OVERRIDE_CATEGORY,
  vatWindowStatus,
  type VatConfigDto,
  type VatProductOverrideDto,
} from '@barghsa/shared/finance';
import { useTimezone } from '../hooks/useTimezone.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
type Product = { id: string; title: Record<string, string>; type: string };
type Editor =
  | { kind: 'rate' }
  | { kind: 'override' }
  | { kind: 'endRate' | 'endOverride'; id: string; title: string };
const categories = [...CHARGE_CATEGORIES, PRODUCT_OVERRIDE_CATEGORY];
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const instant = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
function validWindow(value: unknown): value is Record<string, unknown> {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    instant(value.effectiveFrom) &&
    (value.effectiveUntil === null || instant(value.effectiveUntil)) &&
    Number.isInteger(value.rateBasisPoints) &&
    Number(value.rateBasisPoints) >= 0 &&
    Number(value.rateBasisPoints) <= 10000
  );
}
function validRates(value: unknown): value is VatConfigDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        validWindow(row) &&
        typeof row.category === 'string' &&
        ['current', 'scheduled', 'expired'].includes(String(row.status))
    )
  );
}
function validOverrides(value: unknown): value is VatProductOverrideDto[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        validWindow(row) && typeof row.productId === 'string' && typeof row.vatConfigId === 'string'
    )
  );
}
function validProducts(value: unknown): value is Product[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        record(row) &&
        typeof row.id === 'string' &&
        typeof row.type === 'string' &&
        record(row.title) &&
        Object.values(row.title).every((title) => typeof title === 'string')
    )
  );
}
function financialBasis(row: VatConfigDto | VatProductOverrideDto | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    rate: row.rateBasisPoints,
    from: row.effectiveFrom,
    until: row.effectiveUntil,
    ...('productId' in row
      ? { product: row.productId, rateId: row.vatConfigId }
      : { category: row.category }),
  };
}
function commandBasis(
  command: TeamAction,
  rates: VatConfigDto[],
  overrides: VatProductOverrideDto[],
  products: Product[]
) {
  const base = '/api/admin/finance/vat',
    body = record(command.body) ? command.body : {};
  const sorted = (rows: (VatConfigDto | VatProductOverrideDto)[]) =>
    rows.map(financialBasis).sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  if (command.path === base)
    return JSON.stringify(sorted(rates.filter((row) => row.category === body.category)));
  if (command.path === `${base}/overrides`) {
    const product = products.find((row) => row.id === body.productId);
    return JSON.stringify({
      product: product ? { id: product.id, type: product.type } : null,
      rate: financialBasis(rates.find((row) => row.id === body.vatConfigId)),
      overrides: sorted(overrides.filter((row) => row.productId === body.productId)),
    });
  }
  const id = command.path.split('/').at(-2);
  if (command.path.includes('/overrides/')) {
    const row = overrides.find((v) => v.id === id);
    return JSON.stringify({
      row: financialBasis(row),
      rate: financialBasis(rates.find((v) => v.id === row?.vatConfigId)),
    });
  }
  return JSON.stringify(financialBasis(rates.find((v) => v.id === id)));
}
export default function AdminVatPage() {
  const preference = useTimezone();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const label = (key: string) => tVat(`admin.vat.${key}`, locale);
  const [editor, setEditor] = useState<Editor | null>(null);
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
  const generation = useRef(0),
    commandVersion = useRef(0),
    frozenBasis = useRef<string | null>(null);
  const [acceptedZone, setAcceptedZone] = useState<string | null>(null);
  const clearEditor = useCallback(() => {
    generation.current++;
    frozenBasis.current = null;
    setEditor(null);
    setAction(null);
    setScheduled(false);
    setDate(undefined);
    setTime('00:00');
    setInvalidDate(false);
    setPercent('0');
    setCategory('electricity');
    setProductId('');
    setRateId('');
  }, []);
  const clearWork = useCallback(() => {
    clearEditor();
    setSaved(false);
  }, [clearEditor]);
  const scope = useCatalogueScope(clearWork);
  const rateRead = useCatalogueResource(scope, '/api/admin/finance/vat', validRates);
  const overrideRead = useCatalogueResource(
    scope,
    '/api/admin/finance/vat/overrides',
    validOverrides
  );
  const productRead = useCatalogueResource(scope, '/api/admin/finance/vat/products', validProducts);
  const rates = rateRead.data ?? [],
    overrides = overrideRead.data ?? [],
    products = productRead.data ?? [];
  const zone =
    preference.status === 'ready' ? preference.timezone : (acceptedZone ?? preference.timezone);
  const hasZone = preference.status === 'ready' || acceptedZone !== null;
  const rateDisabled =
    scope.denied || rateRead.loading || rateRead.error || preference.status !== 'ready';
  const overrideDisabled = rateDisabled || overrideRead.loading || overrideRead.error;
  const choicesDisabled = overrideDisabled || productRead.loading || productRead.error;
  const commandDisabled = (kind: Editor['kind']) =>
    kind === 'override'
      ? choicesDisabled
      : kind === 'endOverride'
        ? overrideDisabled
        : rateDisabled;
  const work = useRef({ editor, action, scheduled, rates, overrides, products });
  work.current = { editor, action, scheduled, rates, overrides, products };
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  useEffect(() => {
    if (preference.status !== 'ready') return;
    if (acceptedZone !== null && acceptedZone !== preference.timezone) {
      generation.current++;
      frozenBasis.current = null;
      setAction(null);
      if (work.current.scheduled) {
        setDate(undefined);
        setInvalidDate(true);
      }
    }
    setAcceptedZone(preference.timezone);
  }, [preference.status, preference.timezone, acceptedZone]);
  useEffect(() => {
    const current = work.current;
    if (current.editor && 'id' in current.editor) {
      const ending = current.editor;
      const rows = ending.kind === 'endRate' ? rateRead.data : overrideRead.data;
      if (rows && !rows.some((row) => row.id === ending.id && row.effectiveUntil === null)) {
        clearEditor();
        return;
      }
    }
    if (
      current.action &&
      frozenBasis.current !== null &&
      commandBasis(current.action, current.rates, current.overrides, current.products) !==
        frozenBasis.current
    ) {
      generation.current++;
      frozenBasis.current = null;
      setAction(null);
    }
  }, [rateRead.data, overrideRead.data, productRead.data, clearEditor]);
  function refresh() {
    preference.retry();
    if (scope.denied) scope.recover();
    else {
      rateRead.retry();
      overrideRead.retry();
      productRead.retry();
    }
  }
  const recovery = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={
          rateRead.loading ||
          overrideRead.loading ||
          productRead.loading ||
          preference.status === 'loading'
        }
        onClick={refresh}
      >
        {label('refresh')}
      </Button>
      {rateRead.error && (
        <div role="alert">
          <p>{label('ratesError')}</p>
          <Button type="button" onClick={rateRead.retry}>
            {label('ratesRetry')}
          </Button>
        </div>
      )}
      {overrideRead.error && (
        <div role="alert">
          <p>{label('overridesError')}</p>
          <Button type="button" onClick={overrideRead.retry}>
            {label('overridesRetry')}
          </Button>
        </div>
      )}
      {productRead.error && (
        <div role="alert">
          <p>{label('productsError')}</p>
          <Button type="button" onClick={productRead.retry}>
            {label('productsRetry')}
          </Button>
        </div>
      )}
      {preference.status === 'loading' && <p role="status">{label('timezoneLoading')}</p>}
      {preference.status === 'error' && (
        <div role="alert">
          <p>{label('timezoneError')}</p>
          <Button type="button" onClick={preference.retry}>
            {label('timezoneRetry')}
          </Button>
        </div>
      )}
    </div>
  );
  const productTitle = (id: string) => {
    const product = products.find((row) => row.id === id);
    return product?.title[locale] || product?.title.en || product?.title.fa || label('product');
  };
  const dateText = (value: string) =>
    hasZone ? new Date(value).toLocaleString(locale, { timeZone: zone }) : label('timezoneLoading');
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
  function open(next: Editor) {
    if (commandDisabled(next.kind)) return;
    clearEditor();
    setSaved(false);
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.checkValidity()) return;
    if (!editor || commandDisabled(editor.kind)) return;
    if (
      editor.kind === 'override' &&
      (!products.some((row) => row.id === productId) || !rates.some((row) => row.id === rateId))
    )
      return;
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
    const command: TeamAction = {
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
    };
    commandVersion.current = generation.current;
    frozenBasis.current = commandBasis(command, rates, overrides, products);
    setAction(command);
  }
  return (
    <div
      className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6 p-4 md:p-8"
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
          disabled={
            rateRead.loading ||
            overrideRead.loading ||
            productRead.loading ||
            preference.status === 'loading'
          }
          onClick={refresh}
        >
          {label('refresh')}
        </Button>
      </div>
      {scope.denied && <p role="alert">{label('denied')}</p>}
      {!scope.denied && (
        <>
          {saved && <p role="status">{label('saved')}</p>}
          {preference.status === 'loading' && <p role="status">{label('timezoneLoading')}</p>}
          {preference.status === 'error' && (
            <div role="alert">
              <p>{label('timezoneError')}</p>
              <Button onClick={preference.retry}>{label('timezoneRetry')}</Button>
            </div>
          )}
          {productRead.loading && <p role="status">{label('productsLoading')}</p>}
          {productRead.error && (
            <div role="alert">
              <p>{label('productsError')}</p>
              <Button onClick={productRead.retry}>{label('productsRetry')}</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={rateDisabled} onClick={() => open({ kind: 'rate' })}>
              {label('addRate')}
            </Button>
            <Button
              variant="outline"
              disabled={choicesDisabled}
              onClick={() => open({ kind: 'override' })}
            >
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
                      {productId && !products.some((row) => row.id === productId) && (
                        <option value={productId}>
                          {label('unavailable')} ({productId})
                        </option>
                      )}
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
                      {rateId && !rates.some((row) => row.id === rateId) && (
                        <option value={rateId}>
                          {label('unavailable')} ({rateId})
                        </option>
                      )}
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
                  onChange={(event) => {
                    setScheduled(event.target.checked);
                    setInvalidDate(false);
                  }}
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
                      onChange={(value) => {
                        setDate(value);
                        setInvalidDate(false);
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="vat-time">{label('time')}</Label>
                    <Input
                      id="vat-time"
                      type="time"
                      dir="ltr"
                      required
                      value={time}
                      onChange={(event) => {
                        setTime(event.target.value);
                        setInvalidDate(false);
                      }}
                    />
                  </div>
                </div>
              )}
              {invalidDate && <p role="alert">{label('invalidDate')}</p>}
              {editor.kind === 'rate' && (
                <ConfigPreviewCard
                  title={settingsText('admin.settings.comparison', locale)}
                  current={
                    <div className="flex flex-col gap-2">
                      <p>{label(`category.${category}`)}</p>
                      <p>
                        {(() => {
                          const current = rates.find(
                            (row) =>
                              row.category === category &&
                              vatWindowStatus(row.effectiveFrom, row.effectiveUntil) === 'current'
                          );
                          return current
                            ? numbers.percent(current.rateBasisPoints / 10000)
                            : settingsText('admin.settings.none', locale);
                        })()}
                      </p>
                    </div>
                  }
                  draft={
                    <div className="flex flex-col gap-2">
                      <p>{label(`category.${category}`)}</p>
                      <p>
                        {/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(percent) && Number(percent) <= 100
                          ? numbers.percent(Number(percent) / 100)
                          : label('invalid')}
                      </p>
                      <p>
                        {scheduled
                          ? `${label('schedule')} ${date ? dateText(date.toISOString()) : label('chooseDate')} ${time}`
                          : label('immediate')}
                      </p>
                    </div>
                  }
                />
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  disabled={
                    commandDisabled(editor.kind) ||
                    (scheduled && !date) ||
                    (editor.kind === 'override' &&
                      (!products.some((row) => row.id === productId) ||
                        !rates.some((row) => row.id === rateId)))
                  }
                >
                  {label(
                    editor.kind === 'endRate' || editor.kind === 'endOverride' ? 'end' : 'save'
                  )}
                </Button>
                <Button type="button" variant="outline" onClick={clearEditor}>
                  {label('cancel')}
                </Button>
              </div>
            </form>
          )}
          <section>
            <h2 className="text-xl font-semibold">{label('rates')}</h2>
            <ListPage>
              <ListPage.Content
                loading={rateRead.loading}
                error={rateRead.error}
                empty={!rates.length}
                retainContent={rates.length > 0}
                loadingView={<p role="status">{label('loading')}</p>}
                emptyView={<p>{label('empty')}</p>}
                errorView={
                  <div role="alert">
                    <p>{label('ratesError')}</p>
                    <Button onClick={rateRead.retry}>{label('ratesRetry')}</Button>
                  </div>
                }
              >
                {rates.length > 0 && (
                  <ScrollArea
                    scrollbarOrientation="horizontal"
                    className="mt-3 max-w-full min-w-0 rounded-md border"
                    role="region"
                    aria-label={label('rates')}
                  >
                    <table
                      className="w-full min-w-[680px] text-start text-sm"
                      aria-label={label('rates')}
                    >
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
                              <time dateTime={rate.effectiveFrom}>
                                {dateText(rate.effectiveFrom)}
                              </time>
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
                                  disabled={rateDisabled}
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
                  </ScrollArea>
                )}
              </ListPage.Content>
            </ListPage>
          </section>
          <section>
            <h2 className="text-xl font-semibold">{label('overrides')}</h2>
            <ListPage>
              <ListPage.Content
                loading={overrideRead.loading}
                error={overrideRead.error}
                empty={!overrides.length}
                retainContent={overrides.length > 0}
                loadingView={<p role="status">{label('loading')}</p>}
                emptyView={<p>{label('empty')}</p>}
                errorView={
                  <div role="alert">
                    <p>{label('overridesError')}</p>
                    <Button onClick={overrideRead.retry}>{label('overridesRetry')}</Button>
                  </div>
                }
              >
                {overrides.length > 0 && (
                  <ScrollArea
                    scrollbarOrientation="horizontal"
                    className="mt-3 max-w-full min-w-0 rounded-md border"
                    role="region"
                    aria-label={label('overrides')}
                  >
                    <table
                      className="w-full min-w-[680px] text-start text-sm"
                      aria-label={label('overrides')}
                    >
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
                              <time dateTime={row.effectiveFrom}>
                                {dateText(row.effectiveFrom)}
                              </time>
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
                                  disabled={overrideDisabled}
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
                  </ScrollArea>
                )}
              </ListPage.Content>
            </ListPage>
          </section>
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          summary={recovery}
          confirmationDisabled={editor === null || commandDisabled(editor.kind)}
          onClose={() => {
            generation.current++;
            frozenBasis.current = null;
            setAction(null);
          }}
          onSuccess={((version) => async () => {
            if (version !== generation.current) return;
            clearEditor();
            setSaved(true);
            rateRead.retry();
            overrideRead.retry();
          })(commandVersion.current)}
        />
      )}
    </div>
  );
}
