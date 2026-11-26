import { readWithDeadline } from '../lib/server-query-client.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { ProfileVerificationReview } from '../components/ProfileVerificationReview.js';
import { DEFAULT_VERIFICATION_POLICY, type VerificationPolicy } from '@barghsa/shared/verification';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/query-keys.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useWizardForm as useDraftForm, type WizardFieldBinding } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import type { CrmLegalEditor } from '../components/CrmLegalEditor.js';
import type { CrmAddressEditor } from '../components/CrmAddressEditor.js';
import { CrmLegalDocuments } from '../components/CrmLegalDocuments.js';
import {
  RecordEditorSection,
  RecordEditorActions,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import {
  StickyRecordEditorActions,
  keepRecordFieldVisible,
  recordEditorFormSurface,
} from '../components/StickyRecordEditorActions.js';
import { formatDate } from '@barghsa/i18n/date-time';
import { CrmProfileRecords } from '../components/CrmProfileRecords.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { LoadingStatus, Button, Label, Textarea, buttonVariants, inputVariants } from '@barghsa/ui';
import { useState, useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { useBlocker, useParams, useNavigate, Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/crm';
import { tCrmForm } from '@barghsa/i18n/crm-forms';
import { tAccountSettingsForms } from '@barghsa/i18n/account-settings-forms';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useLocale } from '../hooks/useLocale.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';

interface Profile {
  id: string;
  isDefault: boolean;
  archived: boolean;
  archivedAt: string | null;
  archivedReason: string | null;
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

interface LocalizedName {
  nameFa: string;
  nameEn: string;
}

interface Address {
  id: string;
  provinceId: string;
  cityId: string;
  provinceName: LocalizedName | null;
  cityName: LocalizedName | null;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface LegalInfo {
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  companyTypeName: LocalizedName | null;
  registrationDate: string | null;
  economicCode: string | null;
  officialPhone: string | null;
  officialEmail: string | null;
  officialProvinceId: string | null;
  officialCityId: string | null;
  officialFullAddress: string | null;
  officialPostalCode: string | null;
  officialProvinceName: LocalizedName | null;
  officialCityName: LocalizedName | null;
  representativeHonorific: string | null;
  representativeFirstName: string | null;
  representativeLastName: string | null;
  representativeNationalId: string | null;
  representativeProvinceId: string | null;
  representativeCityId: string | null;
  representativeProvinceName: LocalizedName | null;
  representativeCityName: LocalizedName | null;
  representativeFullAddress: string | null;
  representativePostalCode: string | null;
  createdAt: string;
  updatedAt: string;
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
  verificationPolicy?: VerificationPolicy;
  verificationCurrent?: boolean;
  viewerPermissions?: {
    canReadDocuments?: boolean;
    canEdit: boolean;
    canEditIdentity?: boolean;
    canVerify: boolean;
    canOverrideVerification?: boolean;
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
const editableProfileFields = [
  ['title', 'crm.profile.field.title', 'title'],
  ['email', 'crm.profile.label.email', 'contactEmail'],
  ['mobile', 'crm.profile.label.mobile', 'contactMobile'],
] as const;

function savedProfileMobile(value: string | null): string | null {
  return value && /^09\d{9}$/.test(value) ? '+98' + value.slice(1) : value;
}

function referenceName(name: LocalizedName | null | undefined, locale: Locale): string {
  return (locale === 'fa' ? name?.nameFa : name?.nameEn) || t('crm.records.unknown', locale);
}

function registrationDate(value: string | null, locale: Locale): string {
  // Registration is a calendar date. A viewer timezone must never move it to another day.
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return t('crm.records.unknown', locale);
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    return t('crm.records.unknown', locale);
  return formatDate(date, 'UTC', locale);
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'VERIFIED':
      return 'bg-success-soft text-success';
    case 'ACTIVE':
      return 'bg-blue-100 text-blue-800';
    case 'DRAFT':
      return 'bg-warning-soft text-warning';
    case 'SUSPENDED':
      return 'bg-danger-soft text-destructive';
    default:
      return 'bg-muted text-foreground';
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

export type CrmProfileAction = 'archive' | 'force-password-change' | 'expire-sessions';
const profileActions = {
  'force-password-change': { kind: 'password', title: 'crm.profile.admin.forcePasswordChange' },
  'expire-sessions': { kind: 'sessions', title: 'crm.profile.admin.expireSessions' },
  archive: { kind: 'archive', title: 'crm.profile.archive.title' },
} as const;
type ProfileEditEntry =
  | { kind: 'contact' }
  | { kind: 'legal'; Component: typeof CrmLegalEditor }
  | { kind: 'address'; addressId: string; Component: typeof CrmAddressEditor }
  | { kind: 'action'; action: CrmProfileAction }
  | { kind: 'verification' };

export default function CrmProfileDetail({
  initialTab = 'overview',
}: { initialTab?: string } = {}) {
  const { profileId } = useParams({ from: '/admin/crm/profiles/$profileId' });
  return <CrmProfileWorkspace profileId={profileId} initialTab={initialTab} />;
}

export function CrmProfileEditor({
  profileId,
  editor,
}: {
  profileId: string;
  editor: ProfileEditEntry;
}) {
  return <CrmProfileWorkspace profileId={profileId} editor={editor} />;
}

function CrmProfileWorkspace({
  profileId,
  initialTab,
  editor,
}: {
  profileId: string;
  initialTab?: string;
  editor?: ProfileEditEntry;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <CrmProfileDetailContent
      key={JSON.stringify([profileId, actor, revision, editor, initialTab])}
      profileId={profileId}
      initialTab={initialTab ?? 'overview'}
      editor={editor}
    />
  );
}

function CrmProfileDetailContent({
  profileId,
  initialTab,
  editor,
}: {
  profileId: string;
  initialTab: string;
  editor: ProfileEditEntry | undefined;
}) {
  const time = useAccountTime();
  const locale: Locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const navigate = useNavigate();
  const writePending = useRef(false);
  const focusVerificationHeading = useCallback((heading: HTMLHeadingElement | null) => {
    heading?.focus({ preventScroll: true });
  }, []);
  const onPendingChange = (pending: boolean) => {
    writePending.current = pending;
  };
  useBlocker({
    shouldBlockFn: () => !!editor && writePending.current,
    enableBeforeUnload: () => !!editor && writePending.current,
  });
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const sequence = useRef(0);
  const alive = useRef(false);
  const activeRead = useRef<{ cancel: () => void } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      activeRead.current?.cancel();
    };
  }, []);
  function readProfile() {
    activeRead.current?.cancel();
    const attempt = ++sequence.current;
    const key = queryKeys.profiles.detail(
      {
        context: 'staff',
        ownerId: profileId,
        accountId: actor,
        revision,
      },
      JSON.stringify([reader, 'crm-profile', locale, attempt])
    );
    let cancelled = false;
    const current = () => alive.current && !cancelled && sequence.current === attempt;
    const cancel = () => {
      cancelled = true;
      void client.cancelQueries({ queryKey: key, exact: true });
    };
    activeRead.current = { cancel };
    const result = client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      gcTime: 0,
      retry: false,
      queryFn: ({ signal: ownerSignal }) =>
        readWithDeadline(ownerSignal, async (signal) => {
          const response = await fetch(`/api/crm/profiles/${profileId}`, {
            credentials: 'include',
            signal,
          });
          if (!response.ok) return { status: response.status, value: null };
          const value = (await response.json()) as ProfileDetail;
          if (
            !value ||
            value.profile?.id !== profileId ||
            !value.user ||
            !Array.isArray(value.addresses) ||
            !value.sessions ||
            !Array.isArray(value.sessions.entries) ||
            !Array.isArray(value.siblingProfiles)
          )
            throw new Error('Invalid CRM profile detail');
          return { status: response.status, value };
        }),
    });
    return { current, cancel, result };
  }
  const [data, setData] = useState<ProfileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reloadProfile = useCallback(() => {
    activeRead.current?.cancel();
    setData(null);
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [legalSaved, setLegalSaved] = useState(false);
  const legalReturnFocus = useRef<HTMLButtonElement>(null);
  const [addressSaved, setAddressSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const editMessages = {
    email: t('crm.legal.invalid', locale).replace('{field}', t('crm.profile.label.email', locale)),
    mobile: tAccountSettingsForms('mobileInvalid', locale),
    title: t('crm.legal.invalid', locale).replace('{field}', t('crm.profile.field.title', locale)),
  };
  const editDraft = useDraftForm<EditableFields>(
    z.object({
      email: z.string().superRefine((value, context) => {
        const text = value.trim();
        if (value.length > 254 || (text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)))
          context.addIssue({ code: 'custom', message: editMessages.email });
      }),
      mobile: z.string().superRefine((value, context) => {
        const text = normalizeProfileDigits(value.trim());
        if (value.length > 32 || (text && !/^(?:09\d{9}|\+989\d{9})$/.test(text)))
          context.addIssue({ code: 'custom', message: editMessages.mobile });
      }),
      title: z.string().max(256, editMessages.title),
    }),
    { title: '', email: '', mobile: '' }
  );
  const editFields = editDraft.values;
  const editValidationError = useActionFieldErrors(
    editDraft.form,
    editMessages,
    t('crm.profile.error.generic', locale)
  );
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    action: TeamAction;
    kind: 'edit' | 'password' | 'sessions' | 'verification' | 'archive';
    summary?: ReactNode;
  } | null>(null);
  const [profileActionReason, setProfileActionReason] = useState('');
  const saving = pendingAction?.kind === 'edit';
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const withdrawProfile = useCallback(
    (status: 401 | 403 | 404) => {
      writePending.current = false;
      setPendingAction(null);
      setIsEditing(false);
      setSaveSuccess(false);
      setLegalSaved(false);
      setAddressSaved(false);
      setProfileActionReason('');
      editDraft.form.reset({ title: '', email: '', mobile: '' });
      activeRead.current?.cancel();
      setData(null);
      setError(
        t(status === 404 ? 'crm.profile.error.notFound' : 'crm.profile.error.accessDenied', locale)
      );
      setLoading(false);
    },
    [locale, editDraft.form]
  );
  const viewingSection = editor?.kind === 'address' ? 'addresses' : 'details';
  const returnToProfile = () => {
    void navigate({
      to: '/admin/crm/profiles/$profileId',
      params: { profileId },
      search: { section: viewingSection },
    });
  };

  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    const owned = readProfile();
    void owned.result
      .then((res) => {
        if (!owned.current() || abort.signal.aborted) throw new Error('Abandoned CRM read');
        if (!res.value) {
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            withdrawProfile(res.status);
            return null;
          }
          throw new Error(t('crm.profile.error.generic', locale));
        }
        return res.value;
      })
      .then((json) => {
        if (!json || abort.signal.aborted || !owned.current()) return;
        setData(json);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (abort.signal.aborted || !owned.current()) return;
        const expected = [
          t('crm.profile.error.notFound', locale),
          t('crm.profile.error.accessDenied', locale),
        ];
        setError(
          expected.includes(err.message) ? err.message : t('crm.profile.error.generic', locale)
        );
        setLoading(false);
      });
    return () => {
      abort.abort();
      owned.cancel();
    };
  }, [profileId, locale, reloadKey]);

  /** Enter edit mode, pre-filling form fields from current data */
  function handleStartEdit() {
    if (!data) return;
    editDraft.form.reset({
      title: data.profile.title ?? '',
      email: data.profile.contactEmail ?? '',
      mobile: data.profile.contactMobile ?? '',
    });
    setIsEditing(true);
    setSaveSuccess(false);
  }

  useEffect(() => {
    if (editor?.kind !== 'contact' || !data || saveSuccess || isEditing) return;
    if (!data.viewerPermissions?.canEdit || data.profile.archived) return;
    handleStartEdit();
  }, [editor?.kind, data, isEditing, saveSuccess]);

  function queueAction(
    action: TeamAction,
    kind: 'edit' | 'password' | 'sessions' | 'verification' | 'archive',
    summary?: ReactNode
  ) {
    setActionSuccess(null);
    setPendingAction({
      action: {
        ...action,
        forbiddenMessage: t('crm.profile.error.accessDenied', locale),
        conflictMessage: t('crm.profile.conflict', locale),
      },
      kind,
      summary,
    });
  }
  const handleConfirmSave = editDraft.form.handleSubmit((values) => {
    if (saving || !isEditing) return;
    queueAction(
      {
        title: t('crm.profile.edit.confirm.title', locale),
        description: data?.profile.title || data?.user.username || profileId,
        path: `/api/crm/profiles/${profileId}`,
        method: 'PUT',
        body: {
          title: values.title || null,
          email: values.email || null,
          mobile: normalizeProfileDigits(values.mobile.trim()) || null,
        },
      },
      'edit'
    );
  });
  async function actionSucceeded(response: unknown) {
    if (!alive.current) return;
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
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() || null : null;
      const mobile = typeof body.mobile === 'string' ? body.mobile.trim() || null : null;
      if (
        result.updated !== true ||
        !profile ||
        profile.id !== profileId ||
        profile.title !== body.title ||
        profile.contactEmail !== email ||
        profile.contactMobile !== savedProfileMobile(mobile) ||
        typeof profile.updatedAt !== 'string' ||
        !Number.isFinite(Date.parse(profile.updatedAt))
      ) {
        throw new Error('Invalid CRM profile update acknowledgement');
      }
    } else {
      if (
        result.success !== true ||
        !targetMatches ||
        ((kind === 'password' || kind === 'sessions') && result.reason !== body.reason)
      ) {
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
      const archivedAt = typeof result.archivedAt === 'string' ? new Date(result.archivedAt) : null;
      if (
        !archivedAt ||
        !Number.isFinite(archivedAt.valueOf()) ||
        archivedAt.toISOString() !== result.archivedAt
      ) {
        throw new Error('Invalid CRM archival timestamp');
      }
      writePending.current = false;
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
      setProfileActionReason('');
    }
    // A committed mutation stays successful even when the subsequent read fails.
    const owned = readProfile();
    try {
      const response = await owned.result;
      if (!owned.current()) return;
      if (response.value) setData(response.value);
      else if (response.status === 401 || response.status === 403 || response.status === 404) {
        withdrawProfile(response.status);
      } else setError(t('crm.profile.error.generic', locale));
    } catch {
      if (owned.current()) setError(t('crm.profile.error.generic', locale));
    } finally {
      if (owned.current()) setLoading(false);
    }
  }

  if (loading) {
    return (
      <>
        <h1 className="text-2xl font-bold">{t('crm.profile.title', locale)}</h1>
        <div className="flex items-center justify-center min-h-[300px]">
          <LoadingStatus className="text-muted-foreground">
            {t('crm.profile.loading', locale)}
          </LoadingStatus>
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center">
          <div role="alert">
            <h1 className="text-xl font-semibold text-destructive mb-2">
              {t('crm.profile.error.title', locale)}
            </h1>
            <p className="text-muted-foreground">
              {error ?? t('crm.profile.error.generic', locale)}
            </p>
          </div>
          <Button type="button" variant="outline" className="mt-4 mx-2" onClick={reloadProfile}>
            {t('crm.records.retry', locale)}
          </Button>
          <Link
            to="/admin/crm/"
            className="touch-action text-blue-700 dark:text-blue-300 hover:underline mt-4 inline-block"
          >
            {t('crm.profile.backToUsers', locale)}
          </Link>
        </div>
      </div>
    );
  }

  const { profile, user, legalInfo, addresses, sessions, siblingProfiles } = data;
  const displayName =
    profile.title?.trim() ||
    legalInfo?.legalName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    user.username;
  const profileType = (['INDIVIDUAL', 'LEGAL'] as const).find(
    (type) => type === profile.profileType
  );
  const verificationAllowed =
    !!data.viewerPermissions?.canVerify &&
    !profile.archived &&
    ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED'].includes(profile.status);

  if (editor?.kind === 'verification') {
    const heading = verificationConfigText('identityReview', locale);
    return (
      <section className="mx-auto max-w-2xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <Link
          to="/admin/crm/profiles/$profileId"
          params={{ profileId }}
          activeOptions={{ exact: true }}
          className="touch-action inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {tCrmForm('crm.profile.action.back', locale)}
        </Link>
        <h1
          ref={focusVerificationHeading}
          tabIndex={-1}
          className="w-fit text-xl font-semibold focus:outline-none"
        >
          {heading}
        </h1>
        {!verificationAllowed || !profileType ? (
          <p role="alert" className="text-destructive">
            {t('crm.profile.error.accessDenied', locale)}
          </p>
        ) : actionSuccess ? (
          <CommandFeedback message={actionSuccess} />
        ) : (
          <ProfileVerificationReview
            key={JSON.stringify([profileId, profile.updatedAt])}
            profileId={profileId}
            profileType={profileType}
            status={profile.status}
            title={displayName}
            current={data.verificationCurrent ?? profile.status === 'VERIFIED'}
            policy={{
              ...(data.verificationPolicy ?? DEFAULT_VERIFICATION_POLICY)[profileType],
              allowManualOverride: data.verificationPolicy?.allowManualOverride ?? false,
            }}
            canOverride={data.viewerPermissions?.canOverrideVerification === true}
            disabled={!!pendingAction}
            onPendingChange={onPendingChange}
            onReview={(action, summary) => queueAction(action, 'verification', summary)}
          />
        )}
        {verificationAllowed && pendingAction?.kind === 'verification' && (
          <TeamActionDialog
            action={pendingAction.action}
            summary={pendingAction.summary}
            onPendingChange={onPendingChange}
            onClose={() => {
              onPendingChange(false);
              setPendingAction(null);
            }}
            onDenied={(status) => withdrawProfile(status ?? 403)}
            onSuccess={actionSucceeded}
          />
        )}
      </section>
    );
  }

  if (editor?.kind === 'action') {
    const { action } = editor;
    const definition = profileActions[action];
    const archive = action === 'archive';
    const title = t(definition.title, locale);
    const effect = tCrmForm(`crm.profile.action.${action}.effect`, locale);
    const allowed = !!data.viewerPermissions?.canManageUser && (!archive || !profile.archived);
    const accountLabel = tCrmForm('crm.profile.action.account', locale);
    const reasonLabel = archive
      ? t('crm.profile.archivedReason', locale)
      : tCrmForm('crm.profile.action.reason', locale);
    return (
      <CrmProfileActionForm
        action={action}
        locale={locale}
        profileId={profileId}
        title={title}
        effect={effect}
        name={displayName}
        account={archive ? undefined : user.username}
        accountLabel={accountLabel}
        reason={profileActionReason}
        reasonLabel={reasonLabel}
        onReasonChange={setProfileActionReason}
        allowed={allowed}
        result={actionSuccess}
        disabled={!!pendingAction}
        onReview={() => {
          const reason = profileActionReason.trim();
          if (!allowed || !reason || pendingAction || actionSuccess) return;
          queueAction(
            {
              risk: 'destructive',
              title,
              description: effect,
              path: archive
                ? `/api/crm/profiles/${profileId}`
                : `/api/crm/users/${encodeURIComponent(user.userId)}/${action}`,
              method: archive ? 'DELETE' : 'POST',
              body: { reason },
              ...(archive && { errorMessages: archiveErrorMessages(locale) }),
            },
            definition.kind
          );
        }}
        review={
          pendingAction && allowed ? (
            <TeamActionDialog
              action={pendingAction.action}
              onPendingChange={onPendingChange}
              onClose={() => {
                onPendingChange(false);
                setPendingAction(null);
              }}
              onDenied={(status) => withdrawProfile(status ?? 403)}
              onSuccess={actionSucceeded}
              summary={
                <dl className="space-y-2 break-words text-sm">
                  <div>
                    <dt className="text-muted-foreground">
                      {archive ? t('crm.profile.title', locale) : accountLabel}
                    </dt>
                    <dd className="font-medium">
                      <bdi>{archive ? displayName : user.username}</bdi>
                    </dd>
                    {archive && <dd className="text-muted-foreground">{profileId}</dd>}
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{reasonLabel}</dt>
                    <dd className="whitespace-pre-wrap">
                      <bdi>{(pendingAction.action.body as { reason: string }).reason}</bdi>
                    </dd>
                  </div>
                </dl>
              }
            />
          ) : null
        }
      />
    );
  }

  if (editor) {
    const address =
      editor.kind === 'address' ? addresses.find((row) => row.id === editor.addressId) : null;
    const available = editor.kind === 'contact' || (editor.kind === 'legal' ? legalInfo : address);
    const editable = data.viewerPermissions?.canEdit && !profile.archived;
    const title = t(
      editor.kind === 'legal'
        ? 'crm.legal.edit'
        : editor.kind === 'address'
          ? 'crm.address.edit'
          : 'crm.profile.edit.title',
      locale
    );
    const saved =
      editor.kind === 'legal' ? legalSaved : editor.kind === 'address' ? addressSaved : saveSuccess;
    const proposed =
      pendingAction?.kind === 'edit'
        ? (pendingAction.action.body as Record<keyof EditableFields, string | null>)
        : null;
    return (
      <section
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        className="mx-auto min-w-0 max-w-3xl space-y-3"
      >
        <Link
          to="/admin/crm/profiles/$profileId"
          params={{ profileId }}
          search={{ section: viewingSection }}
          className="text-sm text-primary underline underline-offset-4"
        >
          <bdi>{displayName}</bdi>
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {!editable || !available ? (
          <p role="alert" className="text-destructive">
            {t(editable ? 'crm.profile.error.notFound' : 'crm.profile.error.accessDenied', locale)}
          </p>
        ) : saved ? (
          <div className="space-y-3 rounded-lg border bg-card p-4">
            <CommandFeedback
              message={t(
                editor.kind === 'address' ? 'crm.address.saved' : 'crm.profile.edit.saved',
                locale
              )}
            />
            <Link
              to="/admin/crm/profiles/$profileId"
              params={{ profileId }}
              search={{ section: viewingSection }}
              className={buttonVariants()}
            >
              {t('crm.profile.returnToProfile', locale)}
            </Link>
          </div>
        ) : (
          <>
            {editor.kind === 'legal' && legalInfo && (
              <editor.Component
                key={profile.id}
                profileId={profile.id}
                legalInfo={legalInfo}
                returnFocus={legalReturnFocus}
                onCancel={returnToProfile}
                onDenied={() => withdrawProfile(403)}
                onPendingChange={onPendingChange}
                onSaved={(value, updatedAt) => {
                  onPendingChange(false);
                  setData((current) =>
                    current
                      ? { ...current, legalInfo: value, profile: { ...current.profile, updatedAt } }
                      : null
                  );
                  setLegalSaved(true);
                }}
              />
            )}
            {editor.kind === 'address' && address && (
              <editor.Component
                profileId={profile.id}
                address={address}
                onCancel={returnToProfile}
                onDenied={() => withdrawProfile(403)}
                onPendingChange={onPendingChange}
                onSaved={(value, updatedAt) => {
                  onPendingChange(false);
                  setData((current) =>
                    current
                      ? {
                          ...current,
                          profile: { ...current.profile, updatedAt },
                          addresses: current.addresses.map((row) =>
                            row.id === value.id ? value : row
                          ),
                        }
                      : null
                  );
                  setAddressSaved(true);
                }}
              />
            )}
            {editor.kind === 'contact' && isEditing && (
              <form
                noValidate
                onSubmit={(event) => void handleConfirmSave(event)}
                className={recordEditorFormSurface}
                onFocus={keepRecordFieldVisible}
              >
                <RecordEditorSection
                  title={tCrmForm('crm.profile.edit.contactDetails', locale)}
                  description={t('crm.profile.contacts.explanation', locale)}
                >
                  <div className={recordEditorGrid}>
                    {editableProfileFields.map(([field, labelKey]) => (
                      <EditRow
                        key={field}
                        field={field}
                        label={t(labelKey, locale)}
                        value={editFields[field]}
                        onChange={editDraft.field(field)[1]}
                        binding={editDraft.bind(field)}
                        error={editDraft.errors[field]?.message}
                        errorId={editDraft.errorId(field)}
                        validationMessage={editMessages[field]}
                        description={
                          field === 'mobile' ? (
                            <>
                              {tAccountSettingsForms('mobileFormat', locale)}{' '}
                              <bdi dir="ltr">09… / +98…</bdi>
                            </>
                          ) : undefined
                        }
                        disabled={saving || editDraft.form.formState.isSubmitting}
                      />
                    ))}
                  </div>
                </RecordEditorSection>
                <StickyRecordEditorActions>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={returnToProfile}
                    disabled={saving}
                  >
                    {t('crm.profile.edit.cancel', locale)}
                  </Button>
                  <Button type="submit" disabled={saving || editDraft.form.formState.isSubmitting}>
                    {t('crm.profile.edit.save', locale)}
                  </Button>
                </StickyRecordEditorActions>
              </form>
            )}
          </>
        )}
        {pendingAction?.kind === 'edit' && (
          <TeamActionDialog
            action={pendingAction.action}
            onPendingChange={onPendingChange}
            onClose={() => {
              onPendingChange(false);
              setPendingAction(null);
            }}
            onDenied={() => withdrawProfile(403)}
            onSuccess={actionSucceeded}
            onValidationError={editValidationError}
            summary={
              <div className="space-y-3 text-sm [overflow-wrap:anywhere]">
                {editableProfileFields
                  .filter(
                    ([field, , original]) => (profile[original] || null) !== proposed?.[field]
                  )
                  .map(([field, labelKey, original]) => (
                    <div key={field}>
                      <p className="font-medium">{t(labelKey, locale)}</p>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">
                            {t('crm.profile.edit.current', locale)}
                          </dt>
                          <dd>
                            <bdi>{profile[original] || '—'}</bdi>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            {t('crm.profile.edit.proposed', locale)}
                          </dt>
                          <dd>
                            <bdi>
                              {(field === 'mobile'
                                ? savedProfileMobile(proposed?.mobile ?? null)
                                : proposed?.[field]) || '—'}
                            </bdi>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))}
              </div>
            }
          />
        )}
      </section>
    );
  }

  const tabs = TAB_DEFS.map((td) => ({ id: td.id, label: t(td.labelKey, locale) }));

  return (
    <div dir={locale === 'fa' ? 'rtl' : undefined}>
      {time.notice}
      {/* Breadcrumb / Header */}
      <div className="mb-6">
        <Link
          to="/admin/crm/"
          className="touch-action text-blue-700 dark:text-blue-300 hover:underline text-sm"
        >
          {t('crm.profile.backToUsers', locale)}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold [overflow-wrap:anywhere]">
            <bdi>{displayName}</bdi>
          </h1>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusBadgeClass(profile.archived ? 'ARCHIVED' : profile.status)}`}
          >
            {profile.archived
              ? t('crm.profile.archived', locale)
              : t(`crm.list.${profile.status}`, locale)}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground">
            {getProfileTypeLabel(profile.profileType, locale)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          <bdi dir="ltr">{user.username}</bdi>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {data.viewerPermissions?.canEdit && !profile.archived && (
            <Link
              to="/admin/crm/profiles/$profileId/$operation"
              params={{ profileId, operation: 'edit' }}
              className={buttonVariants()}
            >
              {t('crm.profile.edit', locale)}
            </Link>
          )}
          {verificationAllowed && profileType && (
            <Link
              to="/admin/crm/profiles/$profileId/$operation"
              params={{ profileId, operation: 'verification' }}
              className={buttonVariants({ variant: 'outline' })}
            >
              {verificationConfigText('identityReview', locale)}
            </Link>
          )}
          {data.viewerPermissions?.canManageUser &&
            (Object.keys(profileActions) as CrmProfileAction[]).map((action) =>
              action === 'archive' && profile.archived ? null : (
                <Link
                  key={action}
                  to="/admin/crm/profiles/$profileId/$operation"
                  params={{ profileId, operation: action }}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  {t(profileActions[action].title, locale)}
                </Link>
              )
            )}
        </div>
      </div>

      {data.viewerPermissions?.canEditIdentity && !profile.archived && (
        <p className="mb-4">
          <a
            className="touch-action text-foreground underline"
            href={`/admin/crm/profiles/${encodeURIComponent(profileId)}/corrections/new`}
          >
            {t('crm.corrections.request', locale)}
          </a>
        </p>
      )}
      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div
          className="flex flex-wrap gap-x-6 gap-y-2"
          role="tablist"
          aria-label={t('crm.profile.title', locale)}
        >
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
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-input'
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
              colorClass={profile.status === 'VERIFIED' ? 'text-success' : 'text-warning'}
            />
            <SummaryCard
              title={t('crm.profile.summary.activeSessions', locale)}
              value={numbers.number(sessions.count)}
              colorClass="text-blue-700 dark:text-blue-300"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastLogin', locale)}
              value={user.lastLogin ? time.format(user.lastLogin) : '—'}
              colorClass="text-muted-foreground"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastPasswordChange', locale)}
              value={
                user.lastPasswordChange
                  ? time.format(user.lastPasswordChange)
                  : t('crm.profile.passwordChangeUnknown', locale)
              }
              colorClass="text-muted-foreground"
            />
            <SummaryCard
              title={t('crm.profile.summary.addresses', locale)}
              value={numbers.number(addresses.length)}
              colorClass="text-purple-700 dark:text-purple-300"
            />
            <SummaryCard
              title={t('crm.profile.summary.otherProfiles', locale)}
              value={numbers.number(siblingProfiles.length)}
              colorClass="text-teal-700 dark:text-teal-300"
            />
            <SummaryCard
              title={t('crm.profile.summary.lastActivity', locale)}
              value={sessions.lastActive ? time.format(sessions.lastActive) : '—'}
              colorClass="text-muted-foreground"
            />
          </div>
        </div>
      )}

      {/* Tab: Profile Details */}
      {activeTab === 'details' && (
        <div
          id="panel-details"
          role="tabpanel"
          aria-labelledby="tab-details"
          className="space-y-6"
          hidden={activeTab !== 'details'}
        >
          <Section title={t('crm.profile.section.userInfo', locale)}>
            <DetailRow label={t('crm.profile.field.userId', locale)} value={user.userId} />
            <DetailRow label={t('crm.profile.field.username', locale)} value={user.username} />
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
            <DetailRow
              label={t('crm.profile.label.email', locale)}
              value={profile.contactEmail ?? '—'}
            />
            <DetailRow
              label={t('crm.profile.label.mobile', locale)}
              value={profile.contactMobile ?? '—'}
            />
          </Section>

          <Section title={t('crm.profile.section.profile', locale)}>
            <DetailRow label={t('crm.profile.field.profileId', locale)} value={profile.id} />
            <DetailRow
              label={t('crm.profile.field.type', locale)}
              value={getProfileTypeLabel(profile.profileType, locale)}
            />
            <DetailRow
              label={t('crm.profile.label.status', locale)}
              value={t(`crm.list.${profile.status}`, locale)}
            />
            <DetailRow
              label={t('crm.profile.label.default', locale)}
              value={t(
                profile.isDefault ? 'crm.profile.label.yes' : 'crm.profile.label.no',
                locale
              )}
            />
            <DetailRow
              label={t('crm.profile.archived', locale)}
              value={t(profile.archived ? 'crm.profile.label.yes' : 'crm.profile.label.no', locale)}
            />
            {profile.archived && (
              <>
                <DetailRow
                  label={t('crm.profile.archivedAt', locale)}
                  value={time.format(profile.archivedAt)}
                />
                <DetailRow
                  label={t('crm.profile.archivedReason', locale)}
                  value={profile.archivedReason ?? '—'}
                />
              </>
            )}
            <DetailRow label={t('crm.profile.field.title', locale)} value={profile.title ?? '—'} />
            <DetailRow
              label={t('crm.profile.field.firstName', locale)}
              value={profile.firstName ?? '—'}
              locked={profile.profileType === 'INDIVIDUAL'}
              iconTooltip={t('crm.profile.edit.identityLocked', locale)}
              correctionHref={
                profile.profileType === 'INDIVIDUAL' &&
                data.viewerPermissions?.canEditIdentity &&
                !profile.archived
                  ? `/admin/crm/profiles/${encodeURIComponent(profile.id)}/corrections/new?fieldName=first_name`
                  : undefined
              }
              correctionLabel={t('crm.corrections.request', locale)}
            />
            <DetailRow
              label={t('crm.profile.field.lastName', locale)}
              value={profile.lastName ?? '—'}
              locked={profile.profileType === 'INDIVIDUAL'}
              iconTooltip={t('crm.profile.edit.identityLocked', locale)}
              correctionHref={
                profile.profileType === 'INDIVIDUAL' &&
                data.viewerPermissions?.canEditIdentity &&
                !profile.archived
                  ? `/admin/crm/profiles/${encodeURIComponent(profile.id)}/corrections/new?fieldName=last_name`
                  : undefined
              }
              correctionLabel={t('crm.corrections.request', locale)}
            />
            <DetailRow
              label={t('crm.profile.field.nationalId', locale)}
              value={profile.nationalId ?? '—'}
              locked={profile.profileType === 'INDIVIDUAL'}
              iconTooltip={t('crm.profile.edit.identityLocked', locale)}
              correctionHref={
                profile.profileType === 'INDIVIDUAL' &&
                data.viewerPermissions?.canEditIdentity &&
                !profile.archived
                  ? `/admin/crm/profiles/${encodeURIComponent(profile.id)}/corrections/new?fieldName=national_id`
                  : undefined
              }
              correctionLabel={t('crm.corrections.request', locale)}
            />
            <DetailRow
              label={t('crm.profile.label.created', locale)}
              value={time.format(profile.createdAt)}
            />
            <DetailRow
              label={t('crm.profile.field.updatedAt', locale)}
              value={time.format(profile.updatedAt)}
            />
          </Section>

          {legalInfo && (
            <Section title={t('crm.profile.section.legalEntity', locale)}>
              {data.viewerPermissions?.canEdit && !profile.archived && (
                <Link
                  to="/admin/crm/profiles/$profileId/legal/edit"
                  params={{ profileId }}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  {t('crm.legal.edit', locale)}
                </Link>
              )}
              {[
                ['legalName', legalInfo.legalName],
                ['nationalIdentifier', legalInfo.nationalIdentifier],
                ['registrationNumber', legalInfo.registrationNumber],
                ['registrationDate', registrationDate(legalInfo.registrationDate, locale)],
                ['companyType', referenceName(legalInfo.companyTypeName, locale)],
                ['economicCode', legalInfo.economicCode],
                ['officialPhone', legalInfo.officialPhone],
                ['officialEmail', legalInfo.officialEmail],
                ['officialProvince', referenceName(legalInfo.officialProvinceName, locale)],
                ['officialCity', referenceName(legalInfo.officialCityName, locale)],
                ['officialFullAddress', legalInfo.officialFullAddress],
                ['officialPostalCode', legalInfo.officialPostalCode],
                ['representativeHonorific', legalInfo.representativeHonorific],
                ['representativeFirstName', legalInfo.representativeFirstName],
                ['representativeLastName', legalInfo.representativeLastName],
                ['representativeNationalId', legalInfo.representativeNationalId],
                ['representativeTitle', legalInfo.representativeTitle],
                ['representativeRelationship', legalInfo.representativeRelationship],
                [
                  'representativeProvince',
                  referenceName(legalInfo.representativeProvinceName, locale),
                ],
                ['representativeCity', referenceName(legalInfo.representativeCityName, locale)],
                ['representativeFullAddress', legalInfo.representativeFullAddress],
                ['representativePostalCode', legalInfo.representativePostalCode],
                ['createdAt', time.format(legalInfo.createdAt)],
                ['updatedAt', time.format(legalInfo.updatedAt)],
              ].map(([field, value]) => (
                <DetailRow
                  key={field}
                  label={t('crm.profile.field.' + field, locale)}
                  value={value ?? '—'}
                  locked={['legalName', 'nationalIdentifier'].includes(field ?? '')}
                  iconTooltip={t('crm.profile.edit.identityLocked', locale)}
                  correctionHref={
                    data.viewerPermissions?.canEditIdentity &&
                    !profile.archived &&
                    ['legalName', 'nationalIdentifier'].includes(field ?? '')
                      ? `/admin/crm/profiles/${encodeURIComponent(profile.id)}/corrections/new?fieldName=${field === 'legalName' ? 'legal_name' : 'national_identifier'}`
                      : undefined
                  }
                  correctionLabel={t('crm.corrections.request', locale)}
                />
              ))}
            </Section>
          )}
          {legalInfo && (
            <Section title={t('crm.documents.title', locale)}>
              <CrmLegalDocuments
                key={profile.id}
                profileId={profile.id}
                canRead={data.viewerPermissions?.canReadDocuments === true}
              />
            </Section>
          )}
        </div>
      )}

      {/* Tab: Addresses */}
      <div
        id="panel-addresses"
        role="tabpanel"
        aria-labelledby="tab-addresses"
        hidden={activeTab !== 'addresses'}
      >
        {addresses.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {t('crm.profile.noAddresses', locale)}
          </p>
        ) : (
          <div className="space-y-4">
            {addresses.map((addr) => (
              <div
                key={addr.id}
                className={`border rounded-lg p-4 bg-card text-card-foreground ${addr.mainAddress ? 'border-blue-300' : 'border-border'}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('crm.profile.tab.addresses', locale)}
                  </span>
                  {addr.mainAddress && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {t('crm.profile.label.main', locale)}
                    </span>
                  )}
                </div>
                <p className="text-foreground">{addr.fullAddress}</p>
                <DetailRow
                  label={t('crm.profile.field.postalCode', locale)}
                  value={addr.postalCode}
                />
                <DetailRow
                  label={t('crm.profile.field.province', locale)}
                  value={referenceName(addr.provinceName, locale)}
                />
                <DetailRow
                  label={t('crm.profile.field.city', locale)}
                  value={referenceName(addr.cityName, locale)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('crm.profile.label.created', locale)}: {time.format(addr.createdAt)}
                </p>
                {data.viewerPermissions?.canEdit && !profile.archived && (
                  <Link
                    to="/admin/crm/profiles/$profileId/addresses/$addressId/edit"
                    params={{ profileId, addressId: addr.id }}
                    className={buttonVariants({ variant: 'outline', className: 'mt-3' })}
                  >
                    {t('crm.address.edit', locale)}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab: Sessions */}
      {activeTab === 'sessions' && (
        <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions">
          <div className="mb-4 text-sm text-muted-foreground">
            {numbers.number(sessions.count)} {t('crm.profile.tab.sessions', locale)} |{' '}
            {t('crm.profile.summary.lastActivity', locale)}:{' '}
            {sessions.lastActive ? time.format(sessions.lastActive) : '—'}
          </div>
          {sessions.entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t('crm.profile.noSessions', locale)}
            </p>
          ) : (
            <div
              className="overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The named scroll region needs keyboard access to offscreen session columns.
              tabIndex={0}
              role="region"
              aria-label={t('crm.profile.tab.sessions', locale)}
            >
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-border text-start text-muted-foreground">
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.sessionId', locale)}
                    </th>
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.created', locale)}
                    </th>
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.lastActive', locale)}
                    </th>
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.expires', locale)}
                    </th>
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.status', locale)}
                    </th>
                    <th className="py-2 font-medium text-start">
                      {t('crm.profile.label.device', locale)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.entries.map((s) => (
                    <tr key={s.sessionId} className="border-b border-border hover:bg-muted/50">
                      <td className="px-2 py-2 font-mono text-xs">
                        {s.sessionId.replace(/^session-ref:/, '').substring(0, 12)}...
                      </td>
                      <td className="py-2">{time.format(s.createdAt)}</td>
                      <td className="py-2">{time.format(s.lastActive)}</td>
                      <td className="py-2">{time.format(s.expiresAt)}</td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            !s.isActive
                              ? 'bg-danger-soft text-destructive'
                              : 'bg-success-soft text-success'
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
                      <td className="py-2 text-xs text-muted-foreground max-w-[150px] truncate">
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
            canReadCorrections={data.viewerPermissions?.canReadDocuments === true}
            onCorrectionAccessChanged={reloadProfile}
            onProfileUnavailable={withdrawProfile}
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
            canReadCorrections={data.viewerPermissions?.canReadDocuments === true}
            onCorrectionAccessChanged={reloadProfile}
            onProfileUnavailable={withdrawProfile}
          />
        </div>
      )}

      {/* Tab: Other Profiles */}
      {activeTab === 'profiles' && (
        <div id="panel-profiles" role="tabpanel" aria-labelledby="tab-profiles">
          {siblingProfiles.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {t('crm.profile.noOtherProfiles', locale)}
            </p>
          ) : (
            <div className="space-y-3">
              {siblingProfiles.map((sp) => (
                <div
                  key={sp.id}
                  className="border border-border rounded-lg p-4 flex items-center justify-between hover:bg-muted/50"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded-full ${getStatusBadgeClass(sp.status)}`}
                      >
                        {t('crm.list.' + sp.status, locale)}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-foreground">
                        {getProfileTypeLabel(sp.profileType, locale)}
                      </span>
                      {sp.isDefault && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
                          {t('crm.profile.label.default', locale)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mt-1 text-muted-foreground">
                      {sp.title ?? sp.id.substring(0, 8)}
                    </p>
                  </div>
                  <Link
                    to="/admin/crm/profiles/$profileId"
                    params={{ profileId: sp.id }}
                    className="touch-action text-blue-700 dark:text-blue-300 hover:underline text-sm"
                  >
                    {t('crm.profile.label.view', locale)}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── sub-components ── */

function SummaryCard({
  title,
  value,
  colorClass,
}: {
  title: string;
  value: string;
  colorClass: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card text-card-foreground shadow-sm">
      <p className="text-sm text-muted-foreground mb-1">{title}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card text-card-foreground">
      <h2 className="text-lg font-semibold mb-3 text-foreground">{title}</h2>
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
  locked,
  iconTooltip,
  correctionHref,
  correctionLabel,
}: {
  label: string;
  value: string;
  valueClass?: string | undefined;
  locked?: boolean;
  iconTooltip?: string | undefined;
  correctionHref?: string | undefined;
  correctionLabel?: string | undefined;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <span className={`text-sm text-foreground break-words ${valueClass ?? ''}`}>
        {value}
        {locked && (
          <span
            className="ms-1 inline-block align-middle"
            title={iconTooltip ?? ''}
            role="img"
            aria-label={iconTooltip ?? 'locked'}
          >
            <Lock aria-hidden="true" className="size-3.5" />
          </span>
        )}
      </span>
      {correctionHref && correctionLabel && (
        <a
          href={correctionHref}
          aria-label={correctionLabel + ': ' + label}
          className="touch-action mt-1 text-sm text-foreground underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {correctionLabel}
        </a>
      )}
    </div>
  );
}

/** Editable text input row used in edit mode */
function EditRow({
  field,
  label,
  value,
  onChange,
  binding,
  error,
  errorId,
  validationMessage,
  description,
  disabled,
}: {
  field: keyof EditableFields;
  label: string;
  value: string;
  onChange: (v: string) => void;
  binding: WizardFieldBinding;
  error: string | undefined;
  errorId: string;
  validationMessage: string;
  description?: ReactNode;
  disabled: boolean;
}) {
  const inputId = useId();
  return (
    <div className={field === 'title' ? 'min-w-0 space-y-1 sm:col-span-2' : recordEditorField}>
      <Label htmlFor={inputId}>{label}</Label>
      <input
        {...binding}
        aria-describedby={
          [description && `${inputId}-help`, binding['aria-describedby']]
            .filter(Boolean)
            .join(' ') || undefined
        }
        disabled={disabled}
        id={inputId}
        type="text"
        inputMode={field === 'email' ? 'email' : field === 'mobile' ? 'tel' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        dir={field === 'title' ? 'auto' : 'ltr'}
        className={inputVariants()}
      />
      {description && (
        <p id={`${inputId}-help`} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {/* Keep Save in place when blur reveals a validation error. */}
      <p
        id={errorId}
        role={error ? 'alert' : undefined}
        aria-hidden={!error || undefined}
        className={error ? 'text-sm text-destructive' : 'invisible text-sm'}
      >
        {error ?? validationMessage}
      </p>
    </div>
  );
}

function archiveErrorMessages(locale: Locale) {
  return Object.fromEntries(
    ['CRM:PROFILE:DELETION_BLOCKED', 'CRM:PROFILE:LAST_OWNER', 'CRM:PROFILE:ALREADY_ARCHIVED'].map(
      (code) => [
        code,
        (response: unknown) => {
          const message = (response as { error?: { message?: unknown } } | null)?.error?.message;
          return typeof message === 'string' && message.trim()
            ? message
            : t('crm.profile.archive.warning', locale);
        },
      ]
    )
  );
}

function CrmProfileActionForm({
  action,
  locale,
  profileId,
  title,
  effect,
  name,
  account,
  accountLabel,
  reason,
  reasonLabel,
  onReasonChange,
  allowed,
  result,
  disabled,
  onReview,
  review,
}: {
  action: CrmProfileAction;
  locale: Locale;
  profileId: string;
  title: string;
  effect: string;
  name: string;
  account: string | undefined;
  accountLabel: string;
  reason: string;
  reasonLabel: string;
  onReasonChange: (reason: string) => void;
  allowed: boolean;
  result: string | null;
  disabled: boolean;
  onReview: () => void;
  review: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const checks = action === 'archive' ? ['availability', 'history', 'account'] : [];
  const canReview = !!reason.trim() && checks.every((key) => acknowledged.includes(key));
  useEffect(() => heading.current?.focus({ preventScroll: true }), [result]);
  return (
    <section className="mx-auto max-w-xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Link
        to="/admin/crm/profiles/$profileId"
        params={{ profileId }}
        className="touch-action inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {tCrmForm('crm.profile.action.back', locale)}
      </Link>
      <h1 ref={heading} tabIndex={-1} className="w-fit text-xl font-semibold focus:outline-none">
        {title}
      </h1>
      {!allowed ? (
        <p role="alert" className="text-destructive">
          {t('crm.profile.error.accessDenied', locale)}
        </p>
      ) : result ? (
        <CommandFeedback message={result} />
      ) : (
        <form
          aria-label={title}
          className={recordEditorSurface}
          onSubmit={(event) => {
            event.preventDefault();
            if (canReview && !disabled) onReview();
          }}
        >
          <div className="space-y-4 p-4 sm:p-5">
            <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
              <dl>
                <dt className="text-xs text-muted-foreground">
                  {account ? accountLabel : t('crm.profile.title', locale)}
                </dt>
                <dd className="wrap-anywhere text-sm font-semibold">
                  <bdi>{account ?? name}</bdi>
                </dd>
              </dl>
              <p className="text-sm text-muted-foreground">{effect}</p>
            </div>
            {checks.length > 0 && (
              <fieldset className="min-w-0 divide-y rounded-lg border px-3">
                <legend className="px-1 text-sm font-medium">
                  {tCrmForm('crm.profile.action.archiveChecks', locale)}
                </legend>
                {checks.map((key) => (
                  <label
                    key={key}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      required
                      aria-required="true"
                      disabled={disabled}
                      className="size-4 shrink-0 accent-primary"
                      checked={acknowledged.includes(key)}
                      onChange={(event) =>
                        setAcknowledged((current) =>
                          event.target.checked
                            ? [...current, key]
                            : current.filter((item) => item !== key)
                        )
                      }
                    />
                    <span>{t(`crm.profile.archive.checklist.${key}`, locale)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className={recordEditorField}>
              <Label htmlFor="crm-action-reason">{reasonLabel}</Label>
              <Textarea
                id="crm-action-reason"
                rows={2}
                maxLength={1000}
                required
                aria-required="true"
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                disabled={disabled}
                className="min-h-14 resize-y placeholder-shown:[direction:inherit]"
                dir="auto"
                placeholder={tCrmForm(`crm.profile.action.${action}.example`, locale)}
              />
            </div>
          </div>
          <RecordEditorActions>
            <Button type="submit" variant="destructive" disabled={!canReview || disabled}>
              {tCrmForm('crm.profile.action.review', locale)}
            </Button>
          </RecordEditorActions>
        </form>
      )}
      {review}
    </section>
  );
}
