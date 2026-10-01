import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/team';
import {
  Badge,
  ListPage,
  Button,
  Dialog,
  DialogContent,
  Input,
  Label,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';

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

export function TeamPage() {
  const revision = useProfileContextRevision();
  return <TeamCatalogue key={revision} />;
}
function TeamCatalogue() {
  const locale = useLocale();
  const time = useAccountTime();
  const word = (key: string) => t(`team.${key}`, locale);
  const [review, setReview] = useState<{ action: TeamAction; id: string; basis: string } | null>(
    null
  );
  const [notice, setNotice] = useState<string | null>(null);
  const clearPrivate = useCallback(() => {
    setReview(null);
    setNotice(null);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const profiles = useCatalogueResource(scope, '/api/profiles', validTeamProfiles);
  const transfers = useCatalogueResource(
    scope,
    '/api/profiles/ownership-transfers',
    validTransfers
  );
  const active = profiles.data?.profiles.find((p) => p.id === profiles.data?.activeProfileId);
  const profileReady = !profiles.loading && !profiles.error && !!profiles.data;
  const transferReady = !transfers.loading && !transfers.error && !!transfers.data;
  const refreshTransfers = useRef<HTMLButtonElement>(null);
  const selected = transfers.data?.transfers.find((row) => row.id === review?.id);
  const stale = !!review && (!selected || transferBasis(selected) !== review.basis);
  useEffect(() => {
    if (review && transferReady && stale) {
      setReview(null);
      refreshTransfers.current?.focus();
    }
  }, [review, transferReady, stale]);
  return (
    <div
      className="mx-auto min-w-0 max-w-4xl space-y-6 rounded-lg bg-background p-4 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <h1 className="text-2xl font-bold">{word('title')}</h1>
      {notice && (
        <p role="status" className="text-success">
          {notice}
        </p>
      )}
      <section aria-labelledby="ownership-title">
        <ListPage>
          <ListPage.Toolbar>
            <h2 id="ownership-title" className="text-lg font-semibold">
              {word('transfers')}
            </h2>
            <Button
              ref={refreshTransfers}
              variant="outline"
              onClick={() => (scope.denied ? scope.recover() : transfers.retry())}
            >
              {word('refreshTransfers')}
            </Button>
          </ListPage.Toolbar>
          <ListPage.Content
            loading={transfers.loading}
            error={transfers.error || scope.denied}
            retainContent={!!transfers.data?.transfers.length}
            empty={!!transfers.data && !transfers.data.transfers.length}
            loadingView={<p role="status">{word('loading')}</p>}
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
                      ? ['accept', 'decline']
                      : ['cancelTransfer']
                    ).map((decision) => (
                      <Button
                        key={decision}
                        variant={decision === 'accept' ? 'default' : 'outline'}
                        disabled={!transferReady || !!review}
                        onClick={() => {
                          setNotice(null);
                          setReview({
                            id: transfer.id,
                            basis: transferBasis(transfer),
                            action: {
                              title: word(decision),
                              description: word(
                                decision === 'accept' ? 'acceptWarning' : 'decisionWarning'
                              ),
                              path: `/api/profiles/${encodeURIComponent(transfer.profileId)}/ownership-${decision === 'cancelTransfer' ? 'cancel' : decision}`,
                              method: 'POST',
                              body: { transferId: transfer.id },
                              signsOut: decision === 'accept',
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
      <ListPage>
        <ListPage.Toolbar>
          <Button
            variant="outline"
            onClick={() => (scope.denied ? scope.recover() : profiles.retry())}
          >
            {word('refreshProfiles')}
          </Button>
        </ListPage.Toolbar>
        <ListPage.Content
          loading={profiles.loading}
          error={profiles.error || scope.denied}
          retainContent={!!profiles.data}
          empty={false}
          emptyView={null}
          loadingView={<p role="status">{word('loading')}</p>}
          errorView={<p role="alert">{word(scope.denied ? 'forbidden' : 'loadError')}</p>}
        >
          {!scope.denied &&
            profiles.data &&
            (active?.profileType === 'LEGAL' ? (
              <TeamMembers
                key={`${scope.version}:${active.id}`}
                profile={active}
                profileReady={profileReady}
                onSessionDenied={scope.deny}
              />
            ) : (
              <p role="status">{word('selectLegal')}</p>
            ))}
        </ListPage.Content>
      </ListPage>
      {review && (
        <TeamActionDialog
          action={review.action}
          onClose={() => setReview(null)}
          onDenied={scope.deny}
          confirmationDisabled={!transferReady || stale}
          finalFocus={refreshTransfers}
          summary={
            <Button variant="outline" disabled={transfers.loading} onClick={transfers.retry}>
              {word('refreshTransfers')}
            </Button>
          }
          onSuccess={async () => {
            if (!transferReady || stale) return;
            transfers.retry();
            setNotice(word('saved'));
          }}
        />
      )}
    </div>
  );
}
function TeamMembers({
  profile,
  profileReady,
  onSessionDenied,
}: {
  profile: { id: string; title?: string | null };
  profileReady: boolean;
  onSessionDenied: () => void;
}) {
  const time = useAccountTime();
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<
    (TeamAction & { successMessage?: string; onConfirmed?: () => void }) | null
  >(null);
  const [ownershipStep, setOwnershipStep] = useState<'verify' | 'select' | 'confirm' | null>(null);
  const [recipientId, setRecipientId] = useState('');
  const transferTrigger = useRef<HTMLButtonElement>(null);
  const recipientSelect = useRef<HTMLSelectElement>(null);
  const restoreTransferFocus = useRef(false);
  const teamHeading = useRef<HTMLHeadingElement>(null);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('Manager');
  const [inviting, setInviting] = useState(false);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const inviteTrigger = useRef<HTMLButtonElement>(null);
  const restoreInviteFocus = useRef(false);
  const focusRefreshPending = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const reviewBasis = useRef<string | null>(null);
  const refreshMembers = useRef<HTMLButtonElement>(null);
  const invitationPending = useRef(false);
  const word = (key: string) => t(`team.${key}`, locale);

  const clearPrivate = useCallback(() => {
    generation.current++;
    restoreInviteFocus.current = false;
    restoreTransferFocus.current = false;
    focusRefreshPending.current = false;
    invitationPending.current = false;
    setInviting(false);
    setInvitationOpen(false);
    setOwnershipStep(null);
    setAction(null);
    setUsername('');
    setRecipientId('');
    setError(null);
    setNotice(null);
  }, []);
  const scope = useCatalogueScope(clearPrivate);
  const validate = useCallback(
    (value: unknown): value is Team => validTeam(value) && value.profileId === profile.id,
    [profile.id]
  );
  const resource = useCatalogueResource(
    scope,
    `/api/profiles/${encodeURIComponent(profile.id)}/agents`,
    validate,
    { onUnauthorized: onSessionDenied }
  );
  const team = resource.data
    ? {
        ...resource.data,
        profileName: resource.data.profileName || profile.title || word('legalEntity'),
      }
    : null;
  const denyTeam = (status?: 401 | 403) => {
    if (status === 401) onSessionDenied();
    scope.deny();
  };
  const loading = resource.loading;
  const ready = profileReady && !!team && !resource.loading && !resource.error && !scope.denied;
  const basis = team ? teamBasis(team) : null;
  const liveBasis = useRef(basis);
  liveBasis.current = basis;
  const staleReview = !!(action || ownershipStep) && reviewBasis.current !== basis;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (ready && staleReview) {
      setAction(null);
      setOwnershipStep(null);
      setRecipientId('');
      refreshMembers.current?.focus();
    }
  }, [ready, staleReview]);
  const load = async () => {
    focusRefreshPending.current = true;
    resource.retry();
  };
  useEffect(() => {
    if (loading) focusRefreshPending.current = false;
    if (
      !ownershipStep &&
      !loading &&
      !focusRefreshPending.current &&
      restoreTransferFocus.current
    ) {
      restoreTransferFocus.current = false;
      (
        (ready ? transferTrigger.current : null) ??
        refreshMembers.current ??
        teamHeading.current
      )?.focus();
    }
  }, [ownershipStep, loading, ready]);
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
    if (!ready || !team || invitationPending.current) return;
    const version = generation.current,
      epoch = scope.version;
    const current = () =>
      mounted.current && generation.current === version && scope.live.current === epoch;
    invitationPending.current = true;
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/profiles/${encodeURIComponent(team.profileId)}/invitations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ username: username.trim(), role }),
        }
      );
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        denyTeam(response.status);
        return;
      }
      if (!response.ok) {
        setError(
          word(
            response.status === 409 ? 'conflict' : response.status === 429 ? 'rateLimit' : 'error'
          )
        );
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (
        response.status !== 201 ||
        !result ||
        typeof result !== 'object' ||
        !('id' in result) ||
        typeof result.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)
      ) {
        setError(word('error'));
        return;
      }
      setUsername('');
      restoreInviteFocus.current = true;
      setInvitationOpen(false);
      await load();
      setNotice(word('invited'));
    } catch {
      if (current()) setError(word('error'));
    } finally {
      if (current()) {
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
  const eligibleOwners = Array.from(members).filter(([, member]) =>
    member.roles.some((role) => ROLES.some((eligible) => eligible === role))
  );
  const base = `/api/profiles/${encodeURIComponent(team?.profileId ?? '')}`;
  const openAction = (next: TeamAction & { successMessage?: string; onConfirmed?: () => void }) => {
    if (!ready) return;
    reviewBasis.current = basis;
    setNotice(null);
    setAction(next);
  };
  const finished = async (result: unknown) => {
    if (!mounted.current || reviewBasis.current !== liveBasis.current) return;
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
    action?.onConfirmed?.();
    await load();
    setNotice(action?.successMessage ?? word('saved'));
  };
  const closeOwnership = () => {
    restoreTransferFocus.current = true;
    setOwnershipStep(null);
    setAction(null);
  };

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
      <ListPage>
        <ListPage.Toolbar>
          <Button
            ref={refreshMembers}
            variant="outline"
            onClick={() => (scope.denied ? scope.recover() : resource.retry())}
          >
            {word('refreshMembers')}
          </Button>
          {team?.canTransferOwnership && (
            <Button
              ref={transferTrigger}
              variant="outline"
              disabled={!ready || !eligibleOwners.length || !!action || !!ownershipStep}
              onClick={() => {
                reviewBasis.current = basis;
                setNotice(null);
                setRecipientId('');
                setOwnershipStep('verify');
              }}
            >
              {word('transfer')}
            </Button>
          )}
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={resource.error || scope.denied}
          retainContent={!!team}
          empty={false}
          emptyView={null}
          loadingView={<p role="status">{word('loading')}</p>}
          errorView={<p role="alert">{word(scope.denied ? 'forbidden' : 'loadError')}</p>}
        >
          {team && (
            <>
              {' '}
              <Button
                ref={inviteTrigger}
                disabled={!ready || !!action || !!ownershipStep}
                onClick={() => {
                  setError(null);
                  setInvitationOpen(true);
                }}
              >
                {word('invite')}
              </Button>
              <div className="space-y-3">
                <h2 id="members-title" className="text-lg font-semibold">
                  {word('members')}
                </h2>
                <div
                  role="region"
                  aria-label={word('members')}
                  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling for the overflowing table.
                  tabIndex={0}
                  className="overflow-x-auto rounded-lg border bg-card text-card-foreground"
                >
                  <table className="w-full text-start text-sm">
                    <caption className="sr-only">{word('members')}</caption>
                    <thead>
                      <tr className="border-b">
                        {[
                          word('agent'),
                          word('roles'),
                          word('status'),
                          word('joined'),
                          word('actions'),
                        ].map((label) => (
                          <th key={label} scope="col" className="p-3 text-start font-medium">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {members.size === 0 && invitations.length === 0 && (
                        <tr>
                          <td colSpan={5} className="p-3">
                            {word('empty')}
                          </td>
                        </tr>
                      )}
                      {Array.from(members, ([userId, member]) => (
                        <Member
                          formatJoinedAt={(value) => time.format(value, { dateStyle: 'medium' })}
                          key={userId}
                          entry={member.entry}
                          canCommand={ready}
                          locked={!!action || !!ownershipStep}
                          roles={member.roles}
                          onSave={(roles, onConfirmed) =>
                            openAction({
                              title: word('saveRoles'),
                              description: word('rolesWarning'),
                              path: `${base}/agents/${encodeURIComponent(userId)}/roles`,
                              method: 'PUT',
                              body: { roles },
                              onConfirmed,
                            })
                          }
                          onRemove={() =>
                            openAction({
                              title: word('remove'),
                              description: word('removeWarning'),
                              path: `${base}/agents/${encodeURIComponent(userId)}`,
                              method: 'DELETE',
                            })
                          }
                        />
                      ))}
                      {invitations.map((entry) => (
                        <tr key={entry.id} className="border-t align-top">
                          <td className="p-3">{entry.username}</td>
                          <td className="p-3">
                            <Badge variant="secondary">{word(entry.role)}</Badge>
                          </td>
                          <td className="p-3">{word('pending')}</td>
                          <td className="p-3">
                            <time dateTime={entry.createdAt}>
                              {time.format(entry.createdAt, { dateStyle: 'medium' })}
                            </time>
                          </td>
                          <td className="p-3">
                            <Button
                              variant="outline"
                              disabled={!ready || !!action || !!ownershipStep}
                              onClick={() =>
                                openAction({
                                  title: word('withdraw'),
                                  description: word('withdrawWarning'),
                                  path: `${base}/invitations/${encodeURIComponent(entry.id)}`,
                                  method: 'DELETE',
                                })
                              }
                            >
                              {word('withdraw')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </ListPage.Content>
      </ListPage>
      {invitationOpen && (
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
            showCloseButton={!inviting}
            finalFocus={false}
          >
            <DialogHeader>
              <DialogTitle>{word('invite')}</DialogTitle>
              <DialogDescription>{word('consent')}</DialogDescription>
            </DialogHeader>
            <form onSubmit={invite} className="space-y-4">
              <div className="flex-1 min-w-48 space-y-1">
                <Label htmlFor="team-username">{word('username')}</Label>
                <Input
                  autoFocus
                  id="team-username"
                  required
                  maxLength={254}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={inviting}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-role">{word('role')}</Label>
                <select
                  id="invite-role"
                  tabIndex={0}
                  className="block rounded border border-input bg-background text-foreground p-2"
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                  disabled={inviting}
                >
                  {ROLES.map((item) => (
                    <option key={item} value={item}>
                      {word(item)}
                    </option>
                  ))}
                </select>
              </div>
              {username.trim() && (
                <p role="status" className="[overflow-wrap:anywhere]">
                  {word('invitePreview')
                    .replace('{username}', username.trim())
                    .replace('{role}', word(role))
                    .replace('{entity}', team?.profileName ?? word('legalEntity'))}
                </p>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <Button type="button" variant="outline" disabled={loading} onClick={resource.retry}>
                {word('refreshMembers')}
              </Button>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={inviting}
                  onClick={() => {
                    restoreInviteFocus.current = true;
                    setInvitationOpen(false);
                  }}
                >
                  {word('cancel')}
                </Button>
                <Button type="submit" disabled={!ready || inviting || !username.trim()}>
                  {word(inviting ? 'working' : 'sendInvite')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
      {action && !ownershipStep && (
        <TeamActionDialog
          key={`${action.method}:${action.path}`}
          action={action}
          onClose={() => setAction(null)}
          onSuccess={finished}
          onDenied={denyTeam}
          confirmationDisabled={!ready || staleReview}
          summary={
            <Button variant="outline" disabled={loading} onClick={resource.retry}>
              {word('refreshMembers')}
            </Button>
          }
          finalFocus={action.path === `${base}/transfer-ownership` ? transferTrigger : undefined}
        />
      )}
      {ownershipStep && (
        <TeamActionDialog
          focusConfirmation
          onDenied={denyTeam}
          confirmationDisabled={!ready || staleReview}
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
                        if (!ready || !team?.canTransferOwnership || !member) return;
                        const name = member.entry.name ?? member.entry.username ?? recipientId;
                        setOwnershipStep('confirm');
                        openAction({
                          title: word('transfer'),
                          description: word('transferWarning').replace('{name}', name),
                          path: `${base}/transfer-ownership`,
                          method: 'POST',
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
                          className="w-full rounded border border-input bg-background text-foreground p-2"
                          value={recipientId}
                          onChange={(event) => setRecipientId(event.target.value)}
                        >
                          <option value="" disabled>
                            {word('selectOwner')}
                          </option>
                          {eligibleOwners.map(([id, member]) => (
                            <option key={id} value={id}>
                              {member.entry.name ?? member.entry.username ?? id}
                            </option>
                          ))}
                        </select>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={closeOwnership}>
                          {word('cancel')}
                        </Button>
                        <Button type="submit" disabled={!ready || !recipientId}>
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
function Member({
  entry,
  roles,
  onSave,
  onRemove,
  formatJoinedAt,
  canCommand,
  locked,
}: {
  entry: Entry;
  canCommand: boolean;
  locked: boolean;
  formatJoinedAt: (value: string) => string;
  roles: string[];
  onSave: (roles: Role[], onConfirmed: () => void) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const roleBasis = [...roles].sort().join(',');
  const [draft, setDraft] = useState({
    basis: roleBasis,
    roles: roles.filter((role): role is Role => ROLES.includes(role as Role)),
  });
  const selected = draft.roles;
  const stale = draft.basis !== roleBasis;
  const owner = roles.includes('Owner');
  const word = (key: string) => t(`team.${key}`, locale);
  return (
    <tr className="border-t align-top">
      <td className="p-3">
        <h3 className="font-medium">
          {owner && <span aria-hidden="true">♛ </span>}
          {entry.name ?? entry.username ?? entry.userId}
        </h3>
      </td>
      <td className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <Badge key={role} variant="secondary">
              {word(role === 'Owner' ? 'owner' : role)}
            </Badge>
          ))}
        </div>
        <>
          {!owner && (
            <fieldset disabled={locked} className="flex flex-wrap gap-3">
              <legend className="sr-only">{word('roles')}</legend>
              {ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    tabIndex={0}
                    checked={selected.includes(role)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        roles: event.target.checked
                          ? [...current.roles, role]
                          : current.roles.filter((item) => item !== role),
                      }))
                    }
                  />
                  {word(role)}
                </label>
              ))}
            </fieldset>
          )}
          {stale && (
            <div className="space-y-2">
              <p role="status">{word('staleRoles')}</p>
              <Button
                variant="outline"
                disabled={!canCommand || locked}
                onClick={() =>
                  setDraft({
                    basis: roleBasis,
                    roles: roles.filter((role): role is Role => ROLES.includes(role as Role)),
                  })
                }
              >
                {word('resetRoles')}
              </Button>
            </div>
          )}
        </>
      </td>
      <td className="p-3">{word('active')}</td>
      <td className="p-3 whitespace-nowrap">
        {entry.joinedAt ? (
          <time dateTime={entry.joinedAt}>{formatJoinedAt(entry.joinedAt)}</time>
        ) : (
          '—'
        )}
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={
              !canCommand ||
              locked ||
              stale ||
              owner ||
              !selected.length ||
              (selected.length === roles.length && selected.every((role) => roles.includes(role)))
            }
            onClick={() =>
              onSave(selected, () =>
                setDraft({ basis: [...selected].sort().join(','), roles: selected })
              )
            }
          >
            {word('saveRoles')}
          </Button>
          <Button variant="outline" disabled={!canCommand || locked || owner} onClick={onRemove}>
            {word('remove')}
          </Button>
        </div>
        {owner && <p className="mt-2 text-sm text-muted-foreground">{word('lastOwner')}</p>}
      </td>
    </tr>
  );
}
