import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { useLocale } from '../hooks/useLocale.js';
import DeadLetterPanel from '../components/DeadLetterPanel.js';
import DeliveryWindowConfigPanel from '../components/DeliveryWindowConfigPanel.js';
import TemplatePreviewPanel from '../components/TemplatePreviewPanel.js';

interface NotificationVariable {
  name: string;
  description: string | null;
}

interface NotificationTemplate {
  id: string;
  eventKey: string;
  channel: 'email' | 'sms' | 'in_app';
  locale: 'fa' | 'en';
  subject: string | null;
  bodyTemplate: string;
  variables: NotificationVariable[];
  status: 'draft' | 'active' | 'archived';
  isActive: boolean;
  version: number;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function responseRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validTemplate(value: unknown): value is NotificationTemplate {
  const row = responseRecord(value);
  return (
    !!row &&
    typeof row.id === 'string' &&
    row.id.trim() !== '' &&
    typeof row.eventKey === 'string' &&
    typeof row.bodyTemplate === 'string' &&
    (row.subject === null || typeof row.subject === 'string') &&
    ['email', 'sms', 'in_app'].includes(String(row.channel)) &&
    ['en', 'fa'].includes(String(row.locale)) &&
    ['draft', 'active', 'archived'].includes(String(row.status)) &&
    typeof row.isActive === 'boolean' &&
    Number.isInteger(row.version) &&
    Number(row.version) > 0 &&
    (row.publishedAt == null || typeof row.publishedAt === 'string') &&
    Array.isArray(row.variables) &&
    row.variables.every((variable) => {
      const v = responseRecord(variable);
      return (
        !!v &&
        typeof v.name === 'string' &&
        (v.description === null || typeof v.description === 'string')
      );
    })
  );
}

function savedTemplate(
  value: unknown,
  status: NotificationTemplate['status'],
  id?: string
): NotificationTemplate {
  if (
    !validTemplate(value) ||
    value.status !== status ||
    value.isActive !== (status === 'active') ||
    (id !== undefined && value.id !== id)
  )
    throw new Error('Invalid template acknowledgement');
  return value;
}

type TemplateChannel = 'email' | 'sms' | 'in_app';
type TemplateLocale = 'fa' | 'en';

const CHANNEL_LABELS: Record<TemplateChannel, string> = {
  email: 'Email',
  sms: 'SMS',
  in_app: 'In-App',
};

const LOCALE_LABELS: Record<TemplateLocale, string> = {
  fa: 'فارسی',
  en: 'English',
};

/**
 * Known notification event keys used in the system.
 * These are the canonical events admin can template.
 */
const KNOWN_EVENT_KEYS = [
  'welcome_email',
  'profile_verified',
  'profile_rejected',
  'password_changed',
  'otp_generated',
  'invoice_available',
  'invoice_paid',
  'invoice_overdue',
  'wallet_credited',
  'wallet_debited',
  'contract_signed',
  'contract_expiring',
  'subscription_renewed',
  'subscription_expired',
  'support_ticket_created',
  'support_ticket_resolved',
  'agent_assigned',
];

const CHANNEL_OPTIONS: TemplateChannel[] = ['email', 'sms', 'in_app'];
const LOCALE_OPTIONS: TemplateLocale[] = ['fa', 'en'];

/** HTML-escape a value for safe display in a rendered template (mirrors server). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Neutral sample values for each allow-listed variable name (preview / test-send). */
function buildSampleData(variables: NotificationVariable[]): Record<string, string> {
  const data: Record<string, string> = {};
  for (const v of variables) {
    const key = v.name.trim();
    if (key)
      data[key] = key
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase();
  }
  return data;
}

/** Select just the allow-listed variable names. */
function variableNames(variables: NotificationVariable[]): string[] {
  return variables.map((v) => v.name.trim()).filter(Boolean);
}

/** Substitute {{variable}} placeholders with escaped sample values.
 * MUST mirror NotificationTemplateService.render() (apps/api) so the client
 * preview matches what the server validates on save — keep in lockstep. */
function renderTemplate(
  template: string,
  variables: NotificationVariable[],
  data?: Record<string, string>
): string {
  const allowed = new Set(variableNames(variables));
  const ctx = data ?? buildSampleData(variables);
  return template.replace(/{{([^{}]+)}}/g, (match, raw: string) => {
    const name = raw.trim();
    if (!allowed.has(name)) return escapeHtml(match);
    const value = ctx[name];
    return escapeHtml(value === undefined ? '' : value);
  });
}

/**
 * Parse the editor's variable textarea/lines into structured variable
 * definitions. Each comma-or-newline-separated entry is either `name` or
 * `name: description`; empty entries and duplicates are dropped and the
 * description defaults to null (legacy template strings round-trip cleanly).
 */
function parseVariablesText(text: string): NotificationVariable[] {
  const out: NotificationVariable[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const colon = entry.indexOf(':');
    const name = (colon === -1 ? entry : entry.slice(0, colon)).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = colon === -1 ? null : entry.slice(colon + 1).trim();
    out.push({ name, description: description || null });
  }
  return out;
}

/** Serialize variable definitions back to the comma-separated text format. */
function variablesToText(variables: NotificationVariable[]): string {
  return variables.map((v) => (v.description ? `${v.name}: ${v.description}` : v.name)).join(', ');
}

/**
 * Admin notification template editor page (T-09.04.01).
 *
 * Lists all notification templates, allows creating/editing drafts,
 * publishing active templates, and unpublishing.
 */
export default function AdminNotificationsPage() {
  const uiLocale = useLocale();
  const numbers = useNumberFormatting(uiLocale);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const listRequest = useRef<AbortController | null>(null);
  const refreshTemplates = useRef<() => Promise<void>>(async () => {});
  const [protectedAction, setProtectedAction] = useState<{
    action: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
  } | null>(null);

  // Filters
  const [filterLocale, setFilterLocale] = useState<string>('');
  const [filterChannel, setFilterChannel] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [eventKey, setEventKey] = useState('');
  const [channel, setChannel] = useState<TemplateChannel>('email');
  const [locale, setLocale] = useState<TemplateLocale>('en');
  const [subject, setSubject] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [variablesStr, setVariablesStr] = useState('');
  const [saving, setSaving] = useState(false);

  // Publish confirm state
  const [publishId, setPublishId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  // Test-send state
  const [testSending, setTestSending] = useState(false);
  const testSendInFlight = useRef(false);
  const editorGeneration = useRef(0);
  const [savedContent, setSavedContent] = useState('');
  const [testSendMsg, setTestSendMsg] = useState<string | null>(null);
  const [testDestination, setTestDestination] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const parsedVariables = parseVariablesText(variablesStr);
  const contentSignature = JSON.stringify([subject, bodyTemplate, variablesStr]);
  const unsavedContent = contentSignature !== savedContent;

  const fetchTemplates = useCallback(async () => {
    listRequest.current?.abort();
    const request = new AbortController();
    listRequest.current = request;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterLocale) params.set('locale', filterLocale);
      if (filterChannel) params.set('channel', filterChannel);
      if (filterStatus) params.set('status', filterStatus);
      const qs = params.toString();
      const res = await fetch(`/api/admin/notifications/templates${qs ? `?${qs}` : ''}`, {
        signal: request.signal,
      });
      if (!res.ok) throw new Error();
      const data: unknown = await res.json();
      if (!Array.isArray(data) || !data.every(validTemplate)) throw new Error();
      if (!request.signal.aborted) {
        setTemplates(data);
        setLoadFailed(false);
      }
    } catch {
      if (!request.signal.aborted) {
        setTemplates([]);
        setLoadFailed(true);
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [filterLocale, filterChannel, filterStatus]);

  useEffect(() => {
    refreshTemplates.current = fetchTemplates;
    void fetchTemplates();
    return () => listRequest.current?.abort();
  }, [fetchTemplates]);

  async function mutateTemplate(
    action: Pick<TeamAction, 'path' | 'method' | 'body'>,
    titleKey: string,
    errorKey: string,
    onSuccess: (result: unknown) => Promise<void>,
    isCurrent: () => boolean = () => true
  ) {
    const payload = action.body === undefined ? undefined : JSON.stringify(action.body);
    const captured = {
      ...action,
      ...(payload === undefined ? {} : { body: JSON.parse(payload) as unknown }),
    };
    const res = await fetch(captured.path, {
      method: captured.method,
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      ...(payload === undefined ? {} : { body: payload }),
    });
    const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (!isCurrent()) return;
    const record = responseRecord(data);
    const code =
      typeof record?.error === 'string' ? record.error : responseRecord(record?.error)?.code;
    if (
      res.status === 403 &&
      (code === 'AUTHZ:STEP_UP_REQUIRED' || record?.requiresStepUp === true)
    ) {
      setProtectedAction({
        action: {
          ...captured,
          title: t(titleKey, uiLocale),
          description: t('admin.notifications.confirmAction', uiLocale),
          requiresPassword: true,
        },
        onSuccess,
      });
      return;
    }
    if (!res.ok) throw new Error(t(errorKey, uiLocale));
    try {
      await onSuccess(data);
    } catch {
      throw new Error(t(errorKey, uiLocale));
    }
  }

  function openCreate() {
    editorGeneration.current++;
    setSavedContent('');
    setViewOnly(false);
    setEditId(null);
    setEventKey(KNOWN_EVENT_KEYS[0]!);
    setChannel('email');
    setLocale('en');
    setSubject('');
    setBodyTemplate('');
    setVariablesStr('');
    setTestSendMsg(null);
    setTestDestination('');
    setShowEditor(true);
  }

  function openEdit(template: NotificationTemplate, copy = false) {
    editorGeneration.current++;
    setSavedContent(
      JSON.stringify([
        template.subject ?? '',
        template.bodyTemplate,
        variablesToText(template.variables),
      ])
    );
    setViewOnly(!copy && (template.status !== 'draft' || template.publishedAt != null));
    setEditId(copy ? null : template.id);
    setEventKey(template.eventKey);
    setChannel(template.channel);
    setLocale(template.locale);
    setSubject(template.subject ?? '');
    setBodyTemplate(template.bodyTemplate);
    setVariablesStr(variablesToText(template.variables));
    setTestSendMsg(null);
    setTestDestination('');
    setShowEditor(true);
  }

  function closeEditor() {
    editorGeneration.current++;
    setShowEditor(false);
    setEditId(null);
  }

  /** Insert a {{variable}} placeholder at the caret position in the body. */
  function insertVariable(variable: string) {
    const el = bodyRef.current;
    if (!el) {
      setBodyTemplate((prev) => `${prev}{{${variable}}}`);
      return;
    }
    const start = el.selectionStart ?? bodyTemplate.length;
    const end = el.selectionEnd ?? bodyTemplate.length;
    const insert = `{{${variable}}}`;
    const next = bodyTemplate.slice(0, start) + insert + bodyTemplate.slice(end);
    setBodyTemplate(next);
    requestAnimationFrame(() => {
      if (el) {
        const pos = start + insert.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  }

  async function handleTestSend() {
    if (!editId || unsavedContent || testSendInFlight.current) {
      setTestSendMsg(null);
      return;
    }
    setError(null);
    testSendInFlight.current = true;
    const generation = editorGeneration.current;
    const expectedChannel = channel;
    setTestSending(true);
    setTestSendMsg(null);
    try {
      const body: Record<string, unknown> = {};
      const dest = testDestination.trim();
      if (dest) body.destination = dest;
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${editId}/test-send`, method: 'POST', body },
        'admin.notifications.testSend',
        'admin.notifications.error.testSend',
        async (result) => {
          if (generation !== editorGeneration.current) return;
          if (
            !result ||
            typeof result !== 'object' ||
            !('ok' in result) ||
            result.ok !== true ||
            !('destination' in result) ||
            result.destination !== expectedChannel ||
            !('lastTestStatus' in result) ||
            result.lastTestStatus !== 'delivered'
          ) {
            throw new Error(t('admin.notifications.error.testSend', uiLocale));
          }
          setTestSendMsg(
            t(
              expectedChannel === 'email'
                ? 'admin.notifications.testSentEmail'
                : expectedChannel === 'sms'
                  ? 'admin.notifications.testSentSms'
                  : 'admin.notifications.testSent',
              uiLocale
            )
          );
        },
        () => generation === editorGeneration.current
      );
    } catch (err) {
      if (generation === editorGeneration.current)
        setError(
          err instanceof Error ? err.message : t('admin.notifications.error.testSend', uiLocale)
        );
    } finally {
      testSendInFlight.current = false;
      setTestSending(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (viewOnly || saving || loadFailed) return;
    setSaving(true);
    setError(null);
    const generation = editorGeneration.current;
    const variables = parseVariablesText(variablesStr);
    const expected = {
      eventKey,
      channel,
      locale,
      bodyTemplate,
      variables,
      subject: subject || null,
    };
    const id = editId;
    try {
      await mutateTemplate(
        {
          path: id
            ? `/api/admin/notifications/templates/${id}`
            : '/api/admin/notifications/templates',
          method: id ? 'PUT' : 'POST',
          body: id
            ? { subject: expected.subject, bodyTemplate, variables }
            : {
                eventKey,
                channel,
                locale,
                bodyTemplate,
                variables,
                ...(subject ? { subject } : {}),
              },
        },
        id ? 'admin.notifications.update' : 'admin.notifications.create',
        'admin.notifications.error.save',
        async (result) => {
          const saved = savedTemplate(result, 'draft', id ?? undefined);
          if (
            saved.eventKey !== expected.eventKey ||
            saved.channel !== expected.channel ||
            saved.locale !== expected.locale ||
            saved.bodyTemplate !== expected.bodyTemplate ||
            (saved.subject ?? null) !== expected.subject ||
            saved.variables.length !== expected.variables.length ||
            saved.variables.some(
              (variable, index) =>
                variable.name !== expected.variables[index]?.name ||
                variable.description !== expected.variables[index]?.description
            )
          )
            throw new Error();
          if (generation === editorGeneration.current) closeEditor();
          await refreshTemplates.current();
        },
        () => generation === editorGeneration.current
      );
    } catch {
      if (generation === editorGeneration.current)
        setError(t('admin.notifications.error.save', uiLocale));
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!publishId || publishing || loadFailed) return;
    setPublishing(true);
    setError(null);
    const id = publishId;
    try {
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}/publish`, method: 'POST' },
        'admin.notifications.publish',
        'admin.notifications.error.publish',
        async (result) => {
          savedTemplate(result, 'active', id);
          setPublishId((current) => (current === id ? null : current));
          await refreshTemplates.current();
        }
      );
    } catch {
      setError(t('admin.notifications.error.publish', uiLocale));
    } finally {
      setPublishing(false);
    }
  }

  async function handleUnpublish(id: string) {
    if (loadFailed || !window.confirm(t('admin.notifications.unpublishConfirm', uiLocale))) return;
    setError(null);
    try {
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}/unpublish`, method: 'POST' },
        'admin.notifications.unpublish',
        'admin.notifications.error.unpublish',
        async (result) => {
          savedTemplate(result, 'archived', id);
          await refreshTemplates.current();
        }
      );
    } catch {
      setError(t('admin.notifications.error.unpublish', uiLocale));
    }
  }

  async function handleDelete(id: string) {
    if (loadFailed || !window.confirm(t('admin.notifications.deleteConfirm', uiLocale))) return;
    setError(null);
    try {
      await mutateTemplate(
        { path: `/api/admin/notifications/templates/${id}`, method: 'DELETE' },
        'admin.notifications.delete',
        'admin.notifications.error.delete',
        async () => {
          await refreshTemplates.current();
        }
      );
    } catch {
      setError(t('admin.notifications.error.delete', uiLocale));
    }
  }

  if (loading && templates.length === 0) {
    return <div className="p-4 text-gray-500">{t('admin.notifications.loading', uiLocale)}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.notifications.title', uiLocale)}</h1>
        {!showEditor && (
          <button
            onClick={openCreate}
            disabled={loading || loadFailed}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('admin.notifications.newTemplate', uiLocale)}
          </button>
        )}
      </div>

      {protectedAction && (
        <TeamActionDialog
          action={protectedAction.action}
          onSuccess={protectedAction.onSuccess}
          onClose={() => setProtectedAction(null)}
        />
      )}
      {loadFailed && (
        <div role="alert" className="rounded border p-3">
          <p>{t('admin.notifications.error.load', uiLocale)}</p>
          <button type="button" disabled={loading} onClick={() => void fetchTemplates()}>
            {t('admin.notifications.retry', uiLocale)}
          </button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative"
        >
          {error}
          <button
            type="button"
            aria-label={t('admin.notifications.dismissError', uiLocale)}
            onClick={() => setError(null)}
            className="absolute top-2 end-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Template preview (T-05.04.03) */}
      <TemplatePreviewPanel uiLocale={uiLocale} templates={templates} loading={loading} />

      {/* Delivery-window config (T-05.03.03) */}
      <DeliveryWindowConfigPanel uiLocale={uiLocale} />

      {/* Dead-letter queue (T-05.01.06) */}
      <DeadLetterPanel uiLocale={uiLocale} />

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <select
          aria-label={t('admin.notifications.locale', uiLocale)}
          value={filterLocale}
          onChange={(e) => setFilterLocale(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allLocales', uiLocale)}</option>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
        <select
          aria-label={t('admin.notifications.channel', uiLocale)}
          value={filterChannel}
          onChange={(e) => setFilterChannel(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allChannels', uiLocale)}</option>
          <option value="email">Email</option>
          <option value="sms">SMS</option>
          <option value="in_app">In-App</option>
        </select>
        <select
          aria-label={t('admin.notifications.allStatus', uiLocale)}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm"
        >
          <option value="">{t('admin.notifications.allStatus', uiLocale)}</option>
          <option value="draft">Draft</option>
          <option value="active">{t('admin.notifications.active', uiLocale)}</option>
          <option value="archived">{t('admin.notifications.archived', uiLocale)}</option>
        </select>
      </div>

      {/* Editor form */}
      {showEditor && (
        <form
          onSubmit={handleSave}
          className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
        >
          <fieldset disabled={saving} className="contents">
            <h2 className="text-lg font-semibold">
              {viewOnly
                ? t('admin.notifications.view', uiLocale)
                : editId
                  ? t('admin.notifications.editTitle', uiLocale)
                  : t('admin.notifications.createTitle', uiLocale)}
            </h2>

            {/* Event key */}
            <div>
              <label
                htmlFor="notification-template-eventKey"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.notifications.eventKey', uiLocale)}{' '}
                <span className="text-red-500">*</span>
              </label>
              {editId ? (
                <input
                  id="notification-template-eventKey"
                  readOnly
                  value={eventKey}
                  className="text-sm text-gray-500 py-2"
                />
              ) : (
                <select
                  id="notification-template-eventKey"
                  value={eventKey}
                  onChange={(e) => setEventKey(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                >
                  {!KNOWN_EVENT_KEYS.includes(eventKey) && (
                    <option value={eventKey}>{eventKey}</option>
                  )}
                  {KNOWN_EVENT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Channel + Locale */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="notification-template-channel"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('admin.notifications.channel', uiLocale)}{' '}
                  <span className="text-red-500">*</span>
                </label>
                {editId ? (
                  <input
                    id="notification-template-channel"
                    readOnly
                    value={CHANNEL_LABELS[channel as TemplateChannel] ?? channel}
                    className="text-sm text-gray-500 py-2"
                  />
                ) : (
                  <select
                    id="notification-template-channel"
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as TemplateChannel)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    required
                  >
                    {CHANNEL_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label
                  htmlFor="notification-template-locale"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('admin.notifications.locale', uiLocale)}{' '}
                  <span className="text-red-500">*</span>
                </label>
                {editId ? (
                  <input
                    id="notification-template-locale"
                    readOnly
                    value={LOCALE_LABELS[locale as TemplateLocale] ?? locale}
                    className="text-sm text-gray-500 py-2"
                  />
                ) : (
                  <select
                    id="notification-template-locale"
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as TemplateLocale)}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    required
                  >
                    {LOCALE_OPTIONS.map((l) => (
                      <option key={l} value={l}>
                        {LOCALE_LABELS[l]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Subject (email only) */}
            {channel === 'email' && (
              <div>
                <label
                  htmlFor="notification-template-subject"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  {t('admin.notifications.subject', uiLocale)}
                </label>
                <input
                  type="text"
                  id="notification-template-subject"
                  readOnly={viewOnly || testSending}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="e.g. Your profile has been verified"
                  maxLength={200}
                />
              </div>
            )}

            {/* Body template + variable sidebar + preview */}
            <div>
              <label
                htmlFor="notification-template-bodyTemplate"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.notifications.bodyTemplate', uiLocale)}{' '}
                <span className="text-red-500">*</span>
              </label>
              <p id="notification-body-hint" className="text-xs text-gray-400 mb-1">
                {t('admin.notifications.bodyHint', uiLocale)}
              </p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <textarea
                    aria-describedby="notification-body-hint"
                    ref={bodyRef}
                    id="notification-template-bodyTemplate"
                    readOnly={viewOnly || testSending}
                    value={bodyTemplate}
                    onChange={(e) => setBodyTemplate(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                    rows={8}
                    required
                    dir={locale === 'fa' ? 'rtl' : 'ltr'}
                  />
                </div>
                {parsedVariables.length > 0 && (
                  <aside className="w-48 shrink-0 border border-gray-200 rounded-lg p-3 bg-gray-50">
                    <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                      {t('admin.notifications.variables', uiLocale)}
                    </h4>
                    <p className="text-[11px] text-gray-400 mb-2">
                      {t('admin.notifications.insertHint', uiLocale)}
                    </p>
                    <ul className="space-y-1">
                      {parsedVariables.map((v) => (
                        <li key={v.name}>
                          <button
                            type="button"
                            disabled={viewOnly || testSending}
                            onClick={() => insertVariable(v.name)}
                            className="w-full text-left px-2 py-1 text-xs font-mono bg-white border border-gray-200 rounded hover:bg-blue-50 hover:border-blue-300"
                            title={v.description ?? undefined}
                          >
                            {'{{'}
                            {v.name}
                            {'}}'}
                          </button>
                          {v.description && (
                            <p className="px-1 pt-0.5 text-[11px] text-gray-500 leading-snug">
                              {v.description}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}
              </div>
              {/* Live preview pane */}
              <div className="mt-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h4 className="text-xs font-semibold text-gray-600 mb-2 uppercase">
                  {t('admin.notifications.preview', uiLocale)}
                </h4>
                {channel === 'email' && subject.trim() !== '' && (
                  <p className="text-sm text-gray-700 mb-2" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
                    <span className="font-semibold">
                      {t('admin.notifications.subjectLabel', uiLocale)}
                    </span>{' '}
                    {renderTemplate(subject, parsedVariables)}
                  </p>
                )}
                <pre
                  className="text-sm whitespace-pre-wrap font-sans text-gray-800"
                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                >
                  {renderTemplate(bodyTemplate, parsedVariables)}
                </pre>
              </div>
            </div>

            {/* Variables (allow-list: names + optional descriptions) */}
            <div>
              <label
                htmlFor="notification-template-variablesLabel"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.notifications.variablesLabel', uiLocale)}
              </label>
              <p className="text-xs text-gray-400 mb-1">
                {t('admin.notifications.variablesHintNew', uiLocale)}
              </p>
              <textarea
                id="notification-template-variablesLabel"
                readOnly={viewOnly || testSending}
                value={variablesStr}
                onChange={(e) => setVariablesStr(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                rows={3}
                placeholder="userName: The user's display name, profileLink: Verification link"
                dir="ltr"
              />
            </div>

            {/* Save / Cancel */}
            <div className="flex gap-3 items-center">
              {editId && (
                <>
                  <div className="flex flex-col gap-1">
                    <label htmlFor="test-destination" className="text-xs text-gray-500">
                      {t('admin.notifications.testDestinationLabel', uiLocale)}
                    </label>
                    <input
                      id="test-destination"
                      disabled={testSending}
                      type="text"
                      value={testDestination}
                      onChange={(e) => {
                        setTestSendMsg(null);
                        setTestDestination(e.target.value);
                      }}
                      placeholder={t('admin.notifications.testDestinationPlaceholder', uiLocale)}
                      className="border border-gray-300 rounded px-3 py-2 text-sm"
                      dir="ltr"
                    />
                    <span className="text-xs text-gray-400">
                      {t('admin.notifications.testDestinationHint', uiLocale)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSend}
                    disabled={testSending || saving || unsavedContent}
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                  >
                    {testSending
                      ? t('admin.notifications.sending', uiLocale)
                      : t('admin.notifications.testSend', uiLocale)}
                  </button>
                  {unsavedContent && (
                    <span className="text-sm text-amber-700">
                      {t('admin.notifications.saveBeforeTest', uiLocale)}
                    </span>
                  )}
                  {testSendMsg && !unsavedContent && (
                    <span className="text-sm text-green-600">{testSendMsg}</span>
                  )}
                </>
              )}
              <button
                type="submit"
                disabled={saving || viewOnly || testSending || loadFailed}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving
                  ? t('admin.notifications.saving', uiLocale)
                  : editId
                    ? t('admin.notifications.update', uiLocale)
                    : t('admin.notifications.create', uiLocale)}
              </button>
              <button
                type="button"
                onClick={closeEditor}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
              >
                {t('admin.notifications.cancel', uiLocale)}
              </button>
            </div>
          </fieldset>
        </form>
      )}

      {/* Publish confirm dialog */}
      {publishId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">{t('admin.notifications.publishTitle', uiLocale)}</h3>
          <p className="text-sm text-gray-600">{t('admin.notifications.publishDesc', uiLocale)}</p>
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {publishing
                ? t('admin.notifications.publishing', uiLocale)
                : t('admin.notifications.publish', uiLocale)}
            </button>
            <button
              onClick={() => setPublishId(null)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              {t('admin.notifications.cancel', uiLocale)}
            </button>
          </div>
        </div>
      )}

      {/* Template list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.col.event', uiLocale)}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.channel', uiLocale)}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.locale', uiLocale)}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.col.status', uiLocale)}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.col.subject', uiLocale)}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.col.active', uiLocale)}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                {t('admin.notifications.col.actions', uiLocale)}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  {t('admin.notifications.empty', uiLocale)}
                </td>
              </tr>
            )}
            {templates.map((template) => (
              <tr key={template.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-mono">
                  {template.eventKey}
                  <div className="text-xs text-gray-500">
                    {t('admin.notifications.preview.version', uiLocale)}{' '}
                    {numbers.number(template.version)}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      template.channel === 'email'
                        ? 'bg-blue-100 text-blue-800'
                        : template.channel === 'sms'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {CHANNEL_LABELS[template.channel]}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={template.locale === 'fa' ? 'font-medium' : ''}>
                    {LOCALE_LABELS[template.locale]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      template.status === 'draft'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {template.status === 'archived'
                      ? t('admin.notifications.archived', uiLocale)
                      : template.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 max-w-[200px] truncate">
                  {template.subject ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {template.isActive ? (
                    <span className="text-green-600 text-sm font-medium">
                      ✓ {t('admin.notifications.active', uiLocale)}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  {template.status === 'draft' && template.publishedAt == null && (
                    <>
                      <button
                        onClick={() => openEdit(template)}
                        className="text-blue-600 hover:underline"
                      >
                        {t('admin.notifications.edit', uiLocale)}
                      </button>
                      <button
                        onClick={() => setPublishId(template.id)}
                        className="text-green-600 hover:underline"
                      >
                        {t('admin.notifications.publish', uiLocale)}
                      </button>
                      <button
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:underline"
                      >
                        {t('admin.notifications.delete', uiLocale)}
                      </button>
                    </>
                  )}
                  {(template.status !== 'draft' || template.publishedAt != null) && (
                    <>
                      <button
                        onClick={() => openEdit(template)}
                        className="text-blue-600 hover:underline"
                      >
                        {t('admin.notifications.view', uiLocale)}
                      </button>
                      <button
                        onClick={() => openEdit(template, true)}
                        className="text-blue-600 hover:underline"
                      >
                        {t('admin.notifications.newVersion', uiLocale)}
                      </button>
                      {template.status === 'active' && (
                        <button
                          onClick={() => handleUnpublish(template.id)}
                          className="text-orange-600 hover:underline"
                        >
                          {t('admin.notifications.unpublish', uiLocale)}
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
