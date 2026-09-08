import { CrmProfileRecords } from '../components/CrmProfileRecords.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Label,
} from '@barghsa/ui';
import { useState, useEffect, useId } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/crm';
import { useLocale } from '../hooks/useLocale.js';

interface Profile {
  id: string;
  profileType: string;
  status: string;
  title: string | null;
  contactEmail: string | null;
  contactMobile: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserInfo {
  userId: string;
  username: string;
  email: string | null;
  mobile: string | null;
  lastLogin: string | null;
  lastPasswordChange: string | null;
  isAdmin: boolean;
  createdAt: string;
}

interface Address {
  id: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
}

interface SessionEntry {
  sessionId: string;
  createdAt: string;
  lastActive: string;
  deviceInfo: Record<string, unknown> | null;
  expiresAt: string;
  isRevoked: boolean;
  isActive?: boolean;
}

interface SessionsInfo {
  count: number;
  lastActive: string | null;
  entries: SessionEntry[];
}

interface LegalInfo {
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  economicCode: string | null;
  officialPhone: string | null;
  officialEmail: string | null;
  officialFullAddress: string | null;
  officialPostalCode: string | null;
  representativeTitle: string;
  representativeRelationship: string;
}

interface SiblingProfile {
  id: string;
  profileType: string;
  isDefault: boolean;
  status: string;
  title: string | null;
}

interface ProfileDetail {
  viewerPermissions?: {
    canEdit: boolean;
    canEditIdentity?: boolean;
    canVerify: boolean;
    canManageUser: boolean;
  };
  profile: Profile;
  user: UserInfo;
  legalInfo: LegalInfo | null;
  addresses: Address[];
  sessions: SessionsInfo;
  siblingProfiles: SiblingProfile[];
  agentRelationships: unknown;
  verificationHistory: unknown;
}

/** Editable fields (non-identity) */
interface EditableFields {
  title: string;
  email: string;
  mobile: string;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'VERIFIED':
      return 'bg-green-100 text-green-800';
    case 'ACTIVE':
      return 'bg-blue-100 text-blue-800';
    case 'DRAFT':
      return 'bg-yellow-100 text-yellow-800';
    case 'SUSPENDED':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getProfileTypeLabel(type: string, locale: Locale): string {
  return t(`crm.list.${type}`, locale);
}

interface TabDef {
  id: string;
  labelKey: string;
}

const TAB_DEFS: TabDef[] = [
  { id: 'overview', labelKey: 'crm.profile.tab.overview' },
  { id: 'details', labelKey: 'crm.profile.tab.details' },
  { id: 'addresses', labelKey: 'crm.profile.tab.addresses' },
  { id: 'sessions', labelKey: 'crm.profile.tab.sessions' },
  { id: 'agent-invites', labelKey: 'crm.profile.tab.agentInvites' },
  { id: 'verification-history', labelKey: 'crm.profile.tab.verificationHistory' },
  { id: 'profiles', labelKey: 'crm.profile.tab.otherProfiles' },
];

export default function CrmProfileDetail() {
  const { profileId } = useParams({ from: '/admin/crm/profiles/$profileId' });
  return <CrmProfileDetailContent key={profileId} />;
}

function CrmProfileDetailContent() {
  const time = useAccountTime();
  const locale: Locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const { profileId } = useParams({ from: '/admin/crm/profiles/$profileId' });
  const [data, setData] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editFields, setEditFields] = useState<EditableFields>({
    title: '',
    email: '',
    mobile: '',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: TeamAction;
    kind: 'edit' | 'password' | 'sessions' | 'verification' | 'archive';
  } | null>(null);
  const [verificationAction, setVerificationAction] = useState('verify');
  const [verificationReason, setVerificationReason] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const [showForcePwChange, setShowForcePwChange] = useState(false);
  const [showExpireSessions, setShowExpireSessions] = useState(false);
  const [forcePwChangeReason, setForcePwChangeReason] = useState('');
  const [expireSessionsReason, setExpireSessionsReason] = useState('');
  const actionLoading = false;
  const saving = pendingAction?.kind === 'edit';
  const actionError: string | null = null;
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    fetch(`/api/crm/profiles/${profileId}`, { signal: abort.signal, credentials: 'include' })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error(t('crm.profile.error.notFound', locale));
          if (res.status === 403) throw new Error(t('crm.profile.error.accessDenied', locale));
          throw new Error(t('crm.profile.error.generic', locale));
        }
        return res.json();
      })
      .then((json: ProfileDetail) => {
        if (abort.signal.aborted) return;
        setData(json);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (abort.signal.aborted) return;
        setError(err.message);
        setLoading(false);
      });
    return () => abort.abort();
  }, [profileId, locale]);

  /** Enter edit mode, pre-filling form fields from current data */
  function handleStartEdit() {
    if (!data) return;
    setEditFields({
      title: data.profile.title ?? '',
      email: data.profile.contactEmail ?? '',
      mobile: data.profile.contactMobile ?? '',
    });
    setIsEditing(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  /** Cancel editing without saving */
  function handleCancelEdit() {
    setIsEditing(false);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function queueAction(
    action: TeamAction,
    kind: 'edit' | 'password' | 'sessions' | 'verification' | 'archive'
  ) {
    setPendingAction({
      action: {
        ...action,
        forbiddenMessage: t('crm.profile.error.accessDenied', locale),
        conflictMessage: t('crm.profile.conflict', locale),
      },
      kind,
    });
  }
  function handleConfirmSave() {
    queueAction(
      {
        title: t('crm.profile.edit.confirm.title', locale),
        description: `${t('crm.profile.edit.confirm.message', locale)} ${profileId}`,
        path: `/api/crm/profiles/${profileId}`,
        method: 'PUT',
        body: {
          title: editFields.title || null,
          email: editFields.email || null,
          mobile: editFields.mobile || null,
        },
      },
      'edit'
    );
  }
  function handleForcePasswordChange() {
    if (!data || !forcePwChangeReason.trim()) return;
    setShowForcePwChange(false);
    queueAction(
      {
        title: t('crm.profile.admin.forcePasswordChange', locale),
        description: `${data.user.username} · ${forcePwChangeReason.trim()}`,
        path: `/api/crm/users/${encodeURIComponent(data.user.userId)}/force-password-change`,
        method: 'POST',
        body: { reason: forcePwChangeReason.trim() },
      },
      'password'
    );
  }
  function handleExpireSessions() {
    if (!data || !expireSessionsReason.trim()) return;
    setShowExpireSessions(false);
    queueAction(
      {
        title: t('crm.profile.admin.expireSessions', locale),
        description: `${data.user.username} · ${expireSessionsReason.trim()}`,
        path: `/api/crm/users/${encodeURIComponent(data.user.userId)}/expire-sessions`,
        method: 'POST',
        body: { reason: expireSessionsReason.trim() },
      },
      'sessions'
    );
  }
  async function actionSucceeded(response: unknown) {
    const kind = pendingAction?.kind;
    if (!kind || !response || typeof response !== 'object') {
      throw new Error('Missing CRM action acknowledgement');
    }
    const result = response as Record<string, unknown>;
    const body = pendingAction.action.body as Record<string, unknown>;
    const targetMatches =
      kind === 'password' || kind === 'sessions'
        ? result.userId === data?.user.userId
        : result.profileId === profileId;
    if (kind === 'edit') {
      const profile = result.profile as Record<string, unknown> | undefined;
      if (result.updated !== true || profile?.id !== profileId) {
        throw new Error('Invalid CRM profile update acknowledgement');
      }
    } else {
      if (result.success !== true || !targetMatches) {
        throw new Error('Invalid CRM action acknowledgement');
      }
      if (kind === 'verification') {
        const expectedStatus =
          body.action === 'verify'
            ? 'VERIFIED'
            : body.action === 'unverify'
              ? 'ACTIVE'
              : 'PENDING_VERIFICATION';
        if (result.newStatus !== expectedStatus) {
          throw new Error('Unconfirmed CRM verification state');
        }
      }
    }
    if (kind === 'archive') {
      window.location.assign('/admin/crm');
      return;
    }
    if (kind === 'edit') {
      setIsEditing(false);
      setSaveSuccess(true);
    } else {
      setActionSuccess(
        t(
          kind === 'verification'
            ? 'crm.profile.verification.saved'
            : kind === 'password'
              ? 'crm.profile.admin.forcePwChangeSuccess'
              : 'crm.profile.admin.expireSessionsSuccess',
          locale
        )
      );
      setForcePwChangeReason('');
      setExpireSessionsReason('');
    }
    // A committed mutation stays successful even when the subsequent read fails.
    try {
      const response = await fetch(`/api/crm/profiles/${profileId}`, { credentials: 'include' });
      if (response.ok) setData((await response.json()) as ProfileDetail);
      else setError(t('crm.profile.error.generic', locale));
    } catch {
      setError(t('crm.profile.error.generic', locale));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="animate-pulse text-gray-400">{t('crm.profile.loading', locale)}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-red-700 mb-2">
            {t('crm.profile.error.title', locale)}
          </h2>
          <p className="text-gray-600">{error}</p>
          <Link to="/admin/crm/" className="text-blue-600 hover:underline mt-4 inline-block">
            {t('crm.profile.backToUsers', locale)}
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { profile, user, legalInfo, addresses, sessions, siblingProfiles } = data;

  const tabs = TAB_DEFS.map((td) => ({ id: td.id, label: t(td.labelKey, locale) }));

  return (
    <div dir={locale === 'fa' ? 'rtl' : undefined}>
      {time.notice}
      {/* Breadcrumb / Header */}
      <div className="mb-6">
        <Link to="/admin/crm/" className="text-blue-600 hover:underline text-sm">
          {t('crm.profile.backToUsers', locale)}
        </Link>
        <h1 className="text-2xl font-bold mt-1 flex items-center gap-3">
          {t('crm.profile.title', locale)}
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(profile.status)}`}
          >
            {t(`crm.list.${profile.status}`, locale)}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
            {getProfileTypeLabel(profile.profileType, locale)}
          </span>
          <span className="ml-auto flex gap-2">
            {!isEditing ? (
              <>
                {data.viewerPermissions?.canEdit && (
                  <button
                    onClick={handleStartEdit}
                    className="text-sm px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    {t('crm.profile.edit', locale)}
                  </button>
                )}
                {data.viewerPermissions?.canManageUser && (
                  <>
                    <button
                      onClick={() => setShowForcePwChange(true)}
                      className="text-sm px-3 py-1 rounded bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                    >
                      {t('crm.profile.admin.forcePasswordChange', locale)}
                    </button>
                    <button
                      onClick={() => setShowExpireSessions(true)}
                      className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors"
                    >
                      {t('crm.profile.admin.expireSessions', locale)}
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={handleConfirmSave}
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
            : (legalInfo?.legalName ?? profileId)}
          {' — '}
          {user.username}
        </p>
      </div>

      {data.viewerPermissions?.canVerify &&
        ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED'].includes(profile.status) && (
          <div className="mb-4 space-y-3 rounded border bg-white p-4">
            <Label htmlFor="crm-verify-action">
              {t('crm.profile.verification.action', locale)}
            </Label>
            <select
              id="crm-verify-action"
              className="block rounded border p-2"
              value={
                profile.status === 'VERIFIED'
                  ? verificationAction === 'verify'
                    ? 'unverify'
                    : verificationAction
                  : 'verify'
              }
              onChange={(event) => setVerificationAction(event.target.value)}
            >
              {(profile.status === 'VERIFIED' ? ['unverify', 'reverify'] : ['verify']).map(
                (action) => (
                  <option key={action} value={action}>
                    {t(`crm.profile.verification.${action}`, locale)}
                  </option>
                )
              )}
            </select>
            <Label htmlFor="crm-verify-reason">
              {t('crm.profile.verification.reason', locale)}
            </Label>
            <textarea
              id="crm-verify-reason"
              className="block w-full rounded border p-2"
              maxLength={1000}
              value={verificationReason}
              onChange={(event) => setVerificationReason(event.target.value)}
            />
            <Button
              disabled={
                !!pendingAction || (profile.status === 'VERIFIED' && !verificationReason.trim())
              }
              onClick={() => {
                const action =
                  profile.status === 'VERIFIED'
                    ? verificationAction === 'verify'
                      ? 'unverify'
                      : verificationAction
                    : 'verify';
                queueAction(
                  {
                    title: t(`crm.profile.verification.${action}`, locale),
                    description: `${profile.title || profileId} · ${verificationReason.trim()}`,
                    path: `/api/crm/profiles/${profileId}/verify`,
                    method: 'POST',
                    body: {
                      action,
                      ...(verificationReason.trim() ? { reason: verificationReason.trim() } : {}),
                    },
                  },
                  'verification'
                );
              }}
            >
              {t('crm.profile.verification.review', locale)}
            </Button>
          </div>
        )}
      {data.viewerPermissions?.canManageUser && (
        <Button variant="outline" className="mb-4" onClick={() => setShowArchive(true)}>
          {t('crm.profile.archive.title', locale)}
        </Button>
      )}
      {showArchive && (
        <AdminActionConfirmModal
          title={t('crm.profile.archive.title', locale)}
          message={t('crm.profile.archive.warning', locale)}
          reason={archiveReason}
          onReasonChange={setArchiveReason}
          onCancel={() => setShowArchive(false)}
          cancelLabel={t('team.cancel', locale)}
          confirmLabel={t('crm.profile.archive.title', locale)}
          loading={false}
          onConfirm={() => {
            setShowArchive(false);
            queueAction(
              {
                title: t('crm.profile.archive.title', locale),
                description: `${t('crm.profile.archive.warning', locale)} ${profileId} · ${archiveReason.trim()}`,
                path: `/api/crm/profiles/${profileId}`,
                method: 'DELETE',
                errorMessages: {
                  'CRM:PROFILE:DELETION_BLOCKED': t('crm.profile.archive.warning', locale),
                  'CRM:PROFILE:LAST_OWNER': t('crm.profile.archive.warning', locale),
                },
                body: { reason: archiveReason.trim() },
              },
              'archive'
            );
          }}
        />
      )}
      {data.viewerPermissions?.canEditIdentity && (
        <p className="mb-4">
          <a
            className="text-blue-700 underline"
            href={`/admin/crm/corrections?profileId=${encodeURIComponent(profileId)}`}
          >
            {t('crm.corrections.request', locale)}
          </a>
        </p>
      )}
      {/* Save success / error flash messages */}
      {saveSuccess && (
        <div
          className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm"
          role="alert"
        >
          {t('crm.profile.edit.saved', locale)}
        </div>
      )}
      {saveError && (
        <div
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm"
          role="alert"
        >
          {saveError}
        </div>
      )}

      {/* Action success / error flash messages */}
      {actionSuccess && (
        <div
          className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-md text-sm"
          role="alert"
        >
          {actionSuccess}
        </div>
      )}
      {actionError && (
        <div
          className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm"
          role="alert"
        >
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6" role="tablist" aria-label={t('crm.profile.title', locale)}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              id={'tab-' + tab.id}
              role="tab"
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const current = tabs.findIndex((item) => item.id === tab.id);
                const direction =
                  (event.key === 'ArrowRight' ? 1 : -1) * (locale === 'fa' ? -1 : 1);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (current + direction + tabs.length) % tabs.length;
                const target = tabs[next]!;
                setActiveTab(target.id);
                document.getElementById('tab-' + target.id)?.focus();
              }}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <SummaryCard
              title={t('crm.profile.summary.verification', locale)}
              value={
                profile.status === 'VERIFIED'
                  ? t('crm.profile.verified', locale)
                  : ['ACTIVE', 'DRAFT'].includes(profile.status)
                    ? t('crm.profile.unverified', locale)
                    : t(`crm.list.${profile.status}`, locale)
              }
              icon="✓"
              colorClass={profile.status === 'VERIFIED' ? 'text-green-600' : 'text-yellow-600'}
            />
            <SummaryCard
              title={t('crm.profile.summary.activeSessions', locale)}
              value={numbers.number(sessions.count)}
              icon="⚡"
              colorClass="text-blue-600"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastLogin', locale)}
              value={user.lastLogin ? time.format(user.lastLogin) : '—'}
              icon="🔑"
              colorClass="text-gray-600"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastPasswordChange', locale)}
              value={
                user.lastPasswordChange
                  ? time.format(user.lastPasswordChange)
                  : t('crm.profile.passwordChangeUnknown', locale)
              }
              icon="🔒"
              colorClass="text-gray-600"
            />
            <SummaryCard
              title={t('crm.profile.summary.addresses', locale)}
              value={numbers.number(addresses.length)}
              icon="📍"
              colorClass="text-purple-600"
            />
            <SummaryCard
              title={t('crm.profile.summary.otherProfiles', locale)}
              value={numbers.number(siblingProfiles.length)}
              icon="👤"
              colorClass="text-teal-600"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastActivity', locale)}
              value={sessions.lastActive ? time.format(sessions.lastActive) : '—'}
              icon="⏱"
              colorClass="text-gray-600"
            />
          </div>
        </div>
      )}

      {/* Tab: Profile Details */}
      {activeTab === 'details' && (
        <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-6">
          <Section title={t('crm.profile.section.userInfo', locale)}>
            <DetailRow label="User ID" value={user.userId} />
            <DetailRow label="Username" value={user.username} />
            <DetailRow label={t('crm.profile.label.email', locale)} value={user.email ?? '—'} />
            <DetailRow label={t('crm.profile.label.mobile', locale)} value={user.mobile ?? '—'} />
            <DetailRow
              label={t('crm.profile.label.admin', locale)}
              value={
                user.isAdmin
                  ? t('crm.profile.label.yes', locale)
                  : t('crm.profile.label.no', locale)
              }
            />
            <DetailRow
              label={t('crm.profile.label.created', locale)}
              value={time.format(user.createdAt)}
            />
            <DetailRow
              label={t('crm.profile.summary.lastLogin', locale)}
              value={user.lastLogin ? time.format(user.lastLogin) : '—'}
            />
          </Section>

          <Section title={t('crm.profile.section.contacts', locale)}>
            <p className="text-sm text-muted-foreground">
              {t('crm.profile.contacts.explanation', locale)}
            </p>
            {isEditing ? (
              <>
                <EditRow
                  label={t('crm.profile.label.email', locale)}
                  value={editFields.email}
                  onChange={(v) => setEditFields((prev) => ({ ...prev, email: v }))}
                  placeholder={profile.contactEmail ?? t('crm.profile.edit.noChanges', locale)}
                />
                <EditRow
                  label={t('crm.profile.label.mobile', locale)}
                  value={editFields.mobile}
                  onChange={(v) => setEditFields((prev) => ({ ...prev, mobile: v }))}
                  placeholder={profile.contactMobile ?? t('crm.profile.edit.noChanges', locale)}
                />
              </>
            ) : (
              <>
                <DetailRow
                  label={t('crm.profile.label.email', locale)}
                  value={profile.contactEmail ?? '—'}
                />
                <DetailRow
                  label={t('crm.profile.label.mobile', locale)}
                  value={profile.contactMobile ?? '—'}
                />
              </>
            )}
          </Section>

          <Section title={t('crm.profile.section.profile', locale)}>
            <DetailRow label="Profile ID" value={profile.id} />
            <DetailRow label="Type" value={getProfileTypeLabel(profile.profileType, locale)} />
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
              <p className="text-xs text-gray-400 mt-1">
                {t('crm.profile.edit.identityLocked', locale)}
              </p>
            )}
            <DetailRow
              label={t('crm.profile.label.created', locale)}
              value={time.format(profile.createdAt)}
            />
            <DetailRow label="Updated" value={time.format(profile.updatedAt)} />
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
              <DetailRow
                label="Representative"
                value={`${legalInfo.representativeTitle} (${legalInfo.representativeRelationship})`}
              />
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
                    <span className="text-sm font-medium text-gray-500">
                      {t('crm.profile.tab.addresses', locale)}
                    </span>
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
                    {t('crm.profile.label.created', locale)}: {time.format(addr.createdAt)}
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
            {numbers.number(sessions.count)} {t('crm.profile.tab.sessions', locale)} |{' '}
            {t('crm.profile.summary.lastActivity', locale)}:{' '}
            {sessions.lastActive ? time.format(sessions.lastActive) : '—'}
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
                    <th className="pb-2 font-medium">
                      {t('crm.profile.label.lastActive', locale)}
                    </th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.expires', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.status', locale)}</th>
                    <th className="pb-2 font-medium">{t('crm.profile.label.device', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.entries.map((s) => (
                    <tr key={s.sessionId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 font-mono text-xs">
                        {s.sessionId.replace(/^session-ref:/, '').substring(0, 12)}...
                      </td>
                      <td className="py-2">{time.format(s.createdAt)}</td>
                      <td className="py-2">{time.format(s.lastActive)}</td>
                      <td className="py-2">{time.format(s.expiresAt)}</td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            !s.isActive ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}
                        >
                          {t(
                            s.isRevoked
                              ? 'crm.profile.session.revoked'
                              : s.isActive
                                ? 'crm.profile.session.active'
                                : 'crm.profile.session.expired',
                            locale
                          )}
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
          <CrmProfileRecords
            profileId={profileId}
            kind="agents"
            initial={data.agentRelationships}
          />
        </div>
      )}

      {/* Tab: Verification History */}
      {activeTab === 'verification-history' && (
        <div
          id="panel-verification-history"
          role="tabpanel"
          aria-labelledby="tab-verification-history"
        >
          <CrmProfileRecords
            profileId={profileId}
            kind="verification"
            initial={data.verificationHistory}
          />
        </div>
      )}

      {/* Tab: Other Profiles */}
      {activeTab === 'profiles' && (
        <div id="panel-profiles" role="tabpanel" aria-labelledby="tab-profiles">
          {siblingProfiles.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {t('crm.profile.noOtherProfiles', locale)}
            </p>
          ) : (
            <div className="space-y-3">
              {siblingProfiles.map((sp) => (
                <div
                  key={sp.id}
                  className="border border-gray-200 rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(sp.status)}`}
                      >
                        {sp.status}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-700">
                        {getProfileTypeLabel(sp.profileType, locale)}
                      </span>
                      {sp.isDefault && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1 text-gray-600">
                      {sp.title ?? sp.id.substring(0, 8)}
                    </p>
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
      {pendingAction && (
        <TeamActionDialog
          action={pendingAction.action}
          onClose={() => setPendingAction(null)}
          onSuccess={actionSucceeded}
        />
      )}
      {showForcePwChange && (
        <AdminActionConfirmModal
          title={t('crm.profile.admin.forcePasswordChange', locale)}
          message={t('crm.profile.admin.forcePwChangeReason', locale)}
          reason={forcePwChangeReason}
          onReasonChange={setForcePwChangeReason}
          onConfirm={handleForcePasswordChange}
          onCancel={() => {
            setShowForcePwChange(false);
            setForcePwChangeReason('');
          }}
          cancelLabel={t('crm.profile.edit.cancel', locale)}
          confirmLabel={t('crm.profile.admin.forcePasswordChange', locale)}
          loading={actionLoading}
        />
      )}
      {showExpireSessions && (
        <AdminActionConfirmModal
          title={t('crm.profile.admin.expireSessions', locale)}
          message={t('crm.profile.admin.expireSessionsReason', locale)}
          reason={expireSessionsReason}
          onReasonChange={setExpireSessionsReason}
          onConfirm={handleExpireSessions}
          onCancel={() => {
            setShowExpireSessions(false);
            setExpireSessionsReason('');
          }}
          cancelLabel={t('crm.profile.edit.cancel', locale)}
          confirmLabel={t('crm.profile.admin.expireSessions', locale)}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ── sub-components ── */

function SummaryCard({
  title,
  value,
  icon,
  colorClass,
}: {
  title: string;
  value: string;
  icon: string;
  colorClass: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>
        {icon} {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <h3 className="text-lg font-semibold mb-3 text-gray-800">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
        {children}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueClass,
  icon,
  iconTooltip,
}: {
  label: string;
  value: string;
  valueClass?: string | undefined;
  icon?: string | undefined;
  iconTooltip?: string | undefined;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className={`text-sm text-gray-900 break-words ${valueClass ?? ''}`}>
        {value}
        {icon && (
          <span
            className="inline-block mr-1"
            title={iconTooltip ?? ''}
            role="img"
            aria-label={iconTooltip ?? 'locked'}
          >
            {icon}
          </span>
        )}
      </span>
    </div>
  );
}

/** Editable text input row used in edit mode */
function EditRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const inputId = useId();
  return (
    <div className="flex flex-col">
      <label htmlFor={inputId} className="text-xs text-gray-500 font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ''}
        dir="auto"
        className="mt-1 w-full border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
      />
    </div>
  );
}

/** Confirm modal with a reason text input for admin actions */
function AdminActionConfirmModal({
  title,
  message,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  cancelLabel,
  confirmLabel,
  loading,
}: {
  title: string;
  message: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel: string;
  confirmLabel: string;
  loading: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !loading) onCancel();
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) onConfirm();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{message}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="crm-action-reason">{message}</Label>
          <textarea
            id="crm-action-reason"
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={loading}
            className="w-full rounded border p-2"
            dir="auto"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={loading || !reason.trim()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
