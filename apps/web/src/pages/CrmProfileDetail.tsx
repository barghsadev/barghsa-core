import { useState, useEffect } from 'react'
import { useParams, Link } from '@tanstack/react-router'

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
  label: string
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'details', label: 'Profile Details' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'profiles', label: 'Other Profiles' },
]

export default function CrmProfileDetail() {
  const { profileId } = useParams({ from: '/admin/crm/profiles/$profileId' })
  const [data, setData] = useState<ProfileDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/crm/profiles/${profileId}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error('Profile not found')
          if (res.status === 403) throw new Error('Access denied')
          throw new Error('Failed to load profile')
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-pulse text-gray-400">Loading profile...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-700 mb-2">Error</h2>
          <p className="text-gray-600">{error}</p>
          <Link
            to="/admin/users"
            className="text-blue-600 hover:underline mt-4 inline-block"
          >
            Back to Users
          </Link>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { profile, user, legalInfo, addresses, sessions, siblingProfiles } = data

  return (
    <div>
      {/* Breadcrumb / Header */}
      <div className="mb-6">
        <Link
          to="/admin/users"
          className="text-blue-600 hover:underline text-sm"
        >
          ← Back to Users
        </Link>
        <h1 className="text-2xl font-bold mt-1 flex items-center gap-3">
          Profile Detail
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(profile.status)}`}>
            {profile.status}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
            {getProfileTypeLabel(profile.profileType)}
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

      {/* Tabs */}
      <div className="border-inset-b border-gray-200 mb-6">
        <nav className="flex gap-6" role="tablist" aria-label="Profile sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-2 text-sm font-medium border-inset-b-2 transition-colors ${
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
            <SummaryCard title="Verification" value={profile.status === 'VERIFIED' ? 'Verified' : profile.status} icon="✓" colorClass={profile.status === 'VERIFIED' ? 'text-green-600' : 'text-yellow-600'} />
            <SummaryCard title="Active Sessions" value={String(sessions.count)} icon="⚡" colorClass="text-blue-600" />
            <SummaryCard title="Last Login" value={user.lastLogin ? formatDate(user.lastLogin) : 'Never'} icon="🔑" colorClass="text-gray-600" />
            <SummaryCard title="Addresses" value={String(addresses.length)} icon="📍" colorClass="text-purple-600" />
            <SummaryCard title="Other Profiles" value={String(siblingProfiles.length)} icon="👤" colorClass="text-teal-600" />
            <SummaryCard title="Last Activity" value={sessions.lastActive ? formatDate(sessions.lastActive) : '—'} icon="⏱" colorClass="text-gray-600" />
          </div>
        </div>
      )}

      {/* Tab: Profile Details */}
      {activeTab === 'details' && (
        <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-6">
          <Section title="User Info">
            <DetailRow label="User ID" value={user.userId} />
            <DetailRow label="Username" value={user.username} />
            <DetailRow label="Email" value={user.email ?? '—'} />
            <DetailRow label="Mobile" value={user.mobile ?? '—'} />
            <DetailRow label="Admin" value={user.isAdmin ? 'Yes' : 'No'} />
            <DetailRow label="Registered" value={formatDate(user.createdAt)} />
            <DetailRow label="Last Login" value={user.lastLogin ? formatDate(user.lastLogin) : 'Never'} />
          </Section>

          <Section title="Profile">
            <DetailRow label="Profile ID" value={profile.id} />
            <DetailRow label="Type" value={getProfileTypeLabel(profile.profileType)} />
            <DetailRow label="Status" value={profile.status} />
            <DetailRow label="Title" value={profile.title ?? '—'} />
            <DetailRow label="First Name" value={profile.firstName ?? '—'} />
            <DetailRow label="Last Name" value={profile.lastName ?? '—'} />
            <DetailRow label="National ID" value={profile.nationalId ?? '—'} />
            <DetailRow label="Created" value={formatDate(profile.createdAt)} />
            <DetailRow label="Updated" value={formatDate(profile.updatedAt)} />
          </Section>

          {legalInfo && (
            <Section title="Legal Entity Info">
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
            <p className="text-gray-500 text-center py-8">No addresses found.</p>
          ) : (
            <div className="space-y-4">
              {addresses.map((addr) => (
                <div
                  key={addr.id}
                  className={`border rounded-lg p-4 ${addr.mainAddress ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-500">Address</span>
                    {addr.mainAddress && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        Main
                      </span>
                    )}
                  </div>
                  <p className="text-gray-900">{addr.fullAddress}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Postal code: {addr.postalCode} | Province/City: {addr.provinceId}/{addr.cityId}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Created: {formatDate(addr.createdAt)}
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
            {sessions.count} active session{sessions.count !== 1 ? 's' : ''} | Last activity: {sessions.lastActive ? formatDate(sessions.lastActive) : '—'}
          </div>
          {sessions.entries.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No sessions found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="pb-2 font-medium">Session ID</th>
                    <th className="pb-2 font-medium">Created</th>
                    <th className="pb-2 font-medium">Last Active</th>
                    <th className="pb-2 font-medium">Expires</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Device</th>
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

      {/* Tab: Other Profiles */}
      {activeTab === 'profiles' && (
        <div id="panel-profiles" role="tabpanel" aria-labelledby="tab-profiles">
          {siblingProfiles.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No other profiles for this user.</p>
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
                  <a
                    href={`/admin/crm/profiles/${sp.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-sm text-gray-900 break-words">{value}</span>
    </div>
  )
}