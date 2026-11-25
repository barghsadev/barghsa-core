import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useLocation, useNavigate } from '@tanstack/react-router';
import { Bell, CalendarDays, ChevronRight, FileSearch } from 'lucide-react';
import { Button, Field, FieldLabel, Input, NativeSelect, PageLoading } from '@barghsa/ui';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance/browser';
import { RouteNotFound } from '../components/RouteErrorBoundary.js';
import { useLocale } from '../hooks/useLocale.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

const Reminders = lazy(() => import('../components/ReminderOffsetTogglePanel.js'));
const DuePeriods = lazy(() => import('../components/ServiceDuePeriodPanel.js'));

const settings = [
  { section: 'reminders', title: 'reminders', icon: Bell },
  { section: 'due-periods', title: 'duePeriods', icon: CalendarDays },
] as const;

function InvoiceLocator({ search }: { search: Record<string, unknown> }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const [invalid, setInvalid] = useState(false);
  const word = (key: string) => t(`admin.invoices.tools.${key}`, locale);
  const options = [
    { value: 'detail', label: t('admin.invoices.ledger.detail', locale) },
    { value: 'deadline', label: t('admin.invoices.title', locale) },
    { value: 'correction', label: tInvoiceCorrections('title', locale) },
    {
      value: 'refunds',
      label: t('admin.invoices.walletRefunds.title', locale),
      destination: 'wallet',
    },
    {
      value: 'refunds-bank',
      label: t('admin.invoices.externalRefunds.title', locale),
      destination: 'bank',
    },
  ] as const;
  const defaultAction =
    hash === 'invoice-deadline-panel'
      ? 'deadline'
      : hash === 'invoice-corrections-panel'
        ? 'correction'
        : hash === 'external-refunds-panel'
          ? 'refunds-bank'
          : hash === 'invoice-refunds-panel' || hash === 'wallet-refunds-panel'
            ? 'refunds'
            : 'detail';

  function open(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const invoiceId = normalizeProfileDigits(String(fields.get('invoiceId') ?? ''))
      .trim()
      .toLowerCase();
    if (!isInvoiceUuid(invoiceId)) {
      setInvalid(true);
      event.currentTarget.querySelector('input')?.focus();
      return;
    }
    const selection = options.find(({ value }) => value === fields.get('action'));
    if (!selection || selection.value === 'detail') {
      void navigate({ to: '/admin/invoices/$invoiceId', params: { invoiceId }, search });
      return;
    }
    void navigate({
      to: '/admin/invoices/$invoiceId/$action/{-$destination}/{-$view}/{-$operation}',
      params: {
        invoiceId,
        action: 'destination' in selection ? 'refunds' : selection.value,
        destination: 'destination' in selection ? selection.destination : undefined,
        view: undefined,
        operation: undefined,
      },
      search,
    });
  }

  return (
    <section aria-labelledby="invoice-locator" className="rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileSearch className="size-4" aria-hidden="true" />
        </span>
        <h2 id="invoice-locator" className="text-base font-semibold">
          {word('locator')}
        </h2>
      </div>
      <form noValidate onSubmit={open} className="space-y-3 p-4 sm:p-5">
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
          <Field data-invalid={invalid || undefined}>
            <FieldLabel htmlFor="tools-invoice-id">
              {t('admin.invoices.invoiceId', locale)}
            </FieldLabel>
            <Input
              id="tools-invoice-id"
              name="invoiceId"
              className="min-h-11 font-mono"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? 'tools-id-error tools-id-hint' : 'tools-id-hint'}
              onChange={() => setInvalid(false)}
              onBlur={(event) => {
                const entered = normalizeProfileDigits(event.currentTarget.value.trim());
                setInvalid(entered !== '' && !isInvoiceUuid(entered));
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tools-invoice-action">{word('action')}</FieldLabel>
            <NativeSelect
              key={defaultAction}
              id="tools-invoice-action"
              name="action"
              className="min-h-11 w-full"
              defaultValue={defaultAction}
            >
              {options.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" className="min-h-11">
            {word('open')}
          </Button>
        </div>
        {invalid && (
          <p id="tools-id-error" role="alert" className="text-xs text-destructive">
            {word('invalidId')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <p id="tools-id-hint" className="text-muted-foreground">
            {word('idHelp')}
          </p>
          <Link
            to="/admin/invoices"
            search={search}
            className="touch-action text-primary underline underline-offset-4"
          >
            {word('find')}
          </Link>
        </div>
      </form>
    </section>
  );
}

export default function AdminInvoiceToolsPage({
  search,
  section,
  serviceParam,
}: {
  search: Record<string, unknown>;
  section?: string | undefined;
  serviceParam?: string | undefined;
}) {
  const locale = useLocale();
  const word = (key: string) => t(`admin.invoices.tools.${key}`, locale);
  const activeSettings = settings.find((item) => item.section === section);
  const service = SERVICE_DUE_PERIOD_TYPES.find((id) => id === serviceParam);
  const [locked, setLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const page = `${section ?? ''}/${service ?? ''}`;
  const previousPage = useRef(page);
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: () => locked });
  useEffect(() => {
    if (previousPage.current !== page) {
      heading.current?.focus({ preventScroll: true });
      previousPage.current = page;
    }
  }, [page]);
  if ((section && !activeSettings) || (serviceParam && (!activeSettings || !service)))
    return <RouteNotFound />;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="space-y-1">
        {activeSettings ? (
          <Link
            to="/admin/invoices/tools/{-$section}/{-$service}"
            params={{ section: service ? section : undefined, service: undefined }}
            search={search}
            disabled={locked}
            className="touch-action text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
          >
            {service ? word(activeSettings.title) : t('admin.invoices.tools', locale)}
          </Link>
        ) : (
          <Link
            to="/admin/invoices"
            search={search}
            className="touch-action text-sm text-primary underline underline-offset-4"
          >
            {t('admin.invoices.ledger.backToInvoices', locale)}
          </Link>
        )}
        <h1 ref={heading} tabIndex={-1} className="w-fit text-2xl font-semibold">
          {service
            ? t(`admin.invoices.reminders.service.${service}`, locale)
            : activeSettings
              ? word(activeSettings.title)
              : t('admin.invoices.tools', locale)}
        </h1>
      </header>
      {activeSettings ? (
        <div className={service ? 'max-w-lg' : 'max-w-2xl'}>
          <Suspense fallback={<PageLoading label={t('admin.invoices.loading', locale)} />}>
            {activeSettings.section === 'reminders' ? (
              <Reminders key={service} onLocked={setLocked} service={service} search={search} />
            ) : (
              <DuePeriods key={service} onLocked={setLocked} service={service} search={search} />
            )}
          </Suspense>
        </div>
      ) : (
        <>
          <InvoiceLocator search={search} />
          <section aria-labelledby="invoice-settings" className="space-y-2.5">
            <h2 id="invoice-settings" className="text-sm font-semibold">
              {word('settings')}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {settings.map(({ section: destination, title, icon: Icon }) => (
                <Link
                  key={destination}
                  to="/admin/invoices/tools/{-$section}/{-$service}"
                  params={{ section: destination, service: undefined }}
                  search={search}
                  className="group flex min-w-0 items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{word(title)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {word(`${title}Help`)}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                    aria-hidden="true"
                  />
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
