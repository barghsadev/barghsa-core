import { useState, useEffect, useCallback } from 'react'
import type { FormEvent } from 'react'

interface TosVersion {
  id: string
  versionId: string
  contentFa: string
  contentEn: string
  changeType: 'major' | 'minor' | null
  status: 'draft' | 'published'
  isActive: boolean
  publishedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Admin TOS editor page (T-09.03.01).
 *
 * Lists all TOS versions with create, edit, publish, and discard actions.
 */
export default function AdminTosPage() {
  const [versions, setVersions] = useState<TosVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Draft editor state
  const [showEditor, setShowEditor] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [versionId, setVersionId] = useState('')
  const [contentFa, setContentFa] = useState('')
  const [contentEn, setContentEn] = useState('')
  const [saving, setSaving] = useState(false)

  // Publish dialog state
  const [publishId, setPublishId] = useState<string | null>(null)
  const [changeType, setChangeType] = useState<'major' | 'minor'>('minor')
  const [publishing, setPublishing] = useState(false)

  const fetchVersions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/tos/versions')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setVersions(data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TOS versions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  // Check if a draft already exists
  const hasDraft = versions.some((v) => v.status === 'draft')

  function openCreate() {
    setEditId(null)
    setVersionId('')
    setContentFa('')
    setContentEn('')
    setShowEditor(true)
  }

  function openEdit(v: TosVersion) {
    setEditId(v.id)
    setVersionId(v.versionId)
    setContentFa(v.contentFa)
    setContentEn(v.contentEn)
    setShowEditor(true)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      if (editId) {
        // Update existing draft
        const body: Record<string, string> = {}
        if (versionId) body.versionId = versionId
        if (contentFa) body.contentFa = contentFa
        if (contentEn) body.contentEn = contentEn

        const res = await fetch(`/api/admin/tos/versions/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
        }
      } else {
        // Create new draft
        const res = await fetch('/api/admin/tos/versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ versionId, contentFa, contentEn }),
        })
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
        }
      }

      setShowEditor(false)
      await fetchVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handlePublish() {
    if (!publishId) return
    setPublishing(true)

    try {
      const res = await fetch(`/api/admin/tos/versions/${publishId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeType }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }

      setPublishId(null)
      await fetchVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  async function handleDiscard(id: string) {
    if (!window.confirm('Discard this draft? This cannot be undone.')) return

    try {
      const res = await fetch(`/api/admin/tos/versions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error((errData as { message?: string }).message ?? `HTTP ${res.status}`)
      }
      await fetchVersions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard')
    }
  }

  if (loading && versions.length === 0) {
    return <div className="p-4 text-gray-500">Loading TOS versions...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Terms of Service Editor</h1>
        {!hasDraft && !showEditor && (
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            New Draft
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative">
          {error}
          <button
            onClick={() => setError(null)}
            className="absolute top-2 right-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Draft editor */}
      {showEditor && (
        <form onSubmit={handleSave} className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">
            {editId ? 'Edit Draft' : 'Create New Draft'}
          </h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Version ID <span className="text-red-500">*</span>
            </label>
            <input
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
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Persian Content (Markdown) <span className="text-red-500">*</span>
            </label>
            <textarea
              value={contentFa}
              onChange={(e) => setContentFa(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
              rows={10}
              required
              dir="rtl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              English Content (Markdown) <span className="text-red-500">*</span>
            </label>
            <textarea
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
              disabled={saving}
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
              disabled={publishing}
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

      {/* Version list */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Version</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Change</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Published</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {versions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
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
                <td className="px-4 py-3 text-sm text-gray-500">
                  {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-right text-sm space-x-2">
                  {v.status === 'draft' && (
                    <>
                      <button
                        onClick={() => openEdit(v)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setPublishId(v.id)}
                        className="text-green-600 hover:text-green-800"
                      >
                        Publish
                      </button>
                      <button
                        onClick={() => handleDiscard(v.id)}
                        className="text-red-600 hover:text-red-800"
                      >
                        Discard
                      </button>
                    </>
                  )}
                  {v.status === 'published' && (
                    <span className="text-gray-400 text-xs">Read-only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}