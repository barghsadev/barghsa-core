import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/team';
import {
  Badge,
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

const ROLES = ['Manager', 'Finance', 'Legal'] as const;
type Role = (typeof ROLES)[number];
interface Entry {
  id: string;
  type: 'agent' | 'invitation';
  userId: string | null;
  username: string | null;
  name: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
}
interface Transfer {
  id: string;
  profileId: string;
  profileName: string;
  expiresAt: string;
  direction: 'incoming' | 'outgoing';
}
interface Team {
  profileId: string;
  agents: Entry[];
  canTransferOwnership: boolean;
  profileName?: string;
}

export function TeamPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const [team, setTeam] = useState<Team | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamMessage, setTeamMessage] = useState<string | null>(null);
  const [action, setAction] = useState<(TeamAction & { successMessage?: string }) | null>(null);
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
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const invitationPending = useRef(false);
  const word = (key: string) => t(`team.${key}`, locale);

  useEffect(() => {
    if (!ownershipStep && !loading && restoreTransferFocus.current) {
      restoreTransferFocus.current = false;
      (transferTrigger.current ?? teamHeading.current)?.focus();
    }
  }, [ownershipStep, loading]);
  useEffect(() => {
    if (!invitationOpen && !loading && restoreInviteFocus.current) {
      restoreInviteFocus.current = false;
      (inviteTrigger.current ?? teamHeading.current)?.focus();
    }
  }, [invitationOpen, loading]);

  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    setTeam(null);
    setTransfers([]);
    setTeamMessage(null);
    try {
      const [profilesResponse, transfersResponse] = await Promise.all([
        fetch('/api/profiles', { credentials: 'include' }),
        fetch('/api/profiles/ownership-transfers', { credentials: 'include' }),
      ]);
      if (!profilesResponse.ok || !transfersResponse.ok) throw new Error('load');
      const [profiles, transferData] = await Promise.all([
        profilesResponse.json(),
        transfersResponse.json(),
      ]);
      if (generation.current !== version) return;
      setTransfers(transferData.transfers);
      const active = profiles.profiles.find(
        (p: { id: string }) => p.id === profiles.activeProfileId
      );
      if (!active || active.profileType !== 'LEGAL') {
        setTeamMessage(t('team.selectLegal', locale));
        return;
      }
      const response = await fetch(`/api/profiles/${encodeURIComponent(active.id)}/agents`, {
        credentials: 'include',
      });
      if (generation.current !== version) return;
      if (response.status === 403) {
        setTeamMessage(t('team.forbidden', locale));
        return;
      }
      if (!response.ok) throw new Error('load');
      const result: Team = await response.json();
      if (generation.current === version)
        setTeam({
          ...result,
          profileName: result.profileName || active.title || t('team.legalEntity', locale),
        });
    } catch {
      if (generation.current === version) setError(t('team.loadError', locale));
    } finally {
      if (generation.current === version) setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!team || invitationPending.current) return;
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
      if (!response.ok) {
        setError(
          word(
            response.status === 409 ? 'conflict' : response.status === 429 ? 'rateLimit' : 'error'
          )
        );
        return;
      }
      setUsername('');
      restoreInviteFocus.current = true;
      setInvitationOpen(false);
      await load();
      setNotice(word('invited'));
    } catch {
      setError(word('error'));
    } finally {
      invitationPending.current = false;
      setInviting(false);
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
  const openAction = (next: TeamAction & { successMessage?: string }) => {
    setNotice(null);
    setAction(next);
  };
  const finished = async () => {
    await load();
    setNotice(action?.successMessage ?? word('saved'));
  };
  const closeOwnership = () => {
    restoreTransferFocus.current = true;
    setOwnershipStep(null);
    setAction(null);
  };

  return (
    <div
      className="mx-auto max-w-4xl space-y-6 rounded-lg bg-background p-4 text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <h1 ref={teamHeading} tabIndex={-1} className="text-2xl font-bold">
        {word('title')}
      </h1>
      {loading && <p role="status">{word('loading')}</p>}
      {error && !invitationOpen && (
        <div role="alert" className="space-y-2 text-red-700 dark:text-red-300">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            {word('retry')}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-green-800 dark:text-green-300">
          {notice}
        </p>
      )}
      {!loading && (
        <>
          <section
            aria-labelledby="ownership-title"
            className="rounded-lg border bg-card text-card-foreground p-4 space-y-3"
          >
            <h2 id="ownership-title" className="text-lg font-semibold">
              {word('transfers')}
            </h2>
            {team?.canTransferOwnership && (
              <Button
                ref={transferTrigger}
                variant="outline"
                disabled={!eligibleOwners.length}
                onClick={() => {
                  setNotice(null);
                  setRecipientId('');
                  setOwnershipStep('verify');
                }}
              >
                {word('transfer')}
              </Button>
            )}
            {transfers.length === 0 && (
              <p className="text-sm text-muted-foreground">{word('noTransfers')}</p>
            )}
            {transfers.map((transfer) => (
              <article key={transfer.id} className="rounded border p-3 space-y-2">
                <h3 className="font-medium">{transfer.profileName}</h3>
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
                      onClick={() =>
                        openAction({
                          title: word(decision),
                          description: word(
                            decision === 'accept' ? 'acceptWarning' : 'decisionWarning'
                          ),
                          path: `/api/profiles/${encodeURIComponent(transfer.profileId)}/ownership-${decision === 'cancelTransfer' ? 'cancel' : decision}`,
                          method: 'POST',
                          body: { transferId: transfer.id },
                          signsOut: decision === 'accept',
                        })
                      }
                    >
                      {word(decision)}
                    </Button>
                  ))}
                </div>
              </article>
            ))}
          </section>
          {teamMessage && <p role="status">{teamMessage}</p>}
          {team && (
            <>
              <Button
                ref={inviteTrigger}
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
                          key={`${userId}:${member.roles.join(',')}`}
                          entry={member.entry}
                          roles={member.roles}
                          onSave={(roles) =>
                            openAction({
                              title: word('saveRoles'),
                              description: word('rolesWarning'),
                              path: `${base}/agents/${encodeURIComponent(userId)}/roles`,
                              method: 'PUT',
                              body: { roles },
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
                          <td className="p-3">—</td>
                          <td className="p-3">
                            <Button
                              variant="outline"
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
        </>
      )}
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
                <p role="status">
                  {word('invitePreview')
                    .replace('{username}', username.trim())
                    .replace('{role}', word(role))
                    .replace('{entity}', team?.profileName ?? word('legalEntity'))}
                </p>
              )}
              {error && (
                <p role="alert" className="text-red-700 dark:text-red-300">
                  {error}
                </p>
              )}
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
                <Button type="submit" disabled={inviting || !username.trim()}>
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
          finalFocus={action.path === `${base}/transfer-ownership` ? transferTrigger : undefined}
        />
      )}
      {ownershipStep && (
        <TeamActionDialog
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
                        if (!team?.canTransferOwnership || !member) return;
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
                        <Button type="submit" disabled={!recipientId}>
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
    </div>
  );
}

function Member({
  entry,
  roles,
  onSave,
  onRemove,
  formatJoinedAt,
}: {
  entry: Entry;
  formatJoinedAt: (value: string) => string;
  roles: string[];
  onSave: (roles: Role[]) => void;
  onRemove: () => void;
}) {
  const locale = useLocale();
  const [selected, setSelected] = useState<Role[]>(
    roles.filter((role): role is Role => ROLES.includes(role as Role))
  );
  const word = (key: string) => t(`team.${key}`, locale);
  return (
    <tr className="border-t align-top">
      <td className="p-3">
        <h3 className="font-medium">{entry.name ?? entry.username}</h3>
      </td>
      <td className="p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {roles.map((role) => (
            <Badge key={role} variant="secondary">
              {word(role)}
            </Badge>
          ))}
        </div>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="sr-only">{word('roles')}</legend>
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={selected.includes(role)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, role]
                      : current.filter((item) => item !== role)
                  )
                }
              />
              {word(role)}
            </label>
          ))}
        </fieldset>
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
              !selected.length ||
              (selected.length === roles.length && selected.every((role) => roles.includes(role)))
            }
            onClick={() => onSave(selected)}
          >
            {word('saveRoles')}
          </Button>
          <Button variant="outline" onClick={onRemove}>
            {word('remove')}
          </Button>
        </div>
      </td>
    </tr>
  );
}
