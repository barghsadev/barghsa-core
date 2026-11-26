import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useLocation, useNavigate } from '@tanstack/react-router';
import { Bell, CalendarDays, ChevronRight, FileSearch } from 'lucide-react';
import { Button, Field, FieldLabel, Input, NativeSelect, Skeleton } from '@barghsa/ui';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance/browser';
import { RouteNotFound } from '../components/RouteErrorBoundary.js';
import { CatalogueChoicePicker } from '../components/CatalogueChoicePicker.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { staffQueryJson, useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { invoiceToolsText } from './invoice-tools-text.js';

const Reminders = lazy(() => import('../components/ReminderOffsetTogglePanel.js'));
const DuePeriods = lazy(() => import('../components/ServiceDuePeriodPanel.js'));

const settings = [
  { section: 'reminders', title: 'reminders', icon: Bell },
  { section: 'due-periods', title: 'duePeriods', icon: CalendarDays },
] as const;

type RecentInvoice = {
  invoiceId: string;
  createdAt: string;
  totalAmount: string;
  state: string;
};

function invoiceReference(invoiceId: string) {
  return `\u2066${invoiceId.slice(0, 8).toUpperCase()}…\u2069`;
}

function isRecentInvoice(value: unknown): value is RecentInvoice {
  const row = value as Partial<RecentInvoice> | null;
  return (
    typeof row?.invoiceId === 'string' &&
    isInvoiceUuid(row.invoiceId) &&
    typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt)) &&
    typeof row.totalAmount === 'string' &&
    /^-?\d+$/.test(row.totalAmount) &&
    typeof row.state === 'string'
  );
}

function RecentInvoicePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const locale = useLocale();
  const word = (key: Parameters<typeof invoiceToolsText>[0]) => invoiceToolsText(key, locale);
  const { format } = useAccountTime(locale);
  const { money } = useNumberFormatting(locale);
  const read = useStaffQueryRead('invoices');
  const [rows, setRows] = useState<RecentInvoice[] | null>(null);
  const [failure, setFailure] = useState<'unavailable' | 'denied' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const focusAfterRetry = useRef(false);
  const id = 'tools-recent-invoice';

  useEffect(() => {
    if (!rows?.length || !focusAfterRetry.current) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.focus();
      focusAfterRetry.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  useEffect(() => {
    const controller = new AbortController();
    void read('/api/admin/invoices/ledger', 'list', controller.signal, staffQueryJson)
      .then((value) => {
        if (controller.signal.aborted) return;
        const items = (value as { items?: unknown } | null)?.items;
        if (
          !Array.isArray(items) ||
          items.length > 25 ||
          !items.every(isRecentInvoice) ||
          new Set(items.map((item) => item.invoiceId)).size !== items.length
        ) {
          throw new Error('Invalid recent invoice list');
        }
        setRows(items);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRows(null);
        setFailure(
          error instanceof ServerQueryError && [401, 403].includes(error.status)
            ? 'denied'
            : 'unavailable'
        );
      });
    return () => controller.abort();
  }, [read, attempt]);

  const options = (rows ?? []).map((row) => {
    const date = format(row.createdAt, { dateStyle: 'medium' });
    const stateKey = `invoices.state.${row.state}`;
    const state = appText(stateKey, locale);
    const detail = state === stateKey ? date : `${date} · ${state}`;
    return {
      id: row.invoiceId,
      title: `${money(row.totalAmount)} · ${invoiceReference(row.invoiceId)}`,
      detail,
      searchText: `${row.invoiceId} ${row.totalAmount} ${row.createdAt.slice(0, 10)} ${detail}`,
    };
  });

  return (
    <Field>
      <FieldLabel htmlFor={id}>{word('recent')}</FieldLabel>
      {rows === null && failure === null ? (
        <div role="status" aria-label={word('loadingRecent')}>
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      ) : (
        <CatalogueChoicePicker
          id={id}
          locale={locale}
          options={options}
          selected={value}
          disabled={!options.length}
          labels={{
            search: word('chooseRecent'),
            noMatches: word('noMatches'),
            empty: word('noRecent'),
            unavailable: invoiceReference(value),
          }}
          onChange={onChange}
        />
      )}
      {failure ? (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs text-destructive">
            {failure === 'denied'
              ? t('admin.invoices.ledger.forbidden', locale)
              : word('recentUnavailable')}
          </p>
          {failure === 'unavailable' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                focusAfterRetry.current = true;
                setFailure(null);
                setAttempt((value) => value + 1);
              }}
            >
              {word('retryRecent')}
            </Button>
          )}
        </div>
      ) : rows?.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground">
          {word('noRecent')}
        </p>
      ) : null}
    </Field>
  );
}

function InvoiceLocator({ search }: { search: Record<string, unknown> }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  const [invalid, setInvalid] = useState(false);
  const [recent, setRecent] = useState(true);
  const [recentId, setRecentId] = useState('');
  const [manualId, setManualId] = useState('');
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
    const invoiceId = normalizeProfileDigits(
      recent ? recentId : String(fields.get('invoiceId') ?? '')
    )
      .trim()
      .toLowerCase();
    if (!isInvoiceUuid(invoiceId)) {
      if (recent) return;
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileSearch className="size-4" aria-hidden="true" />
        </span>
        <h2 id="invoice-locator" className="grow text-base font-semibold">
          {word('locator')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-controls="tools-invoice-choice"
          className="min-h-10 text-primary pointer-coarse:min-h-11"
          onClick={() => {
            setRecent((value) => !value);
            setRecentId('');
            setInvalid(false);
          }}
        >
          {invoiceToolsText(recent ? 'enterId' : 'browseRecent', locale)}
        </Button>
      </div>
      <form noValidate onSubmit={open} className="space-y-4 p-4 sm:p-5">
        <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div id="tools-invoice-choice" className="min-w-0">
            {recent ? (
              <RecentInvoicePicker value={recentId} onChange={setRecentId} />
            ) : (
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
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={manualId}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? 'tools-id-error tools-id-hint' : 'tools-id-hint'}
                  onChange={(event) => {
                    setManualId(event.target.value);
                    setInvalid(false);
                  }}
                  onBlur={(event) => {
                    const entered = normalizeProfileDigits(event.currentTarget.value.trim());
                    setInvalid(entered !== '' && !isInvoiceUuid(entered));
                  }}
                />
                {invalid && (
                  <p id="tools-id-error" role="alert" className="text-xs text-destructive">
                    {word('invalidId')}
                  </p>
                )}
                <p id="tools-id-hint" className="text-xs text-muted-foreground">
                  {word('idHelp')}
                </p>
              </Field>
            )}
          </div>
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
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-3 sm:flex-row-reverse sm:items-center sm:justify-between">
          <Button type="submit" className="min-h-11 sm:min-w-28" disabled={recent && !recentId}>
            {word('open')}
          </Button>
          <Link
            to="/admin/invoices"
            search={search}
            className="inline-flex min-h-9 w-fit items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline pointer-coarse:min-h-11"
          >
            {recent ? invoiceToolsText('findOlder', locale) : word('find')}
            <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
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
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
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
          <Suspense
            fallback={
              <RecordListSkeleton
                label={t('admin.invoices.loading', locale)}
                view="card"
                headings={[]}
              />
            }
          >
            {activeSettings.section === 'reminders' ? (
              <Reminders key={service} onLocked={setLocked} service={service} search={search} />
            ) : (
              <DuePeriods key={service} onLocked={setLocked} service={service} search={search} />
            )}
          </Suspense>
        </div>
      ) : (
        <>
          <InvoiceLocator key={JSON.stringify([actor, revision])} search={search} />
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
