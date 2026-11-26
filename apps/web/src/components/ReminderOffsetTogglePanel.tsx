import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { Alert, AlertDescription, Button, Input, cn } from '@barghsa/ui';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys, type ServerQueryKey } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import {
  INVOICE_REMINDER_OFFSETS,
  SERVICE_DUE_PERIOD_TYPES,
} from '@barghsa/shared/finance/browser';
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useId,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import type { Locale } from '@barghsa/i18n/app';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  type InvoiceReminderOffset,
  type ReminderOffsetToggleDto,
  type ServiceDuePeriodType,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { RecordListSkeleton } from './RecordListSkeleton.js';
import { withCsrf } from '../lib/csrf.js';
import {
  InvoiceTimingServiceList,
  type InvoiceTimingPanelProps,
} from './InvoiceTimingServiceList.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';

/**
 * Admin reminder-offset toggle panel (T-04.1.04.05).
 *
 * Each switch saves independently. Missing pairs default to enabled on the API.
 */

const OFFSET_KEY: Record<InvoiceReminderOffset, string> = {
  [-7]: 'admin.invoices.reminders.offset.m7',
  [-3]: 'admin.invoices.reminders.offset.m3',
  [-1]: 'admin.invoices.reminders.offset.m1',
  [0]: 'admin.invoices.reminders.offset.0',
  [1]: 'admin.invoices.reminders.offset.p1',
  [7]: 'admin.invoices.reminders.offset.p7',
};

function serviceKey(serviceType: ServiceDuePeriodType): string {
  return `admin.invoices.reminders.service.${serviceType}`;
}

function toggleKey(serviceType: ServiceDuePeriodType, offset: InvoiceReminderOffset): string {
  return `${serviceType}:${offset}`;
}

function isEnabled(
  toggles: ReminderOffsetToggleDto[],
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset
): boolean {
  return (
    toggles.find((row) => row.serviceType === serviceType && row.offset === offset)?.enabled ?? true
  );
}

/** Patch a single cell. Never replace the rest of the matrix from a request snapshot. */
function patchCell(
  current: ReminderOffsetToggleDto[],
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
  enabled: boolean
): ReminderOffsetToggleDto[] {
  let found = false;
  const next = current.map((row) => {
    if (row.serviceType === serviceType && row.offset === offset) {
      found = true;
      return { ...row, enabled };
    }
    return row;
  });
  return found ? next : [...next, { serviceType, offset, enabled }];
}

type PendingToggle = {
  serviceType: ServiceDuePeriodType;
  offset: InvoiceReminderOffset;
  enabled: boolean;
  previousEnabled: boolean;
};

type SaveResult =
  | { kind: 'ok'; enabled: boolean }
  | { kind: 'step_up' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }
  | { kind: 'unconfirmed'; message: string };

function validMatrix(value: unknown, complete: boolean): value is ReminderOffsetToggleDto[] {
  return (
    Array.isArray(value) &&
    (!complete ||
      value.length === SERVICE_DUE_PERIOD_TYPES.length * INVOICE_REMINDER_OFFSETS.length) &&
    value.every(
      (row) =>
        row &&
        SERVICE_DUE_PERIOD_TYPES.includes(row.serviceType) &&
        INVOICE_REMINDER_OFFSETS.includes(row.offset) &&
        typeof row.enabled === 'boolean'
    ) &&
    new Set(value.map((row) => toggleKey(row.serviceType, row.offset))).size === value.length
  );
}

function readErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as { error?: unknown; requiresStepUp?: unknown };
  if (typeof rec.error === 'string') return rec.error;
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { code?: unknown };
    if (typeof nested.code === 'string') return nested.code;
  }
  if (rec.requiresStepUp === true) return ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code;
  return null;
}

function errorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const rec = data as { message?: unknown; error?: unknown };
  if (typeof rec.message === 'string' && rec.message) return rec.message;
  if (rec.error && typeof rec.error === 'object') {
    const nested = rec.error as { message?: unknown };
    if (typeof nested.message === 'string' && nested.message) return nested.message;
  }
  if (typeof rec.error === 'string' && rec.error) return rec.error;
  return fallback;
}

function isStepUpRequired(res: Response, data: unknown): boolean {
  return res.status === 403 && readErrorCode(data) === ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code;
}

async function saveToggle(
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset,
  enabled: boolean,
  fallback: string,
  owner: AbortSignal
): Promise<SaveResult> {
  try {
    const { res, data } = await readWithDeadline(owner, async (signal) => {
      const res = await fetch('/api/admin/config/invoice-reminder-offsets', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ serviceType, offset, enabled }),
        signal,
      });
      const data: unknown = await res.json().catch(() => null);
      return { res, data };
    });
    if (isStepUpRequired(res, data)) return { kind: 'step_up' };
    if (res.status === 401 || res.status === 403) return { kind: 'denied' };
    if (!res.ok)
      return {
        kind: res.status >= 500 ? 'unconfirmed' : 'error',
        message: errorMessage(data, fallback),
      };
    const matrix = Array.isArray(data) ? (data as ReminderOffsetToggleDto[]) : [];
    const saved = matrix.filter((row) => row?.serviceType === serviceType && row.offset === offset);
    if (saved.length !== 1 || saved[0]?.enabled !== enabled)
      return { kind: 'unconfirmed', message: fallback };
    return { kind: 'ok', enabled };
  } catch {
    return { kind: 'unconfirmed', message: fallback };
  }
}

async function verifyStepUp(password: string, owner: AbortSignal): Promise<Response> {
  return readWithDeadline(owner, (signal) =>
    fetch('/api/auth/step-up', {
      method: 'POST',
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ password }),
      signal,
    })
  );
}

function ariaLabel(
  locale: Locale,
  serviceType: ServiceDuePeriodType,
  offset: InvoiceReminderOffset
): string {
  return t('admin.invoices.reminders.toggleAria', locale)
    .replace('{offset}', t(OFFSET_KEY[offset], locale))
    .replace('{service}', t(serviceKey(serviceType), locale));
}

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getTabbable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.matches(':disabled, [aria-disabled="true"]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

/** Mark every sibling from `keep` up to `document.body` as inert so the page cannot be tabbed. */
function inertOutside(keep: HTMLElement): () => void {
  const applied: HTMLElement[] = [];
  let current: HTMLElement | null = keep;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || !(sibling instanceof HTMLElement)) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      applied.push(sibling);
    }
    current = parent;
  }
  return () => {
    for (const el of applied) el.removeAttribute('inert');
  };
}

export default function ReminderOffsetTogglePanel(props: InvoiceTimingPanelProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedReminderOffsetTogglePanel
      key={JSON.stringify([actor, revision, props.service])}
      {...props}
    />
  );
}
function OwnedReminderOffsetTogglePanel({ onLocked, search, service }: InvoiceTimingPanelProps) {
  const locale = useLocale();
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const client = useQueryClient();
  const reader = useId();
  const identity = JSON.stringify([actor, profileRevision, locale]);
  const latest = useRef(identity);
  latest.current = identity;
  const alive = useRef(true);
  const sequence = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const writes = useRef(new Set<AbortController>());
  useEffect(() => {
    alive.current = true;
    const owned = requests.current;
    return () => {
      alive.current = false;
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, [client, identity]);
  useEffect(() => {
    const owned = writes.current;
    return () => {
      for (const controller of owned) controller.abort();
      owned.clear();
    };
  }, []);
  const isRtl = locale === 'fa';
  const [toggles, setToggles] = useState<ReminderOffsetToggleDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const recovery = useRef(false);
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingKeysRef = useRef(new Set<string>());
  const awaitingStepUpRef = useRef<PendingToggle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [awaitingStepUp, setAwaitingStepUp] = useState<PendingToggle[]>([]);
  const stepUpOpen = awaitingStepUp.length > 0;
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [stepUpSubmitting, setStepUpSubmitting] = useState(false);
  const stepUpDialogRef = useRef<HTMLDivElement | null>(null);
  const stepUpPasswordRef = useRef<HTMLInputElement | null>(null);
  const stepUpTriggerRef = useRef<HTMLInputElement | null>(null);
  const restoreTriggerRef = useRef(false);
  const stepUpSubmittingRef = useRef(false);
  const writePending = pendingKeys.size > 0 || stepUpOpen || stepUpSubmitting;
  useEffect(() => {
    onLocked?.(writePending);
    return () => onLocked?.(false);
  }, [onLocked, writePending]);

  function markPending(key: string, pending: boolean) {
    if (pending) pendingKeysRef.current.add(key);
    else pendingKeysRef.current.delete(key);
    setPendingKeys(new Set(pendingKeysRef.current));
  }

  function revertToggle(item: PendingToggle) {
    setToggles((current) =>
      current ? patchCell(current, item.serviceType, item.offset, item.previousEnabled) : current
    );
    markPending(toggleKey(item.serviceType, item.offset), false);
  }

  function ownsWrite(controller: AbortController) {
    return !controller.signal.aborted && getProfileContextRevision() === profileRevision;
  }

  const denied = useCallback(() => {
    for (const controller of writes.current) controller.abort();
    writes.current.clear();
    pendingKeysRef.current.clear();
    awaitingStepUpRef.current = [];
    stepUpSubmittingRef.current = false;
    stepUpTriggerRef.current = null;
    restoreTriggerRef.current = false;
    recovery.current = false;
    setPendingKeys(new Set());
    setAwaitingStepUp([]);
    setStepUpSubmitting(false);
    setStepUpPassword('');
    setStepUpError(null);
    setUnconfirmed(false);
    setRecorded(false);
    setToggles(null);
    setLoadFailed(true);
    setError(t('admin.invoices.reminders.loadFailed', locale));
  }, [locale]);

  async function persistToggle(item: PendingToggle): Promise<'step_up' | 'done'> {
    if (recovery.current) {
      revertToggle(item);
      return 'done';
    }
    const fallback = t('admin.invoices.reminders.saveFailed', locale);
    const controller = new AbortController();
    writes.current.add(controller);
    try {
      const result = await saveToggle(
        item.serviceType,
        item.offset,
        item.enabled,
        fallback,
        controller.signal
      );
      if (!ownsWrite(controller)) return 'done';
      if (result.kind === 'denied') {
        denied();
        return 'done';
      }
      if (result.kind === 'step_up') {
        if (!recovery.current) return 'step_up';
        revertToggle(item);
        return 'done';
      }
      if (result.kind === 'error' || result.kind === 'unconfirmed') {
        revertToggle(item);
        setError(result.message);
        if (result.kind === 'unconfirmed') {
          recovery.current = true;
          setUnconfirmed(true);
          setRecorded(false);
        }
        return 'done';
      }
      setToggles((current) =>
        current ? patchCell(current, item.serviceType, item.offset, result.enabled) : current
      );
      markPending(toggleKey(item.serviceType, item.offset), false);
      if (alive.current && latest.current === identity) setRecorded(true);
      return 'done';
    } finally {
      writes.current.delete(controller);
    }
  }

  const load = useCallback(async () => {
    if (pendingKeysRef.current.size || stepUpSubmittingRef.current) return;
    for (const pending of requests.current) pending.abort();
    const controller = new AbortController();
    requests.current.add(controller);
    const queryKey: ServerQueryKey = [
      ...queryKeys.catalogue.detail(
        {
          context: 'staff',
          ownerId: actor ?? 'staff-session',
          accountId: actor,
          revision: profileRevision,
        },
        '/api/admin/config/invoice-reminder-offsets'
      ),
      JSON.stringify([reader, locale, ++sequence.current]),
    ];
    const cancel = () => void client.cancelQueries({ queryKey, exact: true });
    controller.signal.addEventListener('abort', cancel, { once: true });
    const current = () =>
      alive.current && latest.current === identity && !controller.signal.aborted;
    try {
      setLoading(true);
      const data = await client.fetchQuery({
        queryKey,
        staleTime: 0,
        gcTime: 0,
        retry: false,
        queryFn: ({ signal: ownerSignal }) =>
          readWithDeadline(ownerSignal, async (signal) => {
            const res = await fetch('/api/admin/config/invoice-reminder-offsets', { signal });
            if (res.status === 401 || res.status === 403) throw new ServerQueryError(res.status);
            if (!res.ok) throw new Error('Reminder settings read failed');
            const data: unknown = await res.json();
            if (!validMatrix(data, recovery.current)) throw new Error('Invalid reminder settings');
            if (!current() || signal.aborted) throw new Error('Obsolete reminder read');
            return data;
          }),
      });
      if (!current()) return;
      setToggles(data);
      recovery.current = false;
      setUnconfirmed(false);
      setLoadFailed(false);
      setError(null);
    } catch (err) {
      if (!current()) return;
      if (err instanceof ServerQueryError) {
        denied();
        return;
      }
      setLoadFailed(true);
      setError(t('admin.invoices.reminders.loadFailed', locale));
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      requests.current.delete(controller);
      if (current()) setLoading(false);
    }
  }, [client, identity, reader, actor, profileRevision, locale, denied]);

  useEffect(() => {
    if (!recovery.current) void load();
  }, [load]);

  useEffect(() => {
    if (!stepUpOpen) return;
    const dialog = stepUpDialogRef.current;
    if (!dialog) return;
    const releaseInert = inertOutside(dialog);
    stepUpPasswordRef.current?.focus();
    return () => {
      releaseInert();
    };
  }, [stepUpOpen]);

  useEffect(() => {
    if (stepUpOpen || !restoreTriggerRef.current) return;
    const trigger = stepUpTriggerRef.current;
    if (!trigger || trigger.disabled) return;
    restoreTriggerRef.current = false;
    stepUpTriggerRef.current = null;
    trigger.focus();
  }, [stepUpOpen, pendingKeys, unconfirmed, loading]);

  async function handleToggle(
    serviceType: ServiceDuePeriodType,
    offset: InvoiceReminderOffset,
    enabled: boolean,
    trigger: HTMLInputElement
  ) {
    if (!toggles || loading || requests.current.size || loadFailed || recovery.current) return;
    const key = toggleKey(serviceType, offset);
    if (pendingKeysRef.current.has(key)) return;
    const previousEnabled = isEnabled(toggles, serviceType, offset);
    markPending(key, true);
    setToggles((current) => (current ? patchCell(current, serviceType, offset, enabled) : current));
    setError(null);
    setRecorded(false);
    const item: PendingToggle = { serviceType, offset, enabled, previousEnabled };
    const outcome = await persistToggle(item);
    if (outcome === 'step_up') {
      const next = [...awaitingStepUpRef.current, item];
      awaitingStepUpRef.current = next;
      if (!stepUpTriggerRef.current) stepUpTriggerRef.current = trigger;
      restoreTriggerRef.current = true;
      setAwaitingStepUp(next);
    }
  }

  function cancelStepUp() {
    if (stepUpSubmittingRef.current) return;
    const pending = awaitingStepUpRef.current;
    awaitingStepUpRef.current = [];
    for (const item of pending) revertToggle(item);
    setAwaitingStepUp([]);
    setStepUpPassword('');
    setStepUpError(null);
    setStepUpSubmitting(false);
  }

  async function submitStepUp(event: FormEvent) {
    event.preventDefault();
    if (!stepUpPassword.trim() || stepUpSubmittingRef.current || recovery.current) return;
    const controller = new AbortController();
    writes.current.add(controller);
    stepUpSubmittingRef.current = true;
    setStepUpSubmitting(true);
    setStepUpError(null);
    try {
      const response = await verifyStepUp(stepUpPassword, controller.signal);
      if (!ownsWrite(controller)) return;
      if (response.status === 401) {
        denied();
        return;
      }
      if (!response.ok) {
        setStepUpError(t('admin.invoices.reminders.stepUp.failed', locale));
        return;
      }
      const pending = awaitingStepUpRef.current;
      awaitingStepUpRef.current = [];
      setAwaitingStepUp([]);
      setStepUpPassword('');
      for (const item of pending) {
        if (!ownsWrite(controller)) return;
        const outcome = await persistToggle(item);
        if (outcome === 'step_up') {
          revertToggle(item);
          setError(t('admin.invoices.reminders.saveFailed', locale));
        }
      }
    } catch {
      if (ownsWrite(controller)) {
        setStepUpPassword('');
        setStepUpError(t('admin.invoices.reminders.stepUp.failed', locale));
      }
    } finally {
      writes.current.delete(controller);
      if (ownsWrite(controller)) {
        stepUpSubmittingRef.current = false;
        setStepUpSubmitting(false);
      }
    }
  }

  if (loading && !toggles) {
    return (
      <RecordListSkeleton
        label={t('admin.invoices.reminders.loading', locale)}
        view="card"
        headings={[]}
      />
    );
  }

  return (
    <section
      className={`${recordEditorSurface} scroll-mt-28 text-card-foreground`}
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-labelledby="reminder-offset-heading"
    >
      <header className="space-y-1 border-b bg-muted/25 px-4 py-3.5 sm:px-6">
        <h2 id="reminder-offset-heading" className="text-base font-semibold">
          {t(
            service ? 'admin.invoices.reminders.schedule' : 'admin.invoices.reminders.serviceCol',
            locale
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            service
              ? 'admin.invoices.reminders.scheduleHelp'
              : 'admin.invoices.tools.remindersHelp',
            locale
          )}
        </p>
      </header>

      {(error || unconfirmed) && (
        <div className="px-4 pt-3 sm:px-6">
          <Alert variant="destructive" role="group" className="gap-2.5">
            <AlertDescription className="space-y-1">
              {unconfirmed && <p role="status">{confirmationText('unconfirmed', locale)}</p>}
              {error && <p role="alert">{error}</p>}
            </AlertDescription>
            {(loadFailed || unconfirmed) && (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={loading || pendingKeys.size > 0 || stepUpSubmitting}
                onClick={() => void load()}
              >
                {t('admin.invoices.reminders.reload', locale)}
              </Button>
            )}
          </Alert>
        </div>
      )}

      {toggles && !service && (
        <InvoiceTimingServiceList
          section="reminders"
          search={search}
          disabled={loading || loadFailed || unconfirmed}
          summary={(id) =>
            t('admin.invoices.reminders.activeCount', locale)
              .replace(
                '{count}',
                INVOICE_REMINDER_OFFSETS.filter((offset) =>
                  isEnabled(toggles, id, offset)
                ).length.toLocaleString(locale)
              )
              .replace('{total}', INVOICE_REMINDER_OFFSETS.length.toLocaleString(locale))
          }
        />
      )}

      {toggles && service && (
        <>
          <ul className="divide-y">
            {INVOICE_REMINDER_OFFSETS.map((offset) => {
              const enabled = isEnabled(toggles, service, offset);
              const busy = pendingKeys.has(toggleKey(service, offset));
              return (
                <li key={offset}>
                  <label className="touch-label relative flex min-h-12 items-center justify-between gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/40 sm:px-6">
                    <input
                      type="checkbox"
                      role="switch"
                      data-testid={`reminder-toggle-${service}-${offset}`}
                      aria-label={ariaLabel(locale, service, offset)}
                      aria-checked={enabled}
                      aria-busy={busy}
                      checked={enabled}
                      disabled={busy || loading || loadFailed || unconfirmed}
                      onChange={(event) =>
                        handleToggle(service, offset, event.target.checked, event.currentTarget)
                      }
                      className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                    />
                    <span className="font-medium" aria-hidden="true">
                      {t(OFFSET_KEY[offset], locale)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'pointer-events-none inline-flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-foreground peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50',
                        enabled
                          ? 'justify-end border-primary bg-primary text-primary-foreground'
                          : 'justify-start border-input bg-muted text-muted-foreground'
                      )}
                    >
                      <span className="size-3.5 rounded-full bg-current" />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <p
            role="status"
            className={recorded && !error ? 'border-t px-4 py-2.5 text-sm sm:px-6' : 'sr-only'}
          >
            {recorded && !error ? confirmationText('recorded', locale) : ''}
          </p>
        </>
      )}

      {stepUpOpen && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog handles bubbled Escape/Tab and backdrop dismissal; controls remain keyboard accessible.
        <div
          ref={stepUpDialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 supports-backdrop-filter:backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reminder-step-up-title"
          aria-describedby="reminder-step-up-description"
          data-testid="reminder-step-up-dialog"
          tabIndex={-1}
          onClick={(event) => {
            if (event.target === event.currentTarget && !stepUpSubmitting) cancelStepUp();
          }}
          onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
              if (stepUpSubmittingRef.current) return;
              event.preventDefault();
              cancelStepUp();
              return;
            }
            if (event.key !== 'Tab') return;
            const tabbable = getTabbable(event.currentTarget);
            if (tabbable.length === 0) {
              event.preventDefault();
              event.currentTarget.focus();
              return;
            }
            const active = document.activeElement;
            const index = tabbable.indexOf(active as HTMLElement);
            event.preventDefault();
            if (event.shiftKey) {
              const next = index <= 0 ? tabbable[tabbable.length - 1]! : tabbable[index - 1]!;
              next.focus();
              return;
            }
            const next =
              index === -1 || index >= tabbable.length - 1 ? tabbable[0]! : tabbable[index + 1]!;
            next.focus();
          }}
        >
          <form
            className={cn(
              recordEditorSurface,
              'max-h-full w-full max-w-md overflow-y-auto bg-popover text-popover-foreground shadow-xl'
            )}
            onSubmit={submitStepUp}
          >
            <header className="space-y-1 border-b bg-muted/25 px-4 py-3.5 sm:px-6">
              <h3 id="reminder-step-up-title" className="text-base font-semibold text-foreground">
                {t('admin.invoices.reminders.stepUp.title', locale)}
              </h3>
              <p id="reminder-step-up-description" className="text-sm text-muted-foreground">
                {t('admin.invoices.reminders.stepUp.description', locale)}
              </p>
            </header>
            <div className="space-y-3 px-4 py-3.5 sm:px-6">
              <ul className="divide-y rounded-lg border bg-muted/25 px-3 text-sm">
                {awaitingStepUp.map((item) => (
                  <li
                    key={toggleKey(item.serviceType, item.offset)}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2"
                  >
                    <span>
                      {t(serviceKey(item.serviceType), locale)} ·{' '}
                      {t(OFFSET_KEY[item.offset], locale)}
                    </span>
                    <span className="font-medium">
                      {t(
                        item.enabled
                          ? 'admin.invoices.reminders.enabled'
                          : 'admin.invoices.reminders.disabled',
                        locale
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1.5">
                <label
                  htmlFor="reminder-step-up-password"
                  className="block text-sm font-medium text-foreground"
                >
                  {t('admin.invoices.reminders.stepUp.passwordLabel', locale)}
                </label>
                <Input
                  ref={stepUpPasswordRef}
                  id="reminder-step-up-password"
                  data-testid="reminder-step-up-password"
                  type="password"
                  autoComplete="current-password"
                  aria-required="true"
                  aria-describedby={stepUpError ? 'reminder-step-up-error' : undefined}
                  value={stepUpPassword}
                  disabled={stepUpSubmitting}
                  placeholder={t('admin.invoices.reminders.stepUp.passwordPlaceholder', locale)}
                  onChange={(event) => {
                    setStepUpPassword(event.target.value);
                    setStepUpError(null);
                  }}
                />
                {stepUpError && (
                  <p id="reminder-step-up-error" className="text-sm text-destructive" role="alert">
                    {stepUpError}
                  </p>
                )}
              </div>
            </div>
            <RecordEditorActions>
              <Button
                type="button"
                variant="secondary"
                data-testid="reminder-step-up-cancel"
                disabled={stepUpSubmitting}
                onClick={cancelStepUp}
              >
                {t('admin.invoices.reminders.stepUp.cancel', locale)}
              </Button>
              <Button
                type="submit"
                data-testid="reminder-step-up-submit"
                disabled={stepUpSubmitting || unconfirmed || !stepUpPassword.trim()}
              >
                {stepUpSubmitting
                  ? t('admin.invoices.reminders.stepUp.verifying', locale)
                  : t('admin.invoices.reminders.stepUp.submit', locale)}
              </Button>
            </RecordEditorActions>
          </form>
        </div>
      )}
    </section>
  );
}
