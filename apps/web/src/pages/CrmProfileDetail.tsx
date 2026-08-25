import { useState, useEffect } from 'react'
import { useParams, Link } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { useLocale } from '../hooks/useLocale.js'

interface Profile {
  id: string
  profileType: string
  status: string
  title: string | null
  firstName: string | null
  lastName: string | null
  nationalId: string | null
  createdAt: string
  updatedAt: string
}

interface UserInfo {
  userId: string
  username: string
  email: string | null
  mobile: string | null
  lastLogin: string | null
  isAdmin: boolean
  createdAt: string
}

interface Address {
  id: string
  provinceId: string
  cityId: string
  fullAddress: string
  postalCode: string
  mainAddress: boolean
  createdAt: string
}

interface SessionEntry {
  sessionId: string
  createdAt: string
  lastActive: string
  deviceInfo: Record<string, unknown> | null
  expiresAt: string
  isRevoked: boolean
}

interface SessionsInfo {
  count: number
  lastActive: string | null
  entries: SessionEntry[]
}

interface LegalInfo {
  legalName: string
  nationalIdentifier: string
  registrationNumber: string
  companyTypeId: string | null
  economicCode: string | null
  officialPhone: string | null
  officialEmail: string | null
  officialFullAddress: string | null
  officialPostalCode: string | null
  representativeTitle: string
  representativeRelationship: string
}

interface SiblingProfile {
  id: string
  profileType: string
  isDefault: boolean
  status: string
  title: string | null
}

interface ProfileDetail {
  profile: Profile
  user: UserInfo
  legalInfo: LegalInfo | null
  addresses: Address[]
  sessions: SessionsInfo
  siblingProfiles: SiblingProfile[]
}

/** Editable fields (non-identity) */
interface EditableFields {
  title: string
  email: string
  mobile: string
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'VERIFIED':
      return 'bg-green-100 text-green-800'
    case 'ACTIVE':
      return 'bg-blue-100 text-blue-800'
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-800'
    case 'SUSPENDED':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

function getProfileTypeLabel(type: string): string {
  return type === 'LEGAL' ? 'حقوقی' : 'حقیقی'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('fa-IR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface TabDef {
  id: string
  labelKey: string
}

const TAB_DEFS: TabDef[] = [
  { id: 'overview', labelKey: 'crm.profile.tab.overview' },
  { id: 'details', labelKey: 'crm.profile.tab.details' },
  { id: 'addresses', labelKey: 'crm.profile.tab.addresses' },
  { id: 'sessions', labelKey: 'crm.profile.tab.sessions' },
  { id: 'agent-invites', labelKey: 'crm.profile.tab.agentInvites' },
  { id: 'verification-history', labelKey: 'crm.profile.tab.verificationHistory' },
  { id: 'profiles', labelKey: 'crm.profile.tab.otherProfiles' },
]

export default function CrmProfileDetail() {
  const locale: Locale = useLocale()
  const { profileId } = useParams({ from: '/admin/crm/profiles/$profileId' })
  const [data, setData] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [isEditing, setIsEditing] = useState(false)
  const [editFields, setEditFields] = useState<EditableFields>({ title: '', email: '', mobile: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/crm/profiles/${profileId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error(t('crm.profile.error.notFound', locale))
          if (res.status === 403) throw new Error(t('crm.profile.error.accessDenied', locale))
          throw new Error(t('crm.profile.error.generic', locale))
        }
        return res.json()
      })
      .then((json: ProfileDetail) => {
        setData(json)
        setLoading(false)
      })
      .catch((err: Error) => {
        setError(err.message)
        setLoading(false)
      })
  }, [profileId])

  /** Enter edit mode, pre-filling form fields from current data */
  function handleStartEdit() {
    if (!data) return
    setEditFields({
      title: data.profile.title ?? '',
      email: data.user.email ?? '',
      mobile: data.user.mobile ?? '',
    })
    setIsEditing(true)
    setSaveError(null)
    setSaveSuccess(false)
  }

  /** Cancel editing without saving */
  function handleCancelEdit() {
    setIsEditing(false)
    setSaveError(null)
    setSaveSuccess(false)
  }

  /** Show confirmation then save */
  function handleConfirmSave() {
    setShowConfirm(false)
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    fetch(`/api/crm/profiles/${profileId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editFields.title === '' ? null : editFields.title,
        email: editFields.email === '' ? null : editFields.email,
        mobile: editFields.mobile === '' ? null : editFields.mobile,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 400) return res.json().then((j: { message?: string }) => { throw new Error(j.message ?? t('crm.profile.edit.error', locale)) })
          throw new Error(t('crm.profile.edit.error', locale))
        }
        return res.json()
      })
      .then((json: ProfileDetail) => {
        setData(json)
        setIsEditing(false)
        setSaveSuccess(true)
        setSaving(false)
        setTimeout(() => setSaveSuccess(false), 4000)
      })
      .catch((err: Error) => {
        setSaveError(err.message)
        setSaving(false)
      })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-pulse text-gray-400">{t('crm.profile.loading', locale)}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-700 mb-2">{t('crm.profile.error.title', locale)}</h2>
          <p className="text-gray-600">{error}</p>
          <Link
            to="/admin/users"
            className="text-blue-600 hover:underline mt-4 inline-block"
          >
            {t('crm.profile.backToUsers', locale)}
          </Link>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { profile, user, legalInfo, addresses, sessions, siblingProfiles } = data

  const tabs = TAB_DEFS.map(td => ({ id: td.id, label: t(td.labelKey, locale) }))

  return (
    <div dir={locale === 'fa' ? 'rtl' : undefined}>
      {/* Breadcrumb / Header */}
      <div className="mb-6">
        <Link
          to="/admin/users"
          className="text-blue-600 hover:underline text-sm"
        >
          {t('crm.profile.backToUsers', locale)}
        </Link>
        <h1 className="text-2xl font-bold mt-1 flex items-center gap-3">
          {t('crm.profile.title', locale)}
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(profile.status)}`}>
            {profile.status}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
            {getProfileTypeLabel(profile.profileType)}
          </span>
          <span className="ml-auto flex gap-2">
            {!isEditing ? (
              <button
                onClick={handleStartEdit}
                className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                {t('crm.profile.edit', locale)}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={saving}
                  className="text-sm px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {saving ? '...' : t('crm.profile.edit.save', locale)}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={saving}
                  className="text-sm px-3 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors disabled:opacity-50"
                >
                  {t('crm.profile.edit.cancel', locale)}
                </button>
              </>
            )}
          </span>
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {profile.firstName && profile.lastName
            ? `${profile.firstName} ${profile.lastName}`
            : legalInfo?.legalName ?? profileId}
          {' — '}
          {user.username}
        </p>
      </div>

      {/* Save success / error flash messages */}
      {saveSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm" role="alert">
          {t('crm.profile.edit.saved', locale)}
        </div>
      )}
      {saveError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm" role="alert">
          {saveError}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6" role="tablist" aria-label={t('crm.profile.title', locale)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <SummaryCard title={t('crm.profile.summary.verification', locale)} value={profile.status === 'VERIFIED' ? t('crm.profile.verified', locale) : profile.status} icon="✓" colorClass={profile.status === 'VERIFIED' ? 'text-green-600' : 'text-yellow-600'} />
            <SummaryCard title={t('crm.profile.summary.activeSessions', locale)} value={String(sessions.count)} icon="⚡" colorClass="text-blue-600" />
            <SummaryCard title={t('crm.profile.summary.lastLogin', locale)} value={user.lastLogin ? formatDate(user.lastLogin) : '—'} icon="🔑" colorClass="text-gray-600" />
            <SummaryCard title={t('crm.profile.summary.addresses', locale)} value={String(addresses.length)} icon="📍" colorClass="text-purple-600" />
            <SummaryCard title={t('crm.profile.summary.otherProfiles', locale)} value={String(siblingProfiles.length)} icon="👤" colorClass="text-teal-600" />
            <SummaryCard title={t('crm.profile.summary.lastActivity', locale)} value={sessions.lastActive ? formatDate(sessions.lastActive) : '—'} icon="⏱" colorClass="text-gray-600" />
          </div>
        </div>
      )}

      {/* Tab: Profile Details */}
      {activeTab === 'details' && (
        <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-6">
          <Section title={t('crm.profile.section.userInfo', locale)}>
            <DetailRow label="User ID" value={user.userId} />
            <DetailRow label="Username" value={user.username} />
            {isEditing ? (
              <>
                <EditRow
                  label={t('crm.profile.label.email', locale)}
                  value={editFields.email}
                  onChange={(v) => setEditFields((prev) => ({ ...prev, email: v }))}
                  placeholder={user.email ?? t('crm.profile.edit.noChanges', locale)}
                />
                <EditRow
                  label={t('crm.profile.label.mobile', locale)}
                  value={editFields.mobile}
                  onChange={(v) => setEditFields((prev) => ({ ...prev, mobile: v }))}
                  placeholder={user.mobile ?? t('crm.profile.edit.noChanges', locale)}
                />
              </>
            ) : (
              <>
                <DetailRow label={t('crm.profile.label.email', locale)} value={user.email ?? '—'} />
                <DetailRow label={t('crm.profile.label.mobile', locale)} value={user.mobile ?? '—'} />
              </>
            )}
            <DetailRow label={t('crm.profile.label.admin', locale)} value={user.isAdmin ? t('crm.profile.label.yes', locale) : t('crm.profile.label.no', locale)} />
            <DetailRow label={t('crm.profile.label.created', locale)} value={formatDate(user.createdAt)} />
            <DetailRow label={t('crm.profile.summary.lastLogin', locale)} value={user.lastLogin ? formatDate(user.lastLogin) : '—'} />
          </Section>

          <Section title={t('crm.profile.section.profile', locale)}>
            <DetailRow label="Profile ID" value={profile.id} />
            <DetailRow label="Type" value={getProfileTypeLabel(profile.profileType)} />
            <DetailRow label={t('crm.profile.label.status', locale)} value={profile.status} />
            {isEditing ? (
              <EditRow
                label="Title"
                value={editFields.title}
                onChange={(v) => setEditFields((prev) => ({ ...prev, title: v }))}
                placeholder={profile.title ?? t('crm.profile.edit.noChanges', locale)}
              />
            ) : (
              <DetailRow label="Title" value={profile.title ?? '—'} />
            )}
            {/* Identity fields — always read-only with lock icon */}
            <DetailRow
              label="First Name"
              value={profile.firstName ?? '—'}
              valueClass={isEditing ? undefined : undefined}
              icon={isEditing ? '🔒' : undefined}
              iconTooltip={isEditing ? t('crm.profile.edit.identityLocked', locale) : undefined}
            />
            <DetailRow
              label="Last Name"
              value={profile.lastName ?? '—'}
              icon={isEditing ? '🔒' : undefined}
              iconTooltip={isEditing ? t('crm.profile.edit.identityLocked', locale) : undefined}
            />
            <DetailRow
              label="National ID"
              value={profile.nationalId ?? '—'}
              icon={isEditing ? '🔒' : undefined}
              iconTooltip={isEditing ? t('crm.profile.edit.identityLocked', locale) : undefined}
            />
            {isEditing && (
              <p className="text-xs text-gray-400 mt-1">{t('crm.profile.edit.identityLocked', locale)}</p>
            )}
            <DetailRow label={t('crm.profile.label.created', locale)} value={formatDate(profile.createdAt)} />
            <DetailRow label="Updated" value={formatDate(profile.updatedAt)} />
          </Section>

          {legalInfo && (
            <Section title={t('crm.profile.section.legalEntity', locale)}>
              <DetailRow label="Legal Name" value={legalInfo.legalName} />
              <DetailRow label="National Identifier" value={legalInfo.nationalIdentifier} />
              <DetailRow label="Registration Number" value={legalInfo.registrationNumber} />
              <DetailRow label="Company Type" value={legalInfo.companyTypeId ?? '—'} />
              <DetailRow label="Economic Code" value={legalInfo.economicCode ?? '—'} />
              <DetailRow label="Official Phone" value={legalInfo.officialPhone ?? '—'} />
              <DetailRow label="Official Email" value={legalInfo.officialEmail ?? '—'} />
              <DetailRow label="Official Address" value={legalInfo.officialFullAddress ?? '—'} />
              <DetailRow label="Official Postal Code" value={legalInfo.officialPostalCode ?? '—'} />
              <DetailRow label="Representative" value={`${legalInfo.representativeTitle} (${legalInfo.representativeRelationship})`} />
            </Section>
          )}
        </div>
      )}

      {/* Tab: Addresses */}
      {activeTab === 'addresses' && (
        <div id="panel-addresses" role="tabpanel" aria-labelledby="tab-addresses">
          {addresses.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('crm.profile.noAddresses', locale)}</p>
          ) : (
            <div className="space-y-4">
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`border rounded-lg p-4 ${addr.mainAddress ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500">{t('crm.profile.tab.addresses', locale)}</span>
                    {addr.mainAddress && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        {t('crm.profile.label.main', locale)}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-900">{addr.fullAddress}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Postal code: {addr.postalCode} | Province/City: {addr.provinceId}/{addr.cityId}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('crm.profile.label.created', locale)}: {formatDate(addr.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Sessions */}
      {activeTab === 'sessions' && (
        <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions">
          <div className="mb-4 text-sm text-gray-500">
            {sessions.count} {t('crm.profile.tab.sessions', locale)} | {t('crm.profile.summary.lastActivity', locale)}: {sessions.lastActive ? formatDate(sessions.lastActive) : '—'}
          </div>
          {sessions.entries.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('crm.profile.noSessions', locale)}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-start text-gray-500">
                    <th className="pb-2 font-medium">{t('crm.profile.label.sessionId', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.created', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.lastActive', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.expires', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.status', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.device', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.entries.map((s) => (
                    <tr key={s.sessionId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-mono text-xs">
                        {s.sessionId.substring(0, 8)}...
                      </td>
                      <td className="py-2">{formatDate(s.createdAt)}</td>
                      <td className="py-2">{formatDate(s.lastActive)}</td>
                      <td className="py-2">{formatDate(s.expiresAt)}</td>
                      <td className="py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          s.isRevoked ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {s.isRevoked ? 'Revoked' : 'Active'}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-gray-500 max-w-[150px] truncate">
                        {s.deviceInfo ? JSON.stringify(s.deviceInfo) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Agent Invites */}
      {activeTab === 'agent-invites' && (
        <div id="panel-agent-invites" role="tabpanel" aria-labelledby="tab-agent-invites">
          <div className="border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-gray-500 text-sm">
              {t('crm.profile.agentInvites.placeholder', locale)}
            </p>
            <p className="text-gray-400 text-xs mt-2">
              {t('crm.profile.agentInvites.description', locale)}
            </p>
          </div>
        </div>
      )}

      {/* Tab: Verification History */}
      {activeTab === 'verification-history' && (
        <div id="panel-verification-history" role="tabpanel" aria-labelledby="tab-verification-history">
          <div className="border border-gray-200 rounded-lg p-6 text-center">
            <p className="text-gray-500 text-sm">
              {t('crm.profile.verificationHistory.placeholder', locale)}
            </p>
            <p className="text-gray-400 text-xs mt-2">
              {t('crm.profile.verificationHistory.description', locale)}
            </p>
          </div>
        </div>
      )}

      {/* Tab: Other Profiles */}
      {activeTab === 'profiles' && (
        <div id="panel-profiles" role="tabpanel" aria-labelledby="tab-profiles">
          {siblingProfiles.length === 0 ? (
            <p className="text-gray-500 text-center py-8">{t('crm.profile.noOtherProfiles', locale)}</p>
          ) : (
            <div className="space-y-3">
              {siblingProfiles.map((sp) => (
                <div
                  key={sp.id}
                  className="border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(sp.status)}`}>
                        {sp.status}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-700">
                        {getProfileTypeLabel(sp.profileType)}
                      </span>
                      {sp.isDefault && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1 text-gray-600">{sp.title ?? sp.id.substring(0, 8)}</p>
                  </div>
                  <Link
                    to="/admin/crm/profiles/$profileId"
                    params={{ profileId: sp.id }}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    {t('crm.profile.label.view', locale)}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {showConfirm && (
        <ConfirmModal
          title={t('crm.profile.edit.confirm.title', locale)}
          message={t('crm.profile.edit.confirm.message', locale)}
          onConfirm={handleConfirmSave}
          onCancel={() => setShowConfirm(false)}
          cancelLabel={t('crm.profile.edit.cancel', locale)}
          confirmLabel={t('crm.profile.edit.save', locale)}
        />
      )}
    </div>
  )
}

/* ── sub-components ── */

function SummaryCard({
  title,
  value,
  icon,
  colorClass,
}: {
  title: string
  value: string
  icon: string
  colorClass: string
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>
        {icon} {value}
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <h3 className="text-lg font-semibold mb-3 text-gray-800">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        {children}
      </div>
    </div>
  )
}

function DetailRow({ label, value, valueClass, icon, iconTooltip }: { label: string; value: string; valueClass?: string | undefined; icon?: string | undefined; iconTooltip?: string | undefined }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className={`text-sm text-gray-900 break-words ${valueClass ?? ''}`}>
        {value}
        {icon && (
          <span className="inline-block mr-1" title={iconTooltip ?? ''} role="img" aria-label={iconTooltip ?? 'locked'}>
            {icon}
          </span>
        )}
      </span>
    </div>
  )
}

/** Editable text input row used in edit mode */
function EditRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        dir="auto"
        className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
      />
    </div>
  )
}

/** Simple confirmation modal overlay */
function ConfirmModal({
  title,
  message,
  onConfirm,
  onCancel,
  cancelLabel,
  confirmLabel,
}: {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  cancelLabel: string
  confirmLabel: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div
        className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-title" className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}