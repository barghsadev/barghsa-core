import { adminTosText } from './admin-tos-text.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { adminControlsText } from '@barghsa/i18n/admin-controls';
import { useLocale } from '../hooks/useLocale.js';
import { Dialog, DialogContent, DialogTitle } from '@barghsa/ui';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { FormEvent } from 'react';

interface TosVersion {
  id: string;
  versionId: string;
  contentFa: string;
  contentEn: string;
  changeType: 'major' | 'minor' | null;
  status: 'draft' | 'published';
  isActive: boolean;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function isVersion(value: unknown): value is TosVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const date = (input: unknown) => typeof input === 'string' && Number.isFinite(Date.parse(input));
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.versionId === 'string' &&
    v.versionId.length > 0 &&
    typeof v.contentFa === 'string' &&
    typeof v.contentEn === 'string' &&
    (v.status === 'draft' || v.status === 'published') &&
    (v.changeType === null || v.changeType === 'major' || v.changeType === 'minor') &&
    typeof v.isActive === 'boolean' &&
    (!v.isActive || v.status === 'published') &&
    (v.createdBy === null || typeof v.createdBy === 'string') &&
    date(v.createdAt) &&
    date(v.updatedAt) &&
    (v.status === 'published' ? date(v.publishedAt) : v.publishedAt === null)
  );
}

/**
 * Admin TOS editor page (T-09.03.01) with version history (T-09.03.02).
 *
 * Lists all TOS versions with create, edit, publish, view, and discard actions.
 * Read-only version detail view shows full Persian and English content.
 */
export default function AdminTosPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const text = adminTosText(locale);
  const historyRequest = useRef(0);
  const [versions, setVersions] = useState<TosVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyReady, setHistoryReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState('');
  const [contentFa, setContentFa] = useState('');
  const [contentEn, setContentEn] = useState('');
  const [saving, setSaving] = useState(false);

  // Publish dialog state
  const [publishId, setPublishId] = useState<string | null>(null);
  const [changeType, setChangeType] = useState<'major' | 'minor'>('minor');
  const [publishing, setPublishing] = useState(false);

  // Version detail view state (T-09.03.02)
  const [viewVersion, setViewVersion] = useState<TosVersion | null>(null);
  const [detailLocale, setDetailLocale] = useState<'fa' | 'en'>('fa');

  const fetchVersions = useCallback(async () => {
    const request = ++historyRequest.current;
    try {
      setLoading(true);
      setHistoryReady(false);
      setError(null);
      const res = await fetch('/api/admin/tos/versions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (request !== historyRequest.current) return;
      if (
        !Array.isArray(data) ||
        !data.every(isVersion) ||
        new Set(data.map((v) => v.id)).size !== data.length ||
        data.filter((v) => v.status === 'draft').length > 1 ||
        data.filter((v) => v.isActive).length > 1
      ) {
        throw new Error(text.invalidHistory);
      }
      setVersions(data);
      setHistoryReady(true);
    } catch (err) {
      if (request === historyRequest.current)
        setError(err instanceof Error ? err.message : text.historyFailed);
    } finally {
      if (request === historyRequest.current) setLoading(false);
    }
  }, [text]);

  useEffect(() => {
    fetchVersions();
    return () => {
      historyRequest.current++;
    };
  }, [fetchVersions]);

  // Check if a draft already exists
  const hasDraft = versions.some((v) => v.status === 'draft');

  function openCreate() {
    if (!historyReady || loading) return;
    setEditId(null);
    setVersionId('');
    setContentFa('');
    setContentEn('');
    setShowEditor(true);
  }

  function openEdit(v: TosVersion) {
    if (!historyReady || loading) return;
    setEditId(v.id);
    setVersionId(v.versionId);
    setContentFa(v.contentFa);
    setContentEn(v.contentEn);
    setShowEditor(true);
  }

  function openView(v: TosVersion) {
    setViewVersion(v);
    setDetailLocale('fa');
  }

  function closeView() {
    setViewVersion(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!historyReady || loading) return;
    setSaving(true);

    try {
      if (editId) {
        // Update existing draft
        const body: Record<string, string> = {};
        if (versionId) body.versionId = versionId;
        if (contentFa) body.contentFa = contentFa;
        if (contentEn) body.contentEn = contentEn;

        const res = await fetch(`/api/admin/tos/versions/${editId}`, {
          method: 'PUT',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`);
        }
      } else {
        // Create new draft
        const res = await fetch('/api/admin/tos/versions', {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ versionId, contentFa, contentEn }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`);
        }
      }

      setShowEditor(false);
      await fetchVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!publishId || !historyReady || loading) return;
    setPublishing(true);

    try {
      const res = await fetch(`/api/admin/tos/versions/${publishId}/publish`, {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ changeType }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`);
      }

      setPublishId(null);
      await fetchVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  }

  async function handleDiscard(id: string) {
    if (!historyReady || loading) return;
    if (!window.confirm('Discard this draft? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/admin/tos/versions/${id}`, {
        headers: withCsrf(),
        method: 'DELETE',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      await fetchVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard');
    }
  }

  if (loading && versions.length === 0) {
    return <div className="p-4 text-gray-500">Loading TOS versions...</div>;
  }

  return (
    <div className="space-y-6">
      {time.notice}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Terms of Service Editor</h1>
        {!hasDraft && !showEditor && (
          <button
            onClick={openCreate}
            disabled={!historyReady || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            New Draft
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative"
        >
          {error}
          <button
            aria-label={adminControlsText('dismissError', locale)}
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {!historyReady && !loading && (
        <button type="button" onClick={fetchVersions} className="rounded border px-4 py-2">
          {text.retry}
        </button>
      )}

      {/* Draft editor */}
      {showEditor && (
        <form
          onSubmit={handleSave}
          className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold">{editId ? 'Edit Draft' : 'Create New Draft'}</h2>

          <div>
            <label
              htmlFor="admintospage-field-1"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Version ID <span className="text-red-500">*</span>
            </label>
            <input
              id="admintospage-field-1"
              type="text"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="e.g. v2"
              required
              disabled={!!editId}
            />
          </div>

          <div>
            <label
              htmlFor="admintospage-field-2"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Persian Content (Markdown) <span className="text-red-500">*</span>
            </label>
            <textarea
              id="admintospage-field-2"
              value={contentFa}
              onChange={(e) => setContentFa(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              rows={10}
              required
              dir="rtl"
            />
          </div>

          <div>
            <label
              htmlFor="admintospage-field-3"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              English Content (Markdown) <span className="text-red-500">*</span>
            </label>
            <textarea
              id="admintospage-field-3"
              value={contentEn}
              onChange={(e) => setContentEn(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              rows={10}
              required
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving || !historyReady || loading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editId ? 'Update Draft' : 'Create Draft'}
            </button>
            <button
              type="button"
              onClick={() => setShowEditor(false)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Publish dialog */}
      {publishId && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold">Publish TOS Version</h3>
          <p className="text-sm text-gray-600">
            Is this a material change? Users will need to re-accept for major changes.
          </p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="changeType"
                value="minor"
                checked={changeType === 'minor'}
                onChange={() => setChangeType('minor')}
              />
              <span className="text-sm">Minor (typo/clarification — no re-acceptance)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="changeType"
                value="major"
                checked={changeType === 'major'}
                onChange={() => setChangeType('major')}
              />
              <span className="text-sm">Major (material change — triggers re-acceptance)</span>
            </label>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handlePublish}
              disabled={publishing || !historyReady || loading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {publishing ? 'Publishing...' : 'Publish'}
            </button>
            <button
              onClick={() => setPublishId(null)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Version detail modal (T-09.03.02) */}
      {viewVersion && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeView();
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="bg-white rounded-lg shadow-xl sm:max-w-3xl w-full max-h-[85vh] flex flex-col p-0 gap-0"
          >
            {time.notice}
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <DialogTitle className="text-lg font-semibold">
                  TOS Version: {viewVersion.versionId}
                </DialogTitle>
                <p className="text-sm text-gray-500">
                  {viewVersion.status === 'published' ? 'Published' : 'Draft'} ·
                  {viewVersion.changeType && (
                    <span
                      className={`ml-1 inline-block px-2 py-0.5 text-xs rounded ${
                        viewVersion.changeType === 'major'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {viewVersion.changeType}
                    </span>
                  )}
                  {viewVersion.isActive && (
                    <span className="ml-2 text-green-600 text-sm font-medium">✓ Active</span>
                  )}
                </p>
              </div>
              <button
                onClick={closeView}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Metadata */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Version ID:</span>{' '}
                <span className="font-medium">{viewVersion.versionId}</span>
              </div>
              <div>
                <span className="text-gray-500">Author:</span>{' '}
                <span className="font-medium">{viewVersion.createdBy ?? '—'}</span>
              </div>
              <div>
                <span className="text-gray-500">Published:</span>{' '}
                <span className="font-medium">{time.format(viewVersion.publishedAt)}</span>
              </div>
              <div>
                <span className="text-gray-500">Created:</span>{' '}
                <span className="font-medium">{time.format(viewVersion.createdAt)}</span>
              </div>
            </div>

            {/* Locale toggle */}
            <div className="px-6 py-3 border-b border-gray-200 flex gap-2">
              <button
                onClick={() => setDetailLocale('fa')}
                className={`px-3 py-1 text-sm rounded ${
                  detailLocale === 'fa'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                فارسی
              </button>
              <button
                onClick={() => setDetailLocale('en')}
                className={`px-3 py-1 text-sm rounded ${
                  detailLocale === 'en'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                English
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <pre
                className="whitespace-pre-wrap font-mono text-sm leading-relaxed"
                dir={detailLocale === 'fa' ? 'rtl' : 'ltr'}
              >
                {detailLocale === 'fa' ? viewVersion.contentFa : viewVersion.contentEn}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Version list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Version
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Change
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Active
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Published
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Author
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {historyReady && versions.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No TOS versions yet. Create a draft to get started.
                </td>
              </tr>
            )}
            {versions.map((v) => (
              <tr key={v.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium">{v.versionId}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs rounded ${
                      v.status === 'draft'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {v.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {v.status === 'published' ? (
                    <span
                      className={`inline-block px-2 py-0.5 text-xs rounded ${
                        v.changeType === 'major'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {v.changeType}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {v.isActive ? (
                    <span className="text-green-600 text-sm font-medium">✓ Active</span>
                  ) : (
                    <span className="text-gray-400 text-sm">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">{time.format(v.publishedAt)}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {v.createdBy ? (
                    <span className="font-mono text-xs" title={v.createdBy}>
                      {v.createdBy.substring(0, 8)}…
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  <button
                    onClick={() => openView(v)}
                    className="text-indigo-600 hover:text-indigo-800"
                  >
                    View
                  </button>
                  {v.status === 'draft' && (
                    <>
                      <button
                        onClick={() => openEdit(v)}
                        disabled={!historyReady || loading}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPublishId(v.id)}
                        disabled={!historyReady || loading}
                        className="text-green-600 hover:text-green-800"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => handleDiscard(v.id)}
                        disabled={!historyReady || loading}
                        className="text-red-600 hover:text-red-800"
                      >
                        Discard
                      </button>
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
