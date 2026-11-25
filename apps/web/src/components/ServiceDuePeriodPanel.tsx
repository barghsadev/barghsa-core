import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance/browser';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  LoadingStatus,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  Input,
  ListRefreshButton,
} from '@barghsa/ui';
import { tDuePeriods as t } from '@barghsa/i18n/invoice-due-periods';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { type ServiceDuePeriodSetting, type ServiceDuePeriodType } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { useDuePeriodForm } from '../hooks/useDeadlineForms.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import { RefundFormAlert as FormAlert } from './RefundFormFeedback.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  InvoiceTimingServiceList,
  type InvoiceTimingPanelProps,
} from './InvoiceTimingServiceList.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';

const path = '/api/admin/config/invoice-due-periods';
const validDays = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 365;
type Change = {
  serviceType: ServiceDuePeriodType;
  defaultDays: number;
  expectedPeriodId: string | null;
};
function isSettings(value: unknown): value is ServiceDuePeriodSetting[] {
  if (!Array.isArray(value) || value.length !== SERVICE_DUE_PERIOD_TYPES.length) return false;
  const instant = (v: unknown) =>
    v === null || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
  return SERVICE_DUE_PERIOD_TYPES.every((serviceType) => {
    const rows = value.filter((row) => row?.serviceType === serviceType);
    const row = rows[0];
    return (
      rows.length === 1 &&
      validDays(row.defaultDays) &&
      (row.periodId === null ||
        (typeof row.periodId === 'string' && isInvoiceUuid(row.periodId))) &&
      instant(row.effectiveFrom) &&
      instant(row.effectiveUntil)
    );
  });
}

export default function ServiceDuePeriodPanel(props: InvoiceTimingPanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedServiceDuePeriodPanel key={JSON.stringify([actor, revision, props.service])} {...props} />
  );
}
function OwnedServiceDuePeriodPanel({ onLocked, search, service }: InvoiceTimingPanelProps) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(actor, profileRevision);
  const locale = useLocale(),
    draft = useDuePeriodForm(service ?? 'electricity');
  const time = useAccountTime(locale);
  const formatDays = (count: number) =>
    count === 1
      ? t('oneDayPeriod', locale)
      : t('periodLength', locale).replace('{days}', count.toLocaleString(locale));
  const [settings, setSettings] = useState<ServiceDuePeriodSetting[] | null>(null);
  const [days, setDays] = draft.field('defaultDays');
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [unavailable, setUnavailable] = useState(true),
    [reload, setReload] = useState(0);
  const [pending, setPending] = useState<{
    action: TeamAction;
    change: Change;
    owner: number;
    previousDays: number;
  } | null>(null);
  const inFlight = useRef(false),
    write = useRef<AbortController | null>(null),
    submitButton = useRef<HTMLButtonElement>(null),
    generation = useRef(0),
    live = useRef(false);
  const invalidFocus = useRef<'defaultDays' | null>(null);
  useEffect(() => {
    if (!saving && invalidFocus.current) {
      draft.form.setFocus(invalidFocus.current);
      invalidFocus.current = null;
    }
  }, [saving, draft.form]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const locked = loading || saving || Boolean(pending);
  const writePending = saving || Boolean(pending);
  useEffect(() => {
    onLocked?.(writePending);
    return () => onLocked?.(false);
  }, [onLocked, writePending]);
  const currentPeriod = settings?.find((row) => row.serviceType === service);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
      write.current?.abort();
    };
  }, []);
  function denied() {
    invalidFocus.current = null;
    generation.current++;
    write.current?.abort();
    setSettings(null);
    settingsRef.current = null;
    setPending(null);
    draft.form.reset({ serviceType: service ?? 'electricity', defaultDays: '7' });
    setUnavailable(true);
    setSaved(false);
    setError(t('denied', locale));
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setUnavailable(true);
    setError(null);
    setSaved(false);
    void readStaff('catalogue', 'detail', path, controller.signal)
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) denied();
          else setError(t('error', locale));
          return;
        }
        const value: unknown = await response.json();
        if (!isSettings(value)) throw new Error('read');
        if (controller.signal.aborted) return;
        const previous = settingsRef.current?.find((row) => row.serviceType === service);
        const next = value.find((row) => row.serviceType === service);
        if (service && next && JSON.stringify(previous) !== JSON.stringify(next)) {
          generation.current++;
          setPending(null);
          draft.form.reset({
            serviceType: service,
            defaultDays: String(next.defaultDays),
          });
        }
        setSettings(value);
        setUnavailable(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t('error', locale));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // The resource owns reloads; form changes must not restart its request.
  }, [reload, locale, readStaff, service]);
  const current = (owner: number) =>
    live.current && owner === generation.current && getProfileContextRevision() === profileRevision;
  function unconfirmed(owner: number) {
    if (!current(owner)) return;
    setUnavailable(true);
    setError(t('error', locale));
  }
  function accepted(value: unknown, change: Change, owner: number) {
    if (!current(owner)) return;
    if (
      !isSettings(value) ||
      value.find((row) => row.serviceType === change.serviceType)?.defaultDays !==
        change.defaultDays
    )
      throw new Error('receipt');
    const row = value.find((row) => row.serviceType === change.serviceType)!;
    if (
      !row.periodId ||
      !row.effectiveFrom ||
      (row.periodId === change.expectedPeriodId &&
        settingsRef.current?.find((item) => item.serviceType === change.serviceType)
          ?.defaultDays !== change.defaultDays)
    )
      throw new Error('receipt');
    setSettings(value);
    draft.form.reset({ serviceType: change.serviceType, defaultDays: String(change.defaultDays) });
    setSaved(true);
    setError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || unavailable || inFlight.current || !currentPeriod || !service) return;
    const owner = generation.current;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    let dispatched = false;
    try {
      await draft.form.handleSubmit(
        async (values) => {
          if (!current(owner) || values.serviceType !== service) return;
          const previous = currentPeriod;
          const change: Change = {
            serviceType: service,
            defaultDays: Number(normalizeProfileDigits(values.defaultDays).trim()),
            expectedPeriodId: previous.periodId,
          };
          const controller = new AbortController();
          write.current = controller;
          const { response, value } = await readWithDeadline(controller.signal, async (signal) => {
            dispatched = true;
            const response = await fetch(path, {
              method: 'PUT',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(change),
              signal,
            });
            const value: unknown = await response.json().catch(() => null);
            return { response, value };
          });
          if (!current(owner)) return;
          if (
            response.status === 403 &&
            authErrorCode(value) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
          ) {
            setPending({
              change,
              owner,
              previousDays: previous.defaultDays,
              action: {
                path,
                method: 'PUT',
                body: change,
                title: t('verifyTitle', locale),
                description: t('verifyDescription', locale),
                requiresPassword: true,
                responseDeadline: true,
                conflictMessage: t('conflict', locale),
                forbiddenMessage: t('denied', locale),
              },
            });
          } else if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              denied();
              return;
            }
            const fields = (value as { error?: { fields?: unknown[] } } | null)?.error?.fields;
            if (
              response.status === 400 &&
              authErrorCode(value) === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(fields) &&
              draft.applyServerErrors(fields)
            )
              return;
            if (response.status >= 500) throw new Error('unconfirmed');
            if (response.status === 409) setUnavailable(true);
            setError(t(response.status === 409 ? 'conflict' : 'error', locale));
          } else accepted(value, change, owner);
        },
        (errors) => {
          if (current(owner)) invalidFocus.current = errors.defaultDays ? 'defaultDays' : null;
        }
      )(event);
    } catch {
      if (current(owner)) {
        if (dispatched) {
          unconfirmed(owner);
        } else setError(t('error', locale));
      }
    } finally {
      write.current = null;
      inFlight.current = false;
      if (live.current) setSaving(false);
    }
  }
  return (
    <section
      id="invoice-due-periods"
      aria-labelledby="due-period-title"
      className={`${recordEditorSurface} scroll-mt-28 text-card-foreground`}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex items-start justify-between gap-3 border-b bg-muted/25 px-4 py-3.5 sm:px-6">
        <div className="space-y-1">
          <h2 id="due-period-title" className="text-base font-semibold">
            {t('title', locale)}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description', locale)}</p>
        </div>
        {!unavailable && (
          <ListRefreshButton
            label={t('load', locale)}
            disabled={locked}
            onClick={() => setReload((value) => value + 1)}
          />
        )}
      </header>
      {(loading || error) && (
        <div className="space-y-2 px-4 py-3 sm:px-6">
          {loading && <LoadingStatus>{t('loading', locale)}</LoadingStatus>}
          <FormAlert message={error ?? undefined} />
          {unavailable && error && (
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => setReload((value) => value + 1)}
            >
              {t('load', locale)}
            </Button>
          )}
        </div>
      )}
      {settings && !service && (
        <InvoiceTimingServiceList
          section="due-periods"
          search={search}
          disabled={loading || unavailable}
          summary={(id) =>
            formatDays(settings.find((setting) => setting.serviceType === id)!.defaultDays)
          }
        />
      )}
      {currentPeriod && (
        <form onSubmit={save} noValidate>
          <FieldSet disabled={locked || unavailable} className="gap-0">
            <div className="space-y-3 px-4 py-3.5 sm:px-6">
              {currentPeriod && (
                <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border bg-muted/25 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-muted-foreground">{t('currentPeriod', locale)}</dt>
                    <dd className="font-medium">{formatDays(currentPeriod.defaultDays)}</dd>
                  </div>
                  {currentPeriod.effectiveFrom && time.status === 'ready' && (
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <dt className="text-muted-foreground">{t('effectiveSince', locale)}</dt>
                      <dd>
                        <bdi>{time.format(currentPeriod.effectiveFrom)}</bdi>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="due-period-days">{t('days', locale)}</FieldLabel>
                  <Input
                    id="due-period-days"
                    dir="ltr"
                    className="max-w-28 tabular-nums"
                    {...draft.bind('defaultDays')}
                    aria-describedby={draft.errorId('defaultDays')}
                    inputMode="numeric"
                    value={days}
                    maxLength={3}
                    onChange={(event) => {
                      setDays(event.target.value);
                      setSaved(false);
                    }}
                  />
                  <p
                    id={draft.errorId('defaultDays')}
                    role={draft.errors.defaultDays ? 'alert' : undefined}
                    className={
                      draft.errors.defaultDays
                        ? 'text-sm text-destructive'
                        : 'text-sm text-muted-foreground'
                    }
                  >
                    {draft.errors.defaultDays?.message ?? t('invalid', locale)}
                  </p>
                </Field>
              </FieldGroup>
              <FormAlert message={draft.errors.root?.validation?.message} />
            </div>
            <RecordEditorActions
              secondary={
                saved ? (
                  <p role="status" className="text-sm">
                    {t('saved', locale)}
                  </p>
                ) : undefined
              }
            >
              <Button
                ref={submitButton}
                type="submit"
                disabled={locked || unavailable}
                aria-busy={saving || undefined}
              >
                {saving && (
                  <span
                    aria-hidden="true"
                    className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {t(saving ? 'saving' : 'save', locale)}
              </Button>
            </RecordEditorActions>
          </FieldSet>
        </form>
      )}
      {pending && (
        <TeamActionDialog
          action={pending.action}
          toastErrors={false}
          finalFocus={submitButton}
          summary={
            <dl className="space-y-2 rounded-lg border bg-muted/25 p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{t('service', locale)}</dt>
                <dd>
                  {adminText(
                    `admin.invoices.reminders.service.${pending.change.serviceType}`,
                    locale
                  )}
                </dd>
              </div>
              {(
                [
                  ['currentPeriod', pending.previousDays],
                  ['reviewedPeriod', pending.change.defaultDays],
                ] as const
              ).map(([label, count]) => (
                <div key={label} className="flex flex-wrap items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{t(label, locale)}</dt>
                  <dd className={label === 'reviewedPeriod' ? 'font-semibold' : undefined}>
                    {formatDays(count)}
                  </dd>
                </div>
              ))}
            </dl>
          }
          onClose={() => setPending(null)}
          onDenied={denied}
          confirmationDisabled={unavailable || !current(pending.owner)}
          onUnconfirmed={() => unconfirmed(pending.owner)}
          onValidationError={(fields) => current(pending.owner) && draft.applyServerErrors(fields)}
          onSuccess={async (value) => accepted(value, pending.change, pending.owner)}
        />
      )}
    </section>
  );
}
