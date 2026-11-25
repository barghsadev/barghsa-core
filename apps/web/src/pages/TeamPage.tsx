import {
  ArrowLeftRight as TableArrowLeftRightIcon,
  Eye as TableEyeIcon,
  Save as TableSaveIcon,
  Trash2 as TableTrash2Icon,
  Undo2 as TableUndo2Icon,
  UserCog as TableUserCogIcon,
} from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { useCommandFeedback } from '../hooks/useCommandFeedback.js';
import { useCompactRecords } from '../hooks/useCompactRecords.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { Link } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from 'react';
import { t } from '@barghsa/i18n/team';
import { confirmationText } from '@barghsa/i18n/confirmation';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Badge,
  Textarea,
  ListPage,
  ListRefreshButton,
  cn,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  Input,
  Label,
  NativeSelect,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
import { normalizeUsername } from '@barghsa/shared/validation';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { maskDestination } from '../lib/mask-destination.js';
import { withCsrf } from '../lib/csrf.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { teamRecordLink, type TeamWorkspace } from '../lib/team-workspace.js';
import { toast } from '../lib/toast-api.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { AgentDetailDialog } from '../components/AgentDetailDialog.js';
import {
  RecordEditorActions,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import {
  TeamIdentity,
  TeamRoleFields,
  useTeamRoleDraft,
  teamMemberLabel,
} from '../components/TeamMemberFields.js';

import { useCatalogueScope, useCatalogueResource } from '../hooks/useCatalogueResource.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  TEAM_ROLES as ROLES,
  validTeam,
  validTeamProfiles,
  validTransfers,
  teamBasis,
  transferBasis,
  type TeamRole as Role,
  type TeamEntry as Entry,
  type Team,
} from '../lib/team-catalogue.js';

export function TeamPage({ workspace }: { workspace?: TeamWorkspace } = {}) {
  const revision = useProfileContextRevision();
  return <TeamCatalogue key={revision} workspace={workspace} />;
}
const transferStatus = {
  accept: 'Completed',
  decline: 'Declined',
  cancelTransfer: 'Cancelled',
} as const;
type TransferDecision = keyof typeof transferStatus;
function TeamCatalogue({ workspace }: { workspace?: TeamWorkspace | undefined }) {
  const locale = useLocale();
  const time = useAccountTime();
  const word = (key: string) => t(`team.${key}`, locale);
  const [review, setReview] = useState<{
    action: TeamAction;
    decision: TransferDecision;
    profileId: string;
    id: string;
    basis: string;
  } | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionRecovery, setDecisionRecovery] = useState<{
    after: number;
    decision: TransferDecision;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useCommandFeedback({ success: notice });
  const clearPrivate = useCallback(() => {
    setReview(null);
    setDecisionPending(false);
    setDecisionRecovery(null);
    setNotice(null);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const profiles = useCatalogueResource(scope, '/api/profiles', validTeamProfiles);
  const showTransfers = !workspace || workspace.section === 'transfers';
  const editing = workspace?.section === 'invite' || workspace?.edit;
  const tabClass = editing ? 'min-h-11 px-2.5 sm:px-3' : 'min-h-11';
  const needTransfers = showTransfers || (workspace?.section === 'members' && !workspace.recordId);
  const checkSessionAfterAcceptance = useCallback(() => {
    if (decisionRecovery?.decision === 'accept') window.location.assign('/login');
  }, [decisionRecovery]);
  const transfers = useCatalogueResource(
    scope,
    needTransfers ? '/api/profiles/ownership-transfers' : null,
    validTransfers,
    { onUnauthorized: checkSessionAfterAcceptance }
  );
  const [requestedTransferRead, setRequestedTransferRead] = useState<number | null>(null);
  const reloadTransfers = () => setRequestedTransferRead(transfers.retry());
  const active = profiles.data?.profiles.find((p) => p.id === profiles.data?.activeProfileId);
  const profileReady = !profiles.loading && !profiles.error && !!profiles.data;
  const transferLoading =
    transfers.loading ||
    (!scope.denied &&
      !transfers.error &&
      requestedTransferRead !== null &&
      transfers.readAttempt !== requestedTransferRead);
  const transferReady = !transferLoading && !transfers.error && !!transfers.data;
  const transferAllowed =
    transferReady &&
    !decisionRecovery &&
    !transfers.data?.transfers.some(
      (transfer) => transfer.profileId === active?.id && transfer.direction === 'outgoing'
    );
  const refreshTransfers = useRef<HTMLButtonElement>(null);
  const selected = transfers.data?.transfers.find((row) => row.id === review?.id);
  const stale = !!review && (!selected || transferBasis(selected) !== review.basis);
  useEffect(() => {
    if (!transferReady || decisionPending) return;
    if (decisionRecovery) {
      if ((transfers.readAttempt ?? -1) < decisionRecovery.after) return;
      setDecisionRecovery(null);
      setReview(null);
      refreshTransfers.current?.focus();
    } else if (review && stale) {
      setReview(null);
      refreshTransfers.current?.focus();
    }
  }, [review, transferReady, stale, decisionPending, decisionRecovery, transfers.readAttempt]);
  const profileRefresh = (
    <ListRefreshButton
      label={word('refreshProfiles')}
      onClick={() => (scope.denied ? scope.recover() : profiles.retry())}
    />
  );
  return (
    <div
      className={cn(
        'mx-auto min-w-0 max-w-4xl rounded-lg bg-background p-4 text-foreground',
        editing ? 'space-y-3' : 'space-y-6'
      )}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{word('title')}</h1>
          {workspace && active?.profileType === 'LEGAL' && active.title && (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <bdi>{active.title}</bdi>
            </p>
          )}
        </div>
        {editing && profileRefresh}
      </header>
      {workspace && (
        <nav
          aria-label={word('title')}
          className={cn(
            'flex flex-wrap border-b',
            editing ? 'gap-x-1.5 gap-y-1 pb-1.5' : 'gap-2 pb-3'
          )}
        >
          <Link
            to="/settings/team"
            className={buttonVariants({
              variant: workspace.section === 'members' ? 'secondary' : 'ghost',
              className: tabClass,
            })}
            aria-current={workspace.section === 'members' ? 'page' : undefined}
          >
            {word('membersOnly')}
          </Link>
          {(['invitations', 'roles', 'transfers'] as const).map((section) => {
            const current =
              workspace.section === section ||
              (section === 'invitations' && workspace.section === 'invite');
            return (
              <Link
                key={section}
                to="/settings/team/$section"
                params={{ section }}
                aria-current={current ? 'page' : undefined}
                className={buttonVariants({
                  variant: current ? 'secondary' : 'ghost',
                  className: tabClass,
                })}
              >
                {word(section)}
              </Link>
            );
          })}
        </nav>
      )}
      {!showTransfers &&
        transfers.data?.transfers.some((item) => item.direction === 'incoming') && (
          <Alert>
            <AlertDescription>
              <Link
                to="/settings/team/$section"
                params={{ section: 'transfers' }}
                className="text-primary underline"
              >
                {word('banner')}
              </Link>
            </AlertDescription>
          </Alert>
        )}
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      {showTransfers && (
        <section aria-labelledby="ownership-title">
          <ListPage>
            <ListPage.Toolbar>
              <h2 id="ownership-title" className="text-lg font-semibold">
                {word('transfers')}
              </h2>
              <ListRefreshButton
                label={word('refreshTransfers')}
                ref={refreshTransfers}
                disabled={decisionPending || transferLoading}
                onClick={() => (scope.denied ? scope.recover() : reloadTransfers())}
              />
            </ListPage.Toolbar>
            {decisionRecovery && !review && (
              <p role="alert">{confirmationText('unconfirmed', locale)}</p>
            )}
            <ListPage.Content
              loading={transferLoading}
              error={transfers.error || scope.denied}
              retainContent={!!transfers.data?.transfers.length}
              empty={!!transfers.data && !transfers.data.transfers.length}
              loadingView={<LoadingStatus>{word('loading')}</LoadingStatus>}
              errorView={
                <p role="alert">{word(scope.denied ? 'forbidden' : 'loadTransfersError')}</p>
              }
              emptyView={<p>{word('noTransfers')}</p>}
            >
              <div className="space-y-3">
                {transfers.data?.transfers.map((transfer) => (
                  <article key={transfer.id} className="rounded border bg-card p-4 space-y-2">
                    <h3 className="font-medium [overflow-wrap:anywhere]">{transfer.profileName}</h3>
                    <p>{word(transfer.direction === 'incoming' ? 'incoming' : 'outgoing')}</p>
                    <p className="text-sm text-muted-foreground">
                      {word('expires')}{' '}
                      <time dateTime={transfer.expiresAt}>{time.format(transfer.expiresAt)}</time>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(transfer.direction === 'incoming'
                        ? (['accept', 'decline'] as const)
                        : (['cancelTransfer'] as const)
                      ).map((decision) => (
                        <Button
                          key={decision}
                          variant={decision === 'accept' ? 'default' : 'outline'}
                          disabled={!transferReady || !!review || !!decisionRecovery}
                          onClick={() => {
                            setNotice(null);
                            setReview({
                              id: transfer.id,
                              profileId: transfer.profileId,
                              decision,
                              basis: transferBasis(transfer),
                              action: {
                                risk: 'destructive',
                                title: word(decision),
                                description: word(
                                  decision === 'accept' ? 'acceptWarning' : 'decisionWarning'
                                ),
                                path: `/api/profiles/${encodeURIComponent(transfer.profileId)}/ownership-${decision === 'cancelTransfer' ? 'cancel' : decision}`,
                                method: 'POST',
                                body: { transferId: transfer.id },
                              },
                            });
                          }}
                        >
                          {word(decision)}
                        </Button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </ListPage.Content>
          </ListPage>
        </section>
      )}
      {workspace?.section !== 'transfers' && (
        <ListPage>
          {!editing && <ListPage.Toolbar>{profileRefresh}</ListPage.Toolbar>}
          <ListPage.Content
            loading={profiles.loading}
            error={profiles.error || scope.denied}
            retainContent={!!profiles.data}
            empty={false}
            emptyView={null}
            loadingView={<LoadingStatus>{word('loading')}</LoadingStatus>}
            errorView={<p role="alert">{word(scope.denied ? 'forbidden' : 'loadError')}</p>}
          >
            {!scope.denied &&
              profiles.data &&
              (active?.profileType === 'LEGAL' ? (
                <TeamMembers
                  key={`${scope.version}:${active.id}`}
                  profile={active}
                  profileReady={profileReady}
                  transferAllowed={transferAllowed}
                  transferLoading={transferLoading}
                  refreshTransfers={reloadTransfers}
                  onSessionDenied={scope.deny}
                  workspace={workspace}
                />
              ) : (
                <p role="status">{word('selectLegal')}</p>
              ))}
          </ListPage.Content>
        </ListPage>
      )}
      {review && (
        <TeamActionDialog
          action={review.action}
          onClose={() => {
            setDecisionPending(false);
            setReview(null);
          }}
          onDenied={scope.deny}
          onPendingChange={setDecisionPending}
          onUnconfirmed={() =>
            setDecisionRecovery({ after: transfers.nextReadAttempt(), decision: review.decision })
          }
          confirmationDisabled={!transferReady || stale || !!decisionRecovery}
          finalFocus={refreshTransfers}
          summary={
            <Button
              variant="outline"
              disabled={decisionPending || transferLoading}
              onClick={reloadTransfers}
            >
              {word('refreshTransfers')}
            </Button>
          }
          onSuccess={async (result) => {
            if (
              !transferReady ||
              stale ||
              !result ||
              typeof result !== 'object' ||
              !('profileId' in result) ||
              result.profileId !== review.profileId ||
              !('transferId' in result) ||
              result.transferId !== review.id ||
              !('status' in result) ||
              result.status !== transferStatus[review.decision]
            )
              throw new Error('Unconfirmed ownership decision');
            if (review.decision === 'accept') {
              window.location.assign('/login');
              return;
            }
            reloadTransfers();
            setNotice(word('saved'));
          }}
        />
      )}
    </div>
  );
}
type MemberAction = TeamAction & {
  memberUserId?: string;
  successMessage?: string;
  onConfirmed?: () => void;
  onValidationError?: (fields: unknown[]) => boolean;
};
function TeamMembers({
  profile,
  profileReady,
  transferAllowed,
  transferLoading,
  refreshTransfers,
  onSessionDenied,
  workspace,
}: {
  profile: { id: string; title?: string | null };
  profileReady: boolean;
  transferAllowed: boolean;
  transferLoading: boolean;
  refreshTransfers: () => void;
  onSessionDenied: () => void;
  workspace?: TeamWorkspace | undefined;
}) {
  const time = useAccountTime();
  const actor = useAccountUser();
  const locale = useLocale();
  const compact = useCompactRecords();
  const [localDetail, setDetail] = useState<{ type: 'agent' | 'invitation'; id: string } | null>(
    null
  );
  const section = workspace?.section;
  const routedId = workspace?.recordId;
  const detail = routedId
    ? {
        type: section === 'invitations' ? ('invitation' as const) : ('agent' as const),
        id: routedId,
      }
    : localDetail;
  const routedInvite = section === 'invite';
  const showMembers = !workspace || (section === 'members' && !routedId);
  const showInvitations = !workspace || (section === 'invitations' && !routedId);
  const rosterLabel = !workspace ? 'members' : showInvitations ? 'invitations' : 'membersOnly';
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const [activityRevision, setActivityRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<MemberAction | null>(null);
  const [memberPending, setMemberPending] = useState(false);
  const [memberRecovery, setMemberRecovery] = useState<{
    after: number;
    mayRevokeSession: boolean;
  } | null>(null);
  const [ownershipStep, setOwnershipStep] = useState<'verify' | 'select' | 'confirm' | null>(null);
  const [transferUnconfirmed, setTransferUnconfirmed] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const transferTrigger = useRef<HTMLButtonElement>(null);
  const recipientSelect = useRef<HTMLSelectElement>(null);
  const restoreTransferFocus = useRef(false);
  const teamHeading = useRef<HTMLHeadingElement>(null);
  const invitation = useDraftForm(
    z.object({
      username: z
        .string()
        .trim()
        .max(254, t('team.invalidInvitation', locale))
        .refine((value) => normalizeUsername(value) !== null, t('team.invalidInvitation', locale)),
      role: z.enum(ROLES, { error: t('team.invalidRole', locale) }),
      message: z
        .string()
        .max(1000, t('team.invalidMessage', locale))
        .refine((value) => !value.includes('\0'), t('team.invalidMessage', locale)),
    }),
    { username: '', role: 'Manager', message: '' }
  );
  const [username, setUsername] = invitation.field('username');
  const [role, setRole] = invitation.field('role');
  const [message, setMessage] = invitation.field('message');
  const resetInvitation = invitation.form.reset;
  const invitationFieldErrors = useActionFieldErrors(
    invitation.form,
    {
      username: t('team.invalidInvitation', locale),
      role: t('team.invalidRole', locale),
      message: t('team.invalidMessage', locale),
    },
    t('team.error', locale)
  );
  const [inviting, setInviting] = useState(false);
  const [localInvite, setInvitationOpen] = useState(false);
  const invitationOpen = routedInvite || localInvite;
  const [inviteRecovery, setInviteRecovery] = useState<{
    username: string;
    role: Role;
    message: string | null;
    readAttempt: number;
  } | null>(null);
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const restoreInviteFocus = useRef(false);
  const focusRefreshPending = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  useCommandFeedback({ success: notice });
  const generation = useRef(0);
  const mounted = useRef(false);
  const reviewBasis = useRef<string | null>(null);
  const refreshMembers = useRef<HTMLButtonElement>(null);
  const invitationPending = useRef(false);
  const inviteRequest = useRef<AbortController | null>(null);
  const word = (key: string) => t(`team.${key}`, locale);

  const clearPrivate = useCallback(() => {
    generation.current++;
    restoreInviteFocus.current = false;
    restoreTransferFocus.current = false;
    focusRefreshPending.current = false;
    invitationPending.current = false;
    inviteRequest.current?.abort();
    setInviteRecovery(null);
    setInviting(false);
    setInvitationOpen(false);
    setDetail(null);
    setOwnershipStep(null);
    setTransferUnconfirmed(false);
    setAction(null);
    setMemberPending(false);
    setMemberRecovery(null);
    resetInvitation({ username: '', role: 'Manager', message: '' });
    setRecipientId('');
    setError(null);
    setNotice(null);
  }, [resetInvitation]);
  const scope = useCatalogueScope(clearPrivate);
  const validate = useCallback(
    (value: unknown): value is Team => validTeam(value) && value.profileId === profile.id,
    [profile.id]
  );
  const memberReadUnauthorized = useCallback(() => {
    if (memberRecovery?.mayRevokeSession) window.location.assign('/login');
    onSessionDenied();
  }, [memberRecovery, onSessionDenied]);
  const resource = useCatalogueResource(
    scope,
    `/api/profiles/${encodeURIComponent(profile.id)}/agents`,
    validate,
    { onUnauthorized: memberReadUnauthorized }
  );
  const team = resource.data
    ? {
        ...resource.data,
        profileName: resource.data.profileName || profile.title || word('legalEntity'),
      }
    : null;
  const denyTeam = useCallback(
    (status?: 401 | 403) => {
      if (status === 401) onSessionDenied();
      scope.deny();
    },
    [onSessionDenied, scope.deny]
  );
  const loading = resource.loading;
  const membershipReady = profileReady && !!team && !loading && !resource.error && !scope.denied;
  const ready = membershipReady && memberRecovery === null;
  const basis = team ? teamBasis(team) : null;
  const liveBasis = useRef(basis);
  liveBasis.current = basis;
  const staleReview = !!(action || ownershipStep) && reviewBasis.current !== basis;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      inviteRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!membershipReady || memberPending) return;
    if (memberRecovery) {
      if ((resource.readAttempt ?? -1) < memberRecovery.after) return;
      setMemberRecovery(null);
      setAction(null);
      setActivityRevision((value) => value + 1);
      if (!detail) refreshMembers.current?.focus();
    } else if (staleReview) {
      setAction(null);
      setOwnershipStep(null);
      setRecipientId('');
      refreshMembers.current?.focus();
    }
  }, [membershipReady, memberPending, memberRecovery, resource.readAttempt, staleReview, detail]);
  const load = async () => {
    focusRefreshPending.current = true;
    resource.retry();
  };
  function reloadMembers() {
    if (memberPending) return;
    if (scope.denied) {
      scope.recover();
      return;
    }
    const readAttempt = resource.retry();
    setInviteRecovery((pending) => (pending ? { ...pending, readAttempt } : null));
  }
  useEffect(() => {
    if (!ready || !inviteRecovery || resource.readAttempt !== inviteRecovery.readAttempt) return;
    const matched = resource.data?.agents.find(
      (entry) =>
        entry.type === 'invitation' &&
        entry.username === inviteRecovery.username &&
        entry.role === inviteRecovery.role &&
        (entry.message ?? null) === inviteRecovery.message
    );
    setInviteRecovery(null);
    if (matched) {
      if (routedInvite && workspace) {
        toast.success(t('team.invitePendingFound', locale));
        workspace.navigate('invitations', matched.id, false, true);
        return;
      }
      resetInvitation({ username: '', role: inviteRecovery.role, message: '' });
      restoreInviteFocus.current = invitationOpen;
      setInvitationOpen(false);
      setError(null);
      setNotice(t('team.invitePendingFound', locale));
    } else {
      setError(t('team.inviteNotConfirmed', locale));
    }
  }, [
    ready,
    inviteRecovery,
    resource.readAttempt,
    resource.data,
    invitationOpen,
    resetInvitation,
    locale,
    routedInvite,
    workspace,
  ]);
  useEffect(() => {
    if (loading) focusRefreshPending.current = false;
    if (
      !ownershipStep &&
      !loading &&
      !transferLoading &&
      !focusRefreshPending.current &&
      restoreTransferFocus.current
    ) {
      restoreTransferFocus.current = false;
      (
        (ready && transferAllowed ? transferTrigger.current : null) ??
        refreshMembers.current ??
        teamHeading.current
      )?.focus();
    }
  }, [ownershipStep, loading, ready, transferAllowed, transferLoading]);
  useEffect(() => {
    if (!invitationOpen && !loading && !focusRefreshPending.current && restoreInviteFocus.current) {
      restoreInviteFocus.current = false;
      (
        (ready ? inviteTrigger.current : null) ??
        refreshMembers.current ??
        teamHeading.current
      )?.focus();
    }
  }, [invitationOpen, loading, ready]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!ready || !team || invitationPending.current || inviteRecovery) return;
    const version = generation.current,
      epoch = scope.version;
    const current = () =>
      mounted.current && generation.current === version && scope.live.current === epoch;
    invitationPending.current = true;
    try {
      await invitation.form.handleSubmit(async (values) => {
        if (!current()) return;
        const normalized = normalizeUsername(values.username);
        if (!normalized) return;
        const message = values.message.trim() || null;
        const controller = new AbortController();
        inviteRequest.current = controller;
        const recover = () => {
          setError(confirmationText('unconfirmed', locale));
          setInviteRecovery({
            username: normalized,
            role: values.role,
            message,
            readAttempt: resource.retry(),
          });
        };
        setInviting(true);
        setError(null);
        setNotice(null);
        const packet = await readWithDeadline(controller.signal, async (signal) => {
          const response = await fetch(
            `/api/profiles/${encodeURIComponent(team.profileId)}/invitations`,
            {
              method: 'POST',
              credentials: 'include',
              signal,
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                username: values.username.trim(),
                role: values.role,
                ...(message ? { message } : {}),
              }),
            }
          );
          const body: unknown =
            response.ok || response.status === 400 ? await response.json().catch(() => null) : null;
          return { response, body };
        }).catch(() => null);
        if (!current()) return;
        if (!packet || packet.response.status >= 500) {
          recover();
          return;
        }
        const { response, body } = packet;
        if (response.status === 401 || response.status === 403) {
          denyTeam(response.status);
          return;
        }
        if (!response.ok) {
          if (response.status === 400) {
            const failure = body;
            if (
              failure &&
              typeof failure === 'object' &&
              'error' in failure &&
              failure.error &&
              typeof failure.error === 'object' &&
              'code' in failure.error &&
              failure.error.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              'fields' in failure.error &&
              Array.isArray(failure.error.fields) &&
              invitationFieldErrors(failure.error.fields)
            )
              return;
          }
          setError(
            word(
              response.status === 409
                ? 'conflict'
                : response.status === 429
                  ? 'rateLimit'
                  : response.status === 400
                    ? 'invalidInvitation'
                    : 'error'
            )
          );
          return;
        }
        const result = body;
        if (
          response.status !== 201 ||
          !result ||
          typeof result !== 'object' ||
          !('id' in result) ||
          typeof result.id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)
        ) {
          recover();
          return;
        }
        if (routedInvite && workspace) {
          toast.success(word('invited'));
          workspace.navigate('invitations', result.id, false, true);
          return;
        }
        resetInvitation({ username: '', role: values.role, message: '' });
        restoreInviteFocus.current = true;
        setInvitationOpen(false);
        await load();
        setNotice(word('invited'));
      })(event);
    } catch {
      if (current()) setError(word('error'));
    } finally {
      if (current()) {
        inviteRequest.current = null;
        invitationPending.current = false;
        setInviting(false);
      }
    }
  }

  const members = new Map<string, { entry: Entry; roles: string[] }>();
  for (const entry of team?.agents ?? []) {
    if (entry.type !== 'agent' || !entry.userId) continue;
    const member = members.get(entry.userId) ?? { entry, roles: [] };
    member.roles.push(entry.role);
    members.set(entry.userId, member);
  }
  const invitations = team?.agents.filter((entry) => entry.type === 'invitation') ?? [];
  const eligibleOwners = Array.from(members).filter(
    ([, member]) =>
      !member.roles.includes('Owner') &&
      member.roles.some((role) => ROLES.some((eligible) => eligible === role))
  );
  const detailedMember = detail?.type === 'agent' ? members.get(detail.id) : undefined;
  const detailedEntry =
    detailedMember?.entry ??
    (detail?.type === 'invitation'
      ? invitations.find((entry) => entry.id === detail.id)
      : undefined);
  const refreshInEditor = !!(workspace?.edit && detailedEntry);
  const memberRefresh = (
    <ListRefreshButton
      label={word('refreshMembers')}
      ref={refreshMembers}
      disabled={memberPending}
      onClick={reloadMembers}
    />
  );
  const closeDetail = () => {
    if (routedId && workspace) {
      workspace.navigate(
        section === 'invitations' ? 'invitations' : 'members',
        workspace.edit ? routedId : undefined
      );
      return;
    }
    setDetail(null);
    (detailTrigger.current?.isConnected ? detailTrigger.current : refreshMembers.current)?.focus();
  };
  useEffect(() => {
    if (ready && localDetail && !detailedEntry) {
      setDetail(null);
      refreshMembers.current?.focus();
    }
  }, [ready, localDetail, detailedEntry]);
  const base = `/api/profiles/${encodeURIComponent(team?.profileId ?? '')}`;
  const openAction = (next: MemberAction) => {
    if (!ready) return;
    reviewBasis.current = basis;
    setNotice(null);
    setAction(next);
  };
  const finished = async (result: unknown) => {
    if (!mounted.current) return;
    if (reviewBasis.current !== liveBasis.current) throw new Error('Membership changed');
    const receipt = result && typeof result === 'object' ? result : null;
    const sessionRevoked =
      receipt && 'sessionRevoked' in receipt && receipt.sessionRevoked === true;
    if (action?.method === 'PUT' && action.path.endsWith('/roles')) {
      const expected = (action.body as { roles: Role[] }).roles;
      const actual =
        result && typeof result === 'object' && 'roles' in result ? result.roles : null;
      if (
        !Array.isArray(actual) ||
        actual.length !== expected.length ||
        new Set(actual).size !== actual.length ||
        !actual.every((role) => expected.includes(role))
      )
        throw new Error();
    }
    if (action?.method === 'DELETE') {
      const accepted = action.path.includes('/invitations/')
        ? receipt &&
          'id' in receipt &&
          'status' in receipt &&
          action.path.endsWith(`/invitations/${encodeURIComponent(String(receipt.id))}`) &&
          receipt.status === 'Withdrawn'
        : receipt && 'removed' in receipt && receipt.removed === true;
      if (!accepted) throw new Error();
      setDetail(null);
    }
    if (action?.path === `${base}/transfer-ownership`) {
      if (!z.object({ id: z.uuid() }).safeParse(result).success) throw new Error();
      refreshTransfers();
    }
    if (sessionRevoked && actor && action?.memberUserId === actor) {
      window.location.assign('/login');
      return;
    }
    action?.onConfirmed?.();
    if (routedId && workspace) {
      if (action?.method === 'DELETE') {
        toast.success(action.successMessage ?? word('saved'));
        workspace.navigate(
          section === 'invitations' ? 'invitations' : 'members',
          undefined,
          false,
          true
        );
        return;
      }
      if (workspace.edit && action?.method === 'PUT') {
        toast.success(action.successMessage ?? word('saved'));
        workspace.navigate('members', routedId, false, true);
        return;
      }
    }
    setActivityRevision((value) => value + 1);
    await load();
    setNotice(action?.successMessage ?? word('saved'));
  };
  const saveMember = (
    userId: string,
    entry: Entry,
    roles: Role[],
    onConfirmed: () => void,
    onValidationError: (fields: unknown[]) => boolean
  ) =>
    openAction({
      risk: 'destructive',
      title: word('saveRoles'),
      description: word('rolesTargetWarning')
        .replace('{name}', teamMemberLabel(entry, word('unnamed')))
        .replace('{roles}', roles.map((role) => word(role)).join('، ')),
      path: `${base}/agents/${encodeURIComponent(userId)}/roles`,
      method: 'PUT',
      memberUserId: userId,
      body: { roles },
      onConfirmed,
      onValidationError,
    });
  const removeMember = (userId: string, entry: Entry) =>
    openAction({
      title: word('remove'),
      description: word('removeTargetWarning').replace(
        '{name}',
        teamMemberLabel(entry, word('unnamed'))
      ),
      path: `${base}/agents/${encodeURIComponent(userId)}`,
      method: 'DELETE',
      memberUserId: userId,
    });
  const withdraw = (entry: Entry) =>
    openAction({
      title: word('withdraw'),
      description: word('withdrawTargetWarning').replace(
        '{name}',
        teamMemberLabel(entry, word('unnamed'))
      ),
      path: `${base}/invitations/${encodeURIComponent(entry.id)}`,
      method: 'DELETE',
    });
  const startOwnership = () => {
    if (!ready || !transferAllowed || !eligibleOwners.length || action || ownershipStep) return;
    reviewBasis.current = basis;
    setNotice(null);
    setRecipientId('');
    setOwnershipStep('verify');
  };
  const closeOwnership = () => {
    restoreTransferFocus.current = true;
    setOwnershipStep(null);
    setTransferUnconfirmed(false);
    setAction(null);
  };

  const inviteForm = invitationOpen ? (
    <form
      noValidate
      onSubmit={invite}
      aria-label={word('invite')}
      className={routedInvite ? `max-w-2xl ${recordEditorSurface}` : 'min-w-0'}
    >
      {routedInvite && (
        <div className="space-y-1 px-4 pt-4 sm:px-6">
          <h2 className="text-lg font-semibold">{word('invite')}</h2>
          <p className="text-sm text-muted-foreground">{word('consent')}</p>
        </div>
      )}
      <div className={cn('space-y-3', routedInvite && 'px-4 py-4 sm:px-6')}>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className={cn(recordEditorGrid, 'sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="team-username">{word('username')}</Label>
            <Input
              {...invitation.bind('username')}
              autoFocus
              id="team-username"
              dir="ltr"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@example.com"
              required
              aria-required="true"
              maxLength={254}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={inviting || !!inviteRecovery}
            />
            {invitation.errors.username && (
              <p
                id={invitation.errorId('username')}
                role="alert"
                className="text-sm text-destructive"
              >
                {invitation.errors.username.message}
              </p>
            )}
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="invite-role">{word('role')}</Label>
            <NativeSelect
              {...invitation.bind('role')}
              id="invite-role"
              aria-required="true"
              className="w-full"
              aria-describedby={[
                'invite-role-effect',
                invitation.errors.role ? invitation.errorId('role') : null,
              ]
                .filter(Boolean)
                .join(' ')}
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
              disabled={inviting || !!inviteRecovery}
            >
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {word(item)}
                </option>
              ))}
            </NativeSelect>
            <p id="invite-role-effect" className="text-sm text-muted-foreground">
              {word(`roleEffect.${role}`)}
            </p>
            {invitation.errors.role && (
              <p id={invitation.errorId('role')} role="alert" className="text-sm text-destructive">
                {invitation.errors.role.message}
              </p>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="invite-message">{word('message')}</Label>
          <Textarea
            {...invitation.bind('message')}
            id="invite-message"
            rows={2}
            placeholder={word('messageExample')}
            maxLength={1000}
            value={message}
            aria-describedby={[
              'invite-message-hint',
              invitation.errors.message ? invitation.errorId('message') : null,
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={inviting || !!inviteRecovery}
            onChange={(event) => setMessage(event.target.value)}
          />
          <p id="invite-message-hint" className="text-sm text-muted-foreground">
            {word('messageHint')}
          </p>
          {invitation.errors.message && (
            <p id={invitation.errorId('message')} role="alert" className="text-sm text-destructive">
              {invitation.errors.message.message}
            </p>
          )}
        </div>
        {username.trim() && (
          <p
            role="status"
            className="rounded-md bg-muted/60 px-3 py-2 text-sm [overflow-wrap:anywhere]"
          >
            {word('invitePreview')
              .replace('{username}', username.trim())
              .replace('{role}', word(role))
              .replace('{entity}', team?.profileName ?? word('legalEntity'))}
          </p>
        )}
      </div>
      <RecordEditorActions
        secondary={
          <ListRefreshButton
            ref={routedInvite ? refreshMembers : undefined}
            label={word('refreshMembers')}
            disabled={loading || inviting}
            onClick={reloadMembers}
          />
        }
      >
        <Button
          type="button"
          variant="ghost"
          disabled={inviting || invitation.form.formState.isSubmitting}
          onClick={() => {
            if (invitationPending.current) return;
            if (routedInvite && workspace) workspace.navigate('invitations');
            else {
              restoreInviteFocus.current = true;
              setInvitationOpen(false);
            }
          }}
        >
          {word('cancel')}
        </Button>
        <Button
          type="submit"
          aria-busy={inviting || invitation.form.formState.isSubmitting || undefined}
          disabled={
            !ready || inviting || !!inviteRecovery || invitation.form.formState.isSubmitting
          }
        >
          {inviting && (
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
          )}
          {word(inviting ? 'working' : 'sendInvite')}
        </Button>
      </RecordEditorActions>
    </form>
  ) : null;

  return (
    <section className="min-w-0 space-y-4">
      <h2 ref={teamHeading} tabIndex={-1} className="sr-only">
        {word('members')}
      </h2>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      {error && !invitationOpen && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {memberRecovery && !action && !detailedEntry && (
        <p role="alert" className="text-destructive">
          {confirmationText('unconfirmed', locale)}
        </p>
      )}
      <ListPage>
        {((!routedInvite && !refreshInEditor) || !team) && (
          <ListPage.Toolbar>
            {memberRefresh}
            {showMembers &&
              team?.canTransferOwnership &&
              !Array.from(members.values()).some((member) => member.roles.includes('Owner')) && (
                <Button
                  ref={transferTrigger}
                  variant="outline"
                  disabled={
                    !ready ||
                    !transferAllowed ||
                    !eligibleOwners.length ||
                    !!action ||
                    !!ownershipStep
                  }
                  onClick={startOwnership}
                >
                  {word('transfer')}
                </Button>
              )}
          </ListPage.Toolbar>
        )}
        <ListPage.Content
          loading={loading}
          error={resource.error || scope.denied}
          retainContent={!!team}
          empty={false}
          emptyView={null}
          loadingView={<LoadingStatus>{word('loading')}</LoadingStatus>}
          errorView={<p role="alert">{word(scope.denied ? 'forbidden' : 'loadError')}</p>}
        >
          {team && (
            <>
              {workspace && (showMembers || showInvitations) && (
                <Link
                  to="/settings/team/$section"
                  params={{ section: 'invite' }}
                  className={buttonVariants({ className: 'min-h-11' })}
                  disabled={!ready || !!action || !!ownershipStep}
                >
                  {word('invite')}
                </Link>
              )}
              {!workspace && (
                <Button
                  ref={inviteTrigger}
                  disabled={!ready || !!action || !!ownershipStep}
                  onClick={() => {
                    if (!inviteRecovery) setError(null);
                    setInvitationOpen(true);
                  }}
                >
                  {word('invite')}
                </Button>
              )}
              {section === 'roles' && (
                <section className="space-y-4">
                  <h2 className="text-lg font-semibold">{word('roles')}</h2>
                  <p className="text-sm text-muted-foreground">{word('rolesCombine')}</p>
                  <ul className="grid gap-3 sm:grid-cols-2">
                    {(['Owner', ...ROLES] as const).map((role) => (
                      <li key={role} className="space-y-2 rounded-lg border bg-card p-4">
                        <h3 className="font-semibold">{word(role === 'Owner' ? 'owner' : role)}</h3>
                        <p className="text-sm text-muted-foreground">
                          {word(`roleEffect.${role}`)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {routedId && ready && !detailedEntry && <p role="alert">{word('recordMissing')}</p>}
              {(showMembers || showInvitations) && (
                <div className="space-y-3">
                  <h2 id="members-title" className="text-lg font-semibold">
                    {word(rosterLabel)}
                  </h2>
                  {showMembers && (
                    <p className="text-sm text-muted-foreground">{word('lastActiveHint')}</p>
                  )}
                  <div
                    role="region"
                    aria-label={word(rosterLabel)}
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling for the overflowing table.
                    tabIndex={0}
                    className="min-w-0 md:overflow-x-auto md:rounded-lg md:border md:bg-card md:text-card-foreground"
                  >
                    <table
                      role={compact ? 'presentation' : undefined}
                      className="block w-full text-start text-sm md:table"
                    >
                      <caption className="sr-only">{word(rosterLabel)}</caption>
                      <thead className="hidden md:table-header-group">
                        <tr className="border-b">
                          {[
                            word('agent'),
                            word('roles'),
                            word('status'),
                            word('invitedOn'),
                            word('joined'),
                            word('lastActive'),
                            word('actions'),
                          ].map((label) => (
                            <th
                              key={label}
                              scope="col"
                              data-table-actions={label === word('actions') ? '' : undefined}
                              className="p-3 text-start font-medium"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody
                        role={compact ? 'list' : undefined}
                        aria-label={compact ? word(rosterLabel) : undefined}
                        className="block space-y-3 md:table-row-group md:space-y-0"
                      >
                        {(!showMembers || members.size === 0) &&
                          (!showInvitations || invitations.length === 0) && (
                            <tr
                              role={compact ? 'listitem' : undefined}
                              className="block md:table-row"
                            >
                              <TeamRecordCell compact={compact} colSpan={7}>
                                {word('empty')}
                              </TeamRecordCell>
                            </tr>
                          )}
                        {showMembers &&
                          Array.from(members, ([userId, member]) => (
                            <Member
                              formatJoinedAt={(value) =>
                                time.format(value, { dateStyle: 'medium' })
                              }
                              key={userId}
                              compact={compact}
                              entry={member.entry}
                              onTransfer={
                                team.canTransferOwnership && member.roles.includes('Owner')
                                  ? startOwnership
                                  : undefined
                              }
                              transferRef={transferTrigger}
                              canTransfer={transferAllowed && !!eligibleOwners.length}
                              canCommand={ready}
                              locked={!!action || !!ownershipStep}
                              roles={member.roles}
                              recordId={workspace ? userId : undefined}
                              onDetails={(button) => {
                                detailTrigger.current = button;
                                setDetail({ type: 'agent', id: userId });
                              }}
                              onSave={(roles, onConfirmed, onValidationError) =>
                                saveMember(
                                  userId,
                                  member.entry,
                                  roles,
                                  onConfirmed,
                                  onValidationError
                                )
                              }
                              onRemove={() => removeMember(userId, member.entry)}
                            />
                          ))}
                        {showInvitations &&
                          invitations.map((entry) => (
                            <tr
                              key={entry.id}
                              role={compact ? 'listitem' : undefined}
                              className={teamRecordClass}
                            >
                              <TeamRecordCell compact={compact}>
                                <TeamIdentity entry={entry} />
                              </TeamRecordCell>
                              <TeamRecordCell compact={compact} label={word('roles')}>
                                <Badge variant="secondary">{word(entry.role)}</Badge>
                              </TeamRecordCell>
                              <TeamRecordCell compact={compact} label={word('status')}>
                                {word('pending')}
                              </TeamRecordCell>
                              <TeamRecordCell compact={compact} label={word('invitedOn')}>
                                <time dateTime={entry.createdAt}>
                                  {time.format(entry.createdAt, { dateStyle: 'medium' })}
                                </time>
                              </TeamRecordCell>
                              <TeamRecordCell compact={compact} className="hidden md:table-cell">
                                —
                              </TeamRecordCell>
                              <TeamRecordCell compact={compact} className="hidden md:table-cell">
                                —
                              </TeamRecordCell>
                              <TeamRecordCell
                                compact={compact}
                                data-table-actions={compact ? undefined : ''}
                                className="flex flex-wrap gap-2 md:table-cell"
                              >
                                {workspace ? (
                                  <Link
                                    {...teamRecordLink('invitations', entry.id)}
                                    className={buttonVariants({
                                      variant: 'outline',
                                      className: 'min-h-11',
                                    })}
                                    disabled={!ready || !!action || !!ownershipStep}
                                    data-table-action-tooltip={word('details')}
                                  >
                                    <TableActionIcon icon={TableEyeIcon}>
                                      {word('details')}
                                    </TableActionIcon>
                                  </Link>
                                ) : (
                                  <Button
                                    variant="outline"
                                    disabled={!ready || !!action || !!ownershipStep}
                                    onClick={(event) => {
                                      detailTrigger.current = event.currentTarget;
                                      setDetail({ type: 'invitation', id: entry.id });
                                    }}
                                    data-table-action-tooltip={word('details')}
                                  >
                                    <TableActionIcon icon={TableEyeIcon}>
                                      {word('details')}
                                    </TableActionIcon>
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  disabled={!ready || !!action || !!ownershipStep}
                                  onClick={() => withdraw(entry)}
                                  data-table-action-tooltip={word('withdraw')}
                                >
                                  <TableActionIcon icon={TableUndo2Icon}>
                                    {word('withdraw')}
                                  </TableActionIcon>
                                </Button>
                              </TeamRecordCell>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </ListPage.Content>
      </ListPage>
      {detail && detailedEntry && (
        <AgentDetailDialog
          key={`${detail.type}:${detail.id}`}
          entry={detailedEntry}
          roles={detailedMember?.roles ?? [detailedEntry.role]}
          profileId={profile.id}
          scope={scope}
          onUnauthorized={memberReadUnauthorized}
          visible={!action && !ownershipStep}
          canCommand={ready}
          onClose={closeDetail}
          onSave={(roles, onConfirmed, onValidationError) =>
            saveMember(detail.id, detailedEntry, roles, onConfirmed, onValidationError)
          }
          onRemove={() => removeMember(detail.id, detailedEntry)}
          onWithdraw={() => withdraw(detailedEntry)}
          revision={activityRevision}
          refreshMembers={reloadMembers}
          editorRefresh={refreshInEditor ? memberRefresh : undefined}
          recoveryNotice={memberRecovery ? confirmationText('unconfirmed', locale) : undefined}
          refreshError={memberRecovery !== null && resource.error}
          page={routedId ? (workspace?.edit ? 'edit' : 'detail') : undefined}
        />
      )}
      {routedInvite && team && !scope.denied && inviteForm}
      {localInvite && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !invitationPending.current) {
              restoreInviteFocus.current = true;
              setInvitationOpen(false);
            }
          }}
        >
          <DialogContent
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            showCloseButton={!inviting && !invitation.form.formState.isSubmitting}
            className="max-h-[90dvh] overflow-y-auto"
            finalFocus={false}
          >
            <DialogHeader>
              <DialogTitle>{word('invite')}</DialogTitle>
              <DialogDescription>{word('consent')}</DialogDescription>
            </DialogHeader>
            {inviteForm}
          </DialogContent>
        </Dialog>
      )}
      {action && !ownershipStep && (
        <TeamActionDialog
          key={`${action.method}:${action.path}`}
          action={action}
          onClose={() => {
            setMemberPending(false);
            setAction(null);
          }}
          onSuccess={finished}
          {...(action.onValidationError ? { onValidationError: action.onValidationError } : {})}
          onDenied={denyTeam}
          onPendingChange={setMemberPending}
          onUnconfirmed={() =>
            setMemberRecovery({
              after: resource.nextReadAttempt(),
              mayRevokeSession: actor !== null && action.memberUserId === actor,
            })
          }
          confirmationDisabled={!ready || staleReview}
          summary={
            <div className="space-y-2">
              <Button variant="outline" disabled={loading || memberPending} onClick={reloadMembers}>
                {word('refreshMembers')}
              </Button>
              {memberRecovery && resource.error && <p role="alert">{word('loadError')}</p>}
            </div>
          }
          finalFocus={
            detail
              ? false
              : action.path === `${base}/transfer-ownership`
                ? transferTrigger
                : refreshMembers
          }
        />
      )}
      {ownershipStep && (
        <TeamActionDialog
          focusConfirmation
          onDenied={denyTeam}
          confirmationDisabled={!ready || staleReview || !transferAllowed || transferUnconfirmed}
          onUnconfirmed={() => {
            if (ownershipStep !== 'confirm') return;
            setTransferUnconfirmed(true);
            refreshTransfers();
          }}
          summary={
            <Button variant="outline" disabled={loading} onClick={resource.retry}>
              {word('refreshMembers')}
            </Button>
          }
          {...(ownershipStep === 'confirm' && action
            ? { action }
            : {
                verification: { title: word('transfer'), description: word('transferVerify') },
                selection:
                  ownershipStep === 'select' ? (
                    <form
                      className="space-y-4"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const member = eligibleOwners.find(([id]) => id === recipientId)?.[1];
                        if (!ready || !transferAllowed || !team?.canTransferOwnership || !member)
                          return;
                        const name =
                          member.entry.name ??
                          (member.entry.username
                            ? maskDestination(member.entry.username)
                            : word('unnamed'));
                        setOwnershipStep('confirm');
                        openAction({
                          risk: 'destructive',
                          title: word('transfer'),
                          description: word('transferWarning').replace('{name}', name),
                          path: `${base}/transfer-ownership`,
                          method: 'POST',
                          successStatus: 201,
                          body: { newOwnerUserId: recipientId },
                          successMessage: word('transferSent').replace('{name}', name),
                        });
                      }}
                    >
                      <DialogHeader>
                        <DialogTitle>{word('selectOwner')}</DialogTitle>
                        <DialogDescription>{word('selectOwnerHint')}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-2">
                        <Label htmlFor="ownership-recipient">{word('newOwner')}</Label>
                        <select
                          id="ownership-recipient"
                          tabIndex={0}
                          ref={recipientSelect}
                          // eslint-disable-next-line jsx-a11y/no-autofocus -- Focus the agent picker when the modal advances after step-up.
                          autoFocus
                          required
                          aria-required="true"
                          className="w-full rounded border border-input bg-background text-foreground p-2"
                          value={recipientId}
                          onChange={(event) => setRecipientId(event.target.value)}
                        >
                          <option value="" disabled>
                            {word('selectOwner')}
                          </option>
                          {eligibleOwners.map(([id, member]) => (
                            <option key={id} value={id}>
                              {member.entry.name ??
                                (member.entry.username
                                  ? maskDestination(member.entry.username)
                                  : word('unnamed'))}
                            </option>
                          ))}
                        </select>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={closeOwnership}>
                          {word('cancel')}
                        </Button>
                        <Button type="submit" disabled={!ready || !transferAllowed || !recipientId}>
                          {word('continue')}
                        </Button>
                      </DialogFooter>
                    </form>
                  ) : undefined,
              })}
          onSuccess={
            ownershipStep === 'confirm' ? finished : async () => setOwnershipStep('select')
          }
          onClose={closeOwnership}
          finalFocus={false}
        />
      )}
    </section>
  );
}
const teamRecordClass =
  'block min-w-0 rounded-lg border bg-card text-card-foreground [overflow-wrap:anywhere] md:table-row md:rounded-none md:border-x-0 md:border-b-0 md:align-top';

function TeamRecordCell({
  compact,
  label,
  className,
  children,
  ...props
}: ComponentProps<'td'> & { compact: boolean; label?: string }) {
  return (
    <td
      role={compact ? 'presentation' : undefined}
      className={cn('block min-w-0 p-3 md:table-cell', className)}
      {...props}
    >
      {label && <p className="font-medium text-muted-foreground md:hidden">{label}</p>}
      {children}
    </td>
  );
}

function Member({
  entry,
  recordId,
  roles,
  compact,
  onSave,
  onRemove,
  formatJoinedAt,
  canCommand,
  locked,
  onTransfer,
  transferRef,
  canTransfer,
  onDetails,
}: {
  entry: Entry;
  recordId?: string | undefined;
  compact: boolean;
  onDetails: (button: HTMLButtonElement) => void;
  onTransfer: (() => void) | undefined;
  transferRef: React.RefObject<HTMLButtonElement | null>;
  canTransfer: boolean;
  canCommand: boolean;
  locked: boolean;
  formatJoinedAt: (value: string) => string;
  roles: string[];
  onSave: (
    roles: Role[],
    onConfirmed: () => void,
    onValidationError: (fields: unknown[]) => boolean
  ) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const draft = useTeamRoleDraft(roles);
  const stale = draft.stale;
  const owner = roles.includes('Owner');
  const liveCanSave = useRef(false);
  liveCanSave.current = canCommand && !locked && !stale && !owner;
  const word = (key: string) => t(`team.${key}`, locale);
  return (
    <tr role={compact ? 'listitem' : undefined} className={teamRecordClass}>
      <TeamRecordCell compact={compact}>
        <TeamIdentity entry={entry} owner={owner} />
      </TeamRecordCell>
      <TeamRecordCell compact={compact} label={word('roles')} className="md:min-w-44">
        <div className="mb-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <Badge key={role} variant="secondary">
              {word(role === 'Owner' ? 'owner' : role)}
            </Badge>
          ))}
        </div>
        {!owner && !recordId && (
          <TeamRoleFields draft={draft} locked={locked} canCommand={canCommand} />
        )}
      </TeamRecordCell>
      <TeamRecordCell compact={compact} label={word('status')}>
        {word('active')}
      </TeamRecordCell>
      <TeamRecordCell compact={compact} label={word('invitedOn')} className="md:whitespace-nowrap">
        {entry.invitedAt ? (
          <time dateTime={entry.invitedAt}>{formatJoinedAt(entry.invitedAt)}</time>
        ) : (
          '—'
        )}
      </TeamRecordCell>
      <TeamRecordCell compact={compact} label={word('joined')} className="md:whitespace-nowrap">
        {entry.joinedAt ? (
          <time dateTime={entry.joinedAt}>{formatJoinedAt(entry.joinedAt)}</time>
        ) : (
          '—'
        )}
      </TeamRecordCell>
      <TeamRecordCell
        compact={compact}
        label={word('lastActive')}
        className="md:whitespace-nowrap"
        title={word('lastActiveHint')}
      >
        {entry.lastActiveAt ? (
          <time dateTime={entry.lastActiveAt}>{formatJoinedAt(entry.lastActiveAt)}</time>
        ) : (
          '—'
        )}
      </TeamRecordCell>
      <TeamRecordCell compact={compact} data-table-actions={compact ? undefined : ''}>
        <div className="flex flex-wrap gap-2">
          {recordId ? (
            <Link
              {...teamRecordLink('members', recordId)}
              className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
              disabled={!canCommand || locked}
              data-table-action-tooltip={word('details')}
            >
              <TableActionIcon icon={TableEyeIcon}>{word('details')}</TableActionIcon>
            </Link>
          ) : (
            <Button
              variant="outline"
              disabled={!canCommand || locked}
              onClick={(event) => onDetails(event.currentTarget)}
              data-table-action-tooltip={word('details')}
            >
              <TableActionIcon icon={TableEyeIcon}>{word('details')}</TableActionIcon>
            </Button>
          )}
          {onTransfer && (
            <Button
              ref={transferRef}
              variant="outline"
              disabled={!canCommand || locked || !canTransfer}
              onClick={onTransfer}
              data-table-action-tooltip={word('transfer')}
            >
              <TableActionIcon icon={TableArrowLeftRightIcon}>{word('transfer')}</TableActionIcon>
            </Button>
          )}
          {recordId ? (
            !owner && (
              <Link
                {...teamRecordLink('members', recordId, true)}
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                disabled={!canCommand || locked}
                data-table-action-tooltip={word('editRoles')}
              >
                <TableActionIcon icon={TableUserCogIcon}>{word('editRoles')}</TableActionIcon>
              </Link>
            )
          ) : (
            <Button
              variant="outline"
              disabled={
                !canCommand ||
                locked ||
                stale ||
                owner ||
                draft.form.formState.isSubmitting ||
                draft.unchanged
              }
              onClick={draft.form.handleSubmit(
                ({ roles }) =>
                  liveCanSave.current && onSave(roles, draft.confirm, draft.onValidationError)
              )}
              data-table-action-tooltip={word('saveRoles')}
            >
              <TableActionIcon icon={TableSaveIcon}>{word('saveRoles')}</TableActionIcon>
            </Button>
          )}
          {!recordId && (
            <Button
              variant="outline"
              disabled={!canCommand || locked || owner}
              onClick={onRemove}
              data-table-action-tooltip={word('remove')}
            >
              <TableActionIcon icon={TableTrash2Icon}>{word('remove')}</TableActionIcon>
            </Button>
          )}
        </div>
        {owner && <p className="mt-2 text-sm text-muted-foreground">{word('lastOwner')}</p>}
      </TeamRecordCell>
    </tr>
  );
}
