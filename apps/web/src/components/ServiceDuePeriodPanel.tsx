import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance/browser';
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
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { type ServiceDuePeriodSetting, type ServiceDuePeriodType } from '@barghsa/shared/finance';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { authErrorCode } from '../lib/auth-errors.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { useDuePeriodForm } from '../hooks/useDeadlineForms.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
import {
  RefundFieldFeedback as FieldFeedback,
  RefundFormAlert as FormAlert,
} from './RefundFormFeedback.js';
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
  const locale = useLocale(),
    draft = useDuePeriodForm();
  const [settings, setSettings] = useState<ServiceDuePeriodSetting[] | null>(null);
  const [serviceType] = draft.field('serviceType'),
    [days, setDays] = draft.field('defaultDays');
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
  } | null>(null);
  const inFlight = useRef(false),
    submitButton = useRef<HTMLButtonElement>(null),
    generation = useRef(0),
    live = useRef(false);
  const invalidFocus = useRef<'serviceType' | 'defaultDays' | null>(null);
  useEffect(() => {
    if (!saving && invalidFocus.current) {
      draft.form.setFocus(invalidFocus.current);
      invalidFocus.current = null;
    }
  }, [saving, draft.form]);
  const selected = useRef(serviceType),
    settingsRef = useRef(settings);
  selected.current = serviceType;
  settingsRef.current = settings;
  const locked = loading || saving || Boolean(pending);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generation.current++;
    };
  }, []);
  function denied() {
    invalidFocus.current = null;
    generation.current++;
    setSettings(null);
    settingsRef.current = null;
    setPending(null);
    draft.form.reset({ serviceType: 'electricity', defaultDays: '7' });
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
    void fetch(path, { credentials: 'include', signal: controller.signal })
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
        const previous = settingsRef.current?.find((row) => row.serviceType === selected.current);
        const next = value.find((row) => row.serviceType === selected.current)!;
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
          generation.current++;
          setPending(null);
          draft.form.reset({
            serviceType: selected.current,
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
  }, [reload, locale]);
  const current = (owner: number) => live.current && owner === generation.current;
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
    if (locked || unavailable || inFlight.current || !settings) return;
    const owner = generation.current;
    inFlight.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await draft.form.handleSubmit(
        async (values) => {
          if (!current(owner)) return;
          const change: Change = {
            serviceType: values.serviceType as ServiceDuePeriodType,
            defaultDays: Number(normalizeProfileDigits(values.defaultDays).trim()),
            expectedPeriodId: settings.find((row) => row.serviceType === values.serviceType)!
              .periodId,
          };
          const response = await fetch(path, {
            method: 'PUT',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(change),
          });
          const value: unknown = await response.json().catch(() => null);
          if (!current(owner)) return;
          if (
            response.status === 403 &&
            authErrorCode(value) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code
          ) {
            setPending({
              change,
              owner,
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
            if (response.status === 409) setUnavailable(true);
            setError(t(response.status === 409 ? 'conflict' : 'error', locale));
          } else accepted(value, change, owner);
        },
        (errors) => {
          if (current(owner))
            invalidFocus.current =
              (['serviceType', 'defaultDays'] as const).find((name) => errors[name]) ?? null;
        }
      )(event);
    } catch {
      if (current(owner)) setError(t('error', locale));
    } finally {
      inFlight.current = false;
      if (live.current) setSaving(false);
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
      {loading && <p role="status">{t('loading', locale)}</p>}
      <FormAlert message={error ?? undefined} />
      <Button
        type="button"
        variant="outline"
        disabled={locked}
        onClick={() => setReload((value) => value + 1)}
      >
        {t('load', locale)}
      </Button>
      {settings && (
        <form onSubmit={save} noValidate>
          <FieldSet disabled={locked || unavailable}>
            <FieldGroup className="gap-4 sm:grid sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="due-period-service">{t('service', locale)}</FieldLabel>
                <NativeSelect
                  id="due-period-service"
                  {...draft.bind('serviceType')}
                  value={serviceType}
                  onChange={(event) => {
                    if (inFlight.current || locked || unavailable) return;
                    const next = event.target.value;
                    if (!SERVICE_DUE_PERIOD_TYPES.some((type) => type === next)) return;
                    generation.current++;
                    draft.form.reset({
                      serviceType: next,
                      defaultDays: String(
                        settings.find((row) => row.serviceType === next)!.defaultDays
                      ),
                    });
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
                <FieldFeedback
                  id={draft.errorId('serviceType')}
                  error={draft.errors.serviceType}
                  message={t('invalidService', locale)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="due-period-days">{t('days', locale)}</FieldLabel>
                <Input
                  id="due-period-days"
                  {...draft.bind('defaultDays')}
                  inputMode="numeric"
                  value={days}
                  maxLength={3}
                  onChange={(event) => {
                    setDays(event.target.value);
                    setSaved(false);
                  }}
                />
                <FieldFeedback
                  id={draft.errorId('defaultDays')}
                  error={draft.errors.defaultDays}
                  message={t('invalid', locale)}
                />
              </Field>
            </FieldGroup>
            <FormAlert message={draft.errors.root?.validation?.message} />
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
          </FieldSet>
        </form>
      )}
      {saved && (
        <p role="status" className="text-sm">
          {t('saved', locale)}
        </p>
      )}
      {pending && (
        <TeamActionDialog
          action={pending.action}
          finalFocus={submitButton}
          onClose={() => setPending(null)}
          onDenied={denied}
          onValidationError={(fields) => current(pending.owner) && draft.applyServerErrors(fields)}
          onSuccess={async (value) => accepted(value, pending.change, pending.owner)}
        />
      )}
    </section>
  );
}
