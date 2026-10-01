import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useState, useEffect } from 'react';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { t } from '@barghsa/i18n/admin-ui';
import type { Locale } from '@barghsa/i18n/app';
import BrandedEmailPreview from './BrandedEmailPreview.js';
import {
  renderTemplatePreview,
  buildSampleData,
  type TemplateVariable,
} from '../lib/template-preview.js';

/**
 * Template preview panel (E-05, T-05.04.03).
 *
 * Lets an admin select a notification template by event key, language,
 * channel, and version, then see the rendered subject and body using neutral
 * sample data. It lists the template's allow-listed variables with their
 * descriptions and highlights two kinds of problems:
 *
 *  - Undeclared variables: `{{name}}` placeholders used in the template body
 *    that are NOT in the template's allow-list. Rendered as their literal text
 *    and surfaced as a warning (these are the "missing required variables").
 *  - Missing required variables: allow-listed variables that this preview
 *    could not supply a value for (only occurs when a caller passes explicit
 *    sample data that omits the variable).
 *
 * The panel does not write anything; it only previews stored templates.
 */
export interface TemplateVersionSummary {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  isActive: boolean;
  publishedAt: string | null;
  subject: string | null;
  bodyTemplate: string;
  variables: TemplateVariable[];
}

export interface NotificationTemplateForPreview {
  id: string;
  eventKey: string;
  channel: 'email' | 'sms' | 'in_app';
  locale: 'fa' | 'en';
  version: number;
  status: 'draft' | 'active' | 'archived';
  isActive: boolean;
  publishedAt: string | null;
  subject: string | null;
  bodyTemplate: string;
  variables: TemplateVariable[];
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

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
};

interface TemplatePreviewPanelProps {
  uiLocale: Locale;
  templates: NotificationTemplateForPreview[];
  loading?: boolean;
  ready?: boolean;
  queries?: ListQueryBinding | undefined;
}

export default function TemplatePreviewPanel({
  uiLocale,
  templates,
  loading,
  ready = !loading,
  queries,
}: TemplatePreviewPanelProps) {
  const numbers = useNumberFormatting(uiLocale);
  // Selection state (filters)
  const [localEvent, setEventKey] = useState<string>('');
  const [localChannel, setChannel] = useState<TemplateChannel | ''>('');
  const [localLocale, setLocale] = useState<TemplateLocale | ''>('');
  const [localVersion, setVersionId] = useState<string>('');
  const eventKey = queries ? queries.query.filters.event || '' : localEvent;
  const channel = queries ? queries.query.filters.channel || '' : localChannel;
  const locale = queries ? queries.query.filters.locale || '' : localLocale;
  const versionId = queries ? queries.query.filters.version || '' : localVersion;
  const update = (filters: Record<string, string>, replace = false) => {
    if (queries) queries.setQuery({ filters }, replace);
    else {
      if ('event' in filters) setEventKey(filters.event);
      if ('channel' in filters) setChannel(filters.channel as TemplateChannel | '');
      if ('locale' in filters) setLocale(filters.locale as TemplateLocale | '');
      if ('version' in filters) setVersionId(filters.version);
    }
  };

  const eventKeys = [...new Set(templates.map((tp) => tp.eventKey))].sort();

  const channels: TemplateChannel[] =
    eventKey === ''
      ? (['email', 'sms', 'in_app'] as TemplateChannel[])
      : ([
          ...new Set(templates.filter((tp) => tp.eventKey === eventKey).map((tp) => tp.channel)),
        ] as TemplateChannel[]);

  const locales: TemplateLocale[] =
    eventKey === '' || channel === ''
      ? (['fa', 'en'] as TemplateLocale[])
      : ([
          ...new Set(
            templates
              .filter((tp) => tp.eventKey === eventKey && tp.channel === channel)
              .map((tp) => tp.locale)
          ),
        ] as TemplateLocale[]);

  // Versions for the current selection.
  const versions = templates.filter(
    (tp) =>
      (eventKey === '' || tp.eventKey === eventKey) &&
      (channel === '' || tp.channel === channel) &&
      (locale === '' || tp.locale === locale)
  );

  useEffect(() => {
    // Pending or failed catalogue reads cannot invalidate a restored selection.
    if (!ready) return;
    const invalid: Record<string, string> = {};
    if (eventKey && !eventKeys.includes(eventKey)) invalid.event = '';
    if (channel && !channels.includes(channel as TemplateChannel)) invalid.channel = '';
    if (locale && !locales.includes(locale as TemplateLocale)) invalid.locale = '';
    if (versionId && !versions.some((v) => v.id === versionId)) invalid.version = '';
    if (Object.keys(invalid).length) update(invalid, true);
  }, [ready, eventKey, channel, locale, versionId, templates]);

  const selected =
    versions.find((v) => v.id === versionId) ?? versions.find((v) => v.isActive) ?? versions[0];

  const reset = () => {
    update({ event: '', channel: '', locale: '', version: '' });
  };

  const subjectPreview =
    selected?.subject != null && selected.subject.trim() !== ''
      ? renderTemplatePreview(selected.subject, selected.variables, undefined, false)
      : null;

  const bodyContext = buildSampleData(selected?.variables);
  const bodyPreview = selected
    ? renderTemplatePreview(
        selected.bodyTemplate,
        selected.variables,
        bodyContext,
        selected.channel === 'email'
      )
    : null;

  const undeclared = new Set<string>([
    ...(subjectPreview?.undeclared ?? []),
    ...(bodyPreview?.undeclared ?? []),
  ]);
  const missingRequired = new Set<string>([
    ...(subjectPreview?.missingRequired ?? []),
    ...(bodyPreview?.missingRequired ?? []),
  ]);
  const problems = new Set([...undeclared, ...missingRequired]);

  return (
    <div className="bg-card text-card-foreground rounded-lg border border-border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            {t('admin.notifications.preview.title', uiLocale)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t('admin.notifications.preview.description', uiLocale)}
          </p>
        </div>
        {(eventKey || channel || locale || versionId) && (
          <button
            onClick={reset}
            className="px-3 py-1.5 text-sm border border-input rounded hover:bg-muted"
          >
            {t('admin.notifications.preview.reset', uiLocale)}
          </button>
        )}
      </div>

      {loading && templates.length === 0 ? (
        <div className="text-muted-foreground">{t('admin.notifications.loading', uiLocale)}</div>
      ) : (
        <>
          {/* Selection controls: event / language / channel / version */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="tpl-preview-event"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('admin.notifications.eventKey', uiLocale)}
              </label>
              <select
                id="tpl-preview-event"
                value={eventKey}
                onChange={(e) => {
                  update({ event: e.target.value, channel: '', locale: '', version: '' });
                }}
                className="w-full border border-input rounded px-3 py-2"
              >
                <option value="">—</option>
                {eventKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="tpl-preview-channel"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('admin.notifications.channel', uiLocale)}
              </label>
              <select
                id="tpl-preview-channel"
                value={channel}
                onChange={(e) => {
                  update({ channel: e.target.value, locale: '', version: '' });
                }}
                className="w-full border border-input rounded px-3 py-2"
              >
                <option value="">—</option>
                {channels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="tpl-preview-locale"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('admin.notifications.locale', uiLocale)}
              </label>
              <select
                id="tpl-preview-locale"
                value={locale}
                onChange={(e) => {
                  update({ locale: e.target.value, version: '' });
                }}
                className="w-full border border-input rounded px-3 py-2"
              >
                <option value="">—</option>
                {locales.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="tpl-preview-version"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t('admin.notifications.preview.version', uiLocale)}
              </label>
              <select
                id="tpl-preview-version"
                value={selected?.id ?? ''}
                onChange={(e) => update({ version: e.target.value })}
                className="w-full border border-input rounded px-3 py-2"
                disabled={versions.length === 0}
              >
                {versions.length === 0 && <option value="">—</option>}
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{numbers.number(v.version)} · {STATUS_LABELS[v.status] ?? v.status}
                    {v.isActive ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview results */}
          {!selected ? (
            <p className="text-sm text-muted-foreground">
              {t('admin.notifications.preview.empty', uiLocale)}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Emphasize version metadata + selected identity */}
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>
                  {selected.eventKey} · {CHANNEL_LABELS[selected.channel]} ·{' '}
                  {LOCALE_LABELS[selected.locale]} · v{numbers.number(selected.version)} ·{' '}
                  {STATUS_LABELS[selected.status]}
                </p>
              </div>

              {/* Rendered subject (email only) */}
              {selected.channel === 'email' && subjectPreview != null && (
                <div className="border border-border rounded-lg p-4 bg-muted/40">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                    {t('admin.notifications.subjectLabel', uiLocale)}
                  </h3>
                  <p
                    dir={selected.locale === 'fa' ? 'rtl' : 'ltr'}
                    className="text-sm text-foreground"
                  >
                    {subjectPreview.output}
                  </p>
                </div>
              )}

              {/* Rendered body */}
              <div className="border border-border rounded-lg p-4 bg-muted/40">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                  {t('admin.notifications.bodyTemplate', uiLocale)}
                </h3>
                {selected.channel === 'email' ? (
                  <BrandedEmailPreview
                    body={bodyPreview?.output ?? ''}
                    locale={selected.locale}
                    title={t('admin.notifications.preview', uiLocale)}
                  />
                ) : (
                  <pre
                    dir={selected.locale === 'fa' ? 'rtl' : 'ltr'}
                    className="text-sm whitespace-pre-wrap font-sans text-foreground"
                  >
                    {bodyPreview?.output}
                  </pre>
                )}
              </div>

              {/* Available variables + descriptions */}
              <div className="border border-border rounded-lg p-4">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase">
                  {t('admin.notifications.preview.variables', uiLocale)}
                </h3>
                {selected.variables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('admin.notifications.preview.noVariables', uiLocale)}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {selected.variables.map((v) => {
                      const problem = problems.has(v.name);
                      return (
                        <li
                          key={v.name}
                          className={`text-sm px-3 py-1.5 rounded border ${
                            problem
                              ? 'bg-warning-soft border-warning/20 text-warning'
                              : 'bg-muted/40 border-border text-foreground'
                          }`}
                        >
                          <span className="font-mono">
                            {'{{'}
                            {v.name}
                            {'}}'}
                          </span>
                          {v.description && (
                            <span className="ml-2 text-muted-foreground">{v.description}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Missing / undeclared variable warnings */}
              {problems.size > 0 && (
                <div className="bg-warning-soft border border-warning/20 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-warning">
                    {t('admin.notifications.preview.warnings.title', uiLocale)}
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm text-warning">
                    {[...undeclared].map((name) => (
                      <li key={name}>
                        • {name} — {t('admin.notifications.preview.warnings.undeclared', uiLocale)}
                      </li>
                    ))}
                    {[...missingRequired].map((name) => (
                      <li key={name}>
                        • {name} — {t('admin.notifications.preview.warnings.missing', uiLocale)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
