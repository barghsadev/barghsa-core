import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@barghsa/ui';
import { tDuePeriods as t } from '@barghsa/i18n/invoice-due-periods';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import {
  SERVICE_DUE_PERIOD_TYPES,
  type ServiceDuePeriodSetting,
  type ServiceDuePeriodType,
} from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

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

export default function ServiceDuePeriodPanel() {
  const locale = useLocale();
  const [settings, setSettings] = useState<ServiceDuePeriodSetting[] | null>(null);
  const [serviceType, setServiceType] = useState<ServiceDuePeriodType>('electricity');
  const [days, setDays] = useState('7');
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<{ action: TeamAction; change: Change } | null>(null);
  const inFlight = useRef(false),
    submitButton = useRef<HTMLButtonElement>(null);
  const selected = useRef(serviceType);
  selected.current = serviceType;
  const locked = loading || saving || Boolean(pending);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSettings(null);
    setError(null);
    setSaved(false);
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError(
            t(response.status === 401 || response.status === 403 ? 'denied' : 'error', locale)
          );
          return;
        }
        const value: unknown = await response.json();
        if (!isSettings(value)) throw new Error(t('error', locale));
        if (controller.signal.aborted) return;
        setSettings(value);
        setDays(String(value.find((row) => row.serviceType === selected.current)!.defaultDays));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(t('error', locale));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, locale]);

  function accepted(value: unknown, change: Change) {
    if (
      !isSettings(value) ||
      value.find((row) => row.serviceType === change.serviceType)?.defaultDays !==
        change.defaultDays
    )
      throw new Error(t('error', locale));
    const current = value.find((row) => row.serviceType === change.serviceType)!;
    if (!current.periodId || !current.effectiveFrom) throw new Error(t('error', locale));
    setSettings(value);
    setDays(String(change.defaultDays));
    setSaved(true);
    setError(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (locked || inFlight.current || !settings) return;
    const normalized = days
      .trim()
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
    const defaultDays = /^\d+$/.test(normalized) ? Number(normalized) : NaN;
    setSaved(false);
    setError(null);
    if (!validDays(defaultDays)) {
      setError(t('invalid', locale));
      return;
    }
    const change: Change = {
      serviceType,
      defaultDays,
      expectedPeriodId: settings.find((row) => row.serviceType === serviceType)!.periodId,
    };
    inFlight.current = true;
    setSaving(true);
    try {
      const response = await fetch(path, {
        method: 'PUT',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(change),
      });
      const value: unknown = await response.json().catch(() => null);
      if (
        response.status === 403 &&
        authErrorCode(value) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
      ) {
        setPending({
          change,
          action: {
            path,
            method: 'PUT',
            body: change,
            title: t('verifyTitle', locale),
            description: t('verifyDescription', locale),
            requiresPassword: true,
            conflictMessage: t('conflict', locale),
            forbiddenMessage: t('denied', locale),
          },
        });
      } else if (!response.ok)
        setError(
          t(
            response.status === 409
              ? 'conflict'
              : response.status === 401 || response.status === 403
                ? 'denied'
                : 'error',
            locale
          )
        );
      else accepted(value, change);
    } catch {
      setError(t('error', locale));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <section
      id="invoice-due-periods"
      aria-labelledby="due-period-title"
      className="space-y-4 rounded-lg border bg-card p-4 text-card-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <h2 id="due-period-title" className="text-lg font-semibold">
        {t('title', locale)}
      </h2>
      <p className="text-sm text-muted-foreground">{t('description', locale)}</p>
      {loading ? <p role="status">{t('loading', locale)}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={locked}
        onClick={() => setReload((value) => value + 1)}
      >
        {t('load', locale)}
      </Button>
      {settings ? (
        <form onSubmit={save}>
          <FieldSet disabled={locked}>
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="due-period-service">{t('service', locale)}</FieldLabel>
                <NativeSelect
                  id="due-period-service"
                  value={serviceType}
                  onChange={(event) => {
                    const next = event.target.value as ServiceDuePeriodType;
                    setServiceType(next);
                    setDays(String(settings.find((row) => row.serviceType === next)!.defaultDays));
                    setSaved(false);
                    setError(null);
                  }}
                >
                  {SERVICE_DUE_PERIOD_TYPES.map((type) => (
                    <NativeSelectOption key={type} value={type}>
                      {adminText(`admin.invoices.reminders.service.${type}`, locale)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="due-period-days">{t('days', locale)}</FieldLabel>
                <Input
                  id="due-period-days"
                  inputMode="numeric"
                  value={days}
                  maxLength={3}
                  onChange={(event) => {
                    setDays(event.target.value);
                    setSaved(false);
                  }}
                  aria-invalid={Boolean(error)}
                />
              </Field>
            </FieldGroup>
            <Button ref={submitButton} type="submit" disabled={locked} className="hover:bg-primary">
              {t(saving ? 'saving' : 'save', locale)}
            </Button>
          </FieldSet>
        </form>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm">
          {t('saved', locale)}
        </p>
      ) : null}
      {pending ? (
        <TeamActionDialog
          action={pending.action}
          finalFocus={submitButton}
          onClose={() => setPending(null)}
          onSuccess={async (value) => {
            accepted(value, pending.change);
            setPending(null);
          }}
        />
      ) : null}
    </section>
  );
}
