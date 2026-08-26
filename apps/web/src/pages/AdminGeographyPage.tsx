import { useState, useEffect, useCallback } from 'react'
import { withCsrf } from '../lib/csrf.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Province {
  id: string
  nameFa: string
  nameEn: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

interface ListProvincesResponse {
  provinces: Province[]
  total: number
  page: number
  limit: number
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function listProvinces(params: {
  search?: string | undefined
  status?: 'active' | 'inactive' | undefined
  page?: number | undefined
  limit?: number | undefined
}): Promise<ListProvincesResponse> {
  const qs = new URLSearchParams()
  if (params.search) qs.set('search', params.search)
  if (params.status) qs.set('status', params.status)
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))

  const res = await fetch(`/api/admin/geography/provinces?${qs.toString()}`)
  if (!res.ok) throw new Error(`Failed to fetch provinces: ${res.statusText}`)
  return res.json()
}

async function createProvince(data: { nameFa: string; nameEn: string }): Promise<Province> {
  const res = await fetch('/api/admin/geography/provinces', {
    method: 'POST',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Failed to create province')
  }
  return res.json()
}

async function updateProvince(
  id: string,
  data: { nameFa?: string; nameEn?: string; status?: 'active' | 'inactive' },
): Promise<Province> {
  const res = await fetch(`/api/admin/geography/provinces/${id}`, {
    method: 'PATCH',
    headers: withCsrf({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Failed to update province')
  }
  return res.json()
}

async function deleteProvince(id: string): Promise<void> {
  const res = await fetch(`/api/admin/geography/provinces/${id}`, {
    method: 'DELETE',
    headers: withCsrf({}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? 'Failed to delete province')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PERSIAN_ALPHABET = /^[\u0600-\u06FF\s]+$/
const ENGLISH_ALPHABET = /^[a-zA-Z\s]+$/

// ---------------------------------------------------------------------------
// ProvinceFormModal
// ---------------------------------------------------------------------------

interface ProvinceFormModalProps {
  mode: 'add' | 'edit'
  province?: Province // for edit mode
  onClose: () => void
  onSaved: () => void
}

function ProvinceFormModal({ mode, province, onClose, onSaved }: ProvinceFormModalProps) {
  const [nameFa, setNameFa] = useState(province?.nameFa ?? '')
  const [nameEn, setNameEn] = useState(province?.nameEn ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(province?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)

      // Validation
      if (!nameFa.trim()) {
        setError('Persian name is required')
        return
      }
      if (!PERSIAN_ALPHABET.test(nameFa.trim())) {
        setError('Persian name must contain only Persian characters')
        return
      }
      if (!nameEn.trim()) {
        setError('English name is required')
        return
      }
      if (!ENGLISH_ALPHABET.test(nameEn.trim())) {
        setError('English name must contain only English letters')
        return
      }

      setSaving(true)
      try {
        if (mode === 'add') {
          await createProvince({ nameFa: nameFa.trim(), nameEn: nameEn.trim() })
        } else if (province) {
          const patch: { nameFa?: string; nameEn?: string; status?: 'active' | 'inactive' } = {}
          if (nameFa.trim() !== province.nameFa) patch.nameFa = nameFa.trim()
          if (nameEn.trim() !== province.nameEn) patch.nameEn = nameEn.trim()
          if (status !== province.status) patch.status = status
          await updateProvince(province.id, patch)
        }
        onSaved()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Save failed')
      } finally {
        setSaving(false)
      }
    },
    [mode, province, nameFa, nameEn, status, onSaved],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'add' ? 'Add Province' : 'Edit Province'}
        </h2>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            {/* Persian name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Persian Name
              </label>
              <input
                type="text"
                value={nameFa}
                onChange={(e) => setNameFa(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                dir="rtl"
                placeholder="نام استان"
                required
              />
            </div>

            {/* English name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                English Name
              </label>
              <input
                type="text"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Province name"
                required
              />
            </div>

            {/* Status (edit mode only) */}
            {mode === 'edit' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : mode === 'add' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DeleteConfirmModal
// ---------------------------------------------------------------------------

interface DeleteConfirmModalProps {
  province: Province
  onClose: () => void
  onDeleted: () => void
}

function DeleteConfirmModal({ province, onClose, onDeleted }: DeleteConfirmModalProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    setError(null)
    try {
      await deleteProvince(province.id)
      onDeleted()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }, [province.id, onDeleted])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-lg font-semibold mb-2">Delete Province</h2>
        <p className="text-sm text-gray-600 mb-4">
          Are you sure you want to deactivate <strong>{province.nameFa}</strong> ({province.nameEn})?
          The province will be set to inactive.
        </p>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-4">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AdminGeographyPage
// ---------------------------------------------------------------------------

export default function AdminGeographyPage() {
  const [provinces, setProvinces] = useState<Province[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProvince, setEditingProvince] = useState<Province | null>(null)
  const [deletingProvince, setDeletingProvince] = useState<Province | null>(null)

  const fetchProvinces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listProvinces({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        limit,
      })
      setProvinces(data.provinces)
      setTotal(data.total)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load provinces')
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, page, limit])

  useEffect(() => {
    fetchProvinces()
  }, [fetchProvinces])

  const totalPages = Math.ceil(total / limit)

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (loading && provinces.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Province Management</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700"
        >
          + Add Province
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search provinces..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as 'active' | 'inactive' | '')
            setPage(1)
          }}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-4">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Persian Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">English Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {provinces.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  No provinces found.
                </td>
              </tr>
            ) : (
              provinces.map((province) => (
                <tr key={province.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3" dir="rtl">{province.nameFa}</td>
                  <td className="px-4 py-3">{province.nameEn}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        province.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {province.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditingProvince(province)}
                      className="text-blue-600 hover:text-blue-800 mr-3 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() =>
                        province.status === 'active'
                          ? setDeletingProvince(province)
                          : setEditingProvince(province)
                      }
                      className={`text-sm ${
                        province.status === 'active'
                          ? 'text-red-600 hover:text-red-800'
                          : 'text-blue-600 hover:text-blue-800'
                      }`}
                    >
                      {province.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
          <span>
            Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <ProvinceFormModal
          mode="add"
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            setShowAddModal(false)
            fetchProvinces()
          }}
        />
      )}

      {editingProvince && (
        <ProvinceFormModal
          mode="edit"
          province={editingProvince}
          onClose={() => setEditingProvince(null)}
          onSaved={() => {
            setEditingProvince(null)
            fetchProvinces()
          }}
        />
      )}

      {deletingProvince && (
        <DeleteConfirmModal
          province={deletingProvince}
          onClose={() => setDeletingProvince(null)}
          onDeleted={() => {
            setDeletingProvince(null)
            fetchProvinces()
          }}
        />
      )}
    </div>
  )
}