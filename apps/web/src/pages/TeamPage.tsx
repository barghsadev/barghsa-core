import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@barghsa/i18n/app';
import { Button, Input, Label } from '@barghsa/ui';
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
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('Manager');
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const invitationPending = useRef(false);
  const word = (key: string) => t(`team.${key}`, locale);

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
      if (generation.current === version) setTeam(result);
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
  const base = `/api/profiles/${encodeURIComponent(team?.profileId ?? '')}`;
  const openAction = (next: TeamAction & { successMessage?: string }) => {
    setNotice(null);
    setAction(next);
  };
  const finished = async () => {
    await load();
    setNotice(action?.successMessage ?? word('saved'));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {time.notice}
      <h1 className="text-2xl font-bold">{word('title')}</h1>
      {loading && <p role="status">{word('loading')}</p>}
      {error && (
        <div role="alert" className="space-y-2 text-red-700">
          <p>{error}</p>
          <Button variant="outline" onClick={() => void load()}>
            {word('retry')}
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-green-800">
          {notice}
        </p>
      )}
      {!loading && (
        <>
          <section
            aria-labelledby="ownership-title"
            className="rounded-lg border bg-white p-4 space-y-3"
          >
            <h2 id="ownership-title" className="text-lg font-semibold">
              {word('transfers')}
            </h2>
            {transfers.length === 0 && (
              <p className="text-sm text-gray-600">{word('noTransfers')}</p>
            )}
            {transfers.map((transfer) => (
              <article key={transfer.id} className="rounded border p-3 space-y-2">
                <h3 className="font-medium">{transfer.profileName}</h3>
                <p>{word(transfer.direction === 'incoming' ? 'incoming' : 'outgoing')}</p>
                <p className="text-sm text-gray-600">
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
              <section
                className="rounded-lg border bg-white p-4 space-y-4"
                aria-labelledby="invite-title"
              >
                <h2 id="invite-title" className="text-lg font-semibold">
                  {word('invite')}
                </h2>
                <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-48 space-y-1">
                    <Label htmlFor="team-username">{word('username')}</Label>
                    <Input
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
                      className="block rounded border p-2"
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
                  <Button type="submit" disabled={inviting || !username.trim()}>
                    {word(inviting ? 'working' : 'sendInvite')}
                  </Button>
                </form>
                <p className="text-sm text-gray-600">{word('consent')}</p>
              </section>
              <section aria-labelledby="members-title" className="space-y-3">
                <h2 id="members-title" className="text-lg font-semibold">
                  {word('members')}
                </h2>
                {members.size === 0 && invitations.length === 0 && <p>{word('empty')}</p>}
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
                    onTransfer={
                      team.canTransferOwnership
                        ? () =>
                            openAction({
                              title: word('transfer'),
                              description: word('transferWarning').replace(
                                '{name}',
                                member.entry.name ?? member.entry.username ?? userId
                              ),
                              path: `${base}/transfer-ownership`,
                              method: 'POST',
                              body: { newOwnerUserId: userId },
                              successMessage: word('transferSent').replace(
                                '{name}',
                                member.entry.name ?? member.entry.username ?? userId
                              ),
                            })
                        : undefined
                    }
                  />
                ))}
                {invitations.map((entry) => (
                  <article
                    key={entry.id}
                    className="rounded-lg border bg-white p-4 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <h3 className="font-medium">{entry.username}</h3>
                      <p className="text-sm">
                        {word(entry.role)} · {word('pending')}
                      </p>
                    </div>
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
                  </article>
                ))}
              </section>
            </>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          key={`${action.method}:${action.path}`}
          action={action}
          onClose={() => setAction(null)}
          onSuccess={finished}
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
  onTransfer,
  formatJoinedAt,
}: {
  entry: Entry;
  formatJoinedAt: (value: string) => string;
  roles: string[];
  onSave: (roles: Role[]) => void;
  onRemove: () => void;
  onTransfer: (() => void) | undefined;
}) {
  const locale = useLocale();
  const [selected, setSelected] = useState<Role[]>(
    roles.filter((role): role is Role => ROLES.includes(role as Role))
  );
  const word = (key: string) => t(`team.${key}`, locale);
  return (
    <article className="rounded-lg border bg-white p-4 space-y-3">
      <h3 className="font-medium">{entry.name ?? entry.username}</h3>
      <p className="text-sm text-gray-600">
        {word('active')}
        {entry.joinedAt && (
          <>
            {' '}
            · {word('joined')}{' '}
            <time dateTime={entry.joinedAt}>{formatJoinedAt(entry.joinedAt)}</time>
          </>
        )}
      </p>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-2 text-sm">{word('roles')}</legend>
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
        {onTransfer && (
          <Button variant="outline" onClick={onTransfer}>
            {word('transfer')}
          </Button>
        )}
      </div>
    </article>
  );
}
