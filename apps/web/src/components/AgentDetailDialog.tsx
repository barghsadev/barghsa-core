import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/team';
import {
  validTeamActivity,
  type TeamActivityPage,
  type TeamActivityItem,
} from '@barghsa/shared/team-activity';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useCatalogueResource, type useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { type TeamEntry, type TeamRole } from '../lib/team-catalogue.js';
import { TeamIdentity, TeamRoleFields, useTeamRoleDraft } from './TeamMemberFields.js';

export function AgentDetailDialog({
  entry,
  roles,
  profileId,
  scope,
  onUnauthorized,
  visible,
  canCommand,
  onClose,
  onSave,
  onRemove,
  onWithdraw,
  revision,
  refreshMembers,
}: {
  entry: TeamEntry;
  roles: string[];
  profileId: string;
  scope: ReturnType<typeof useCatalogueScope>;
  onUnauthorized: () => void;
  visible: boolean;
  canCommand: boolean;
  onClose: () => void;
  onSave: (
    roles: TeamRole[],
    onConfirmed: () => void,
    onValidationError: (fields: unknown[]) => boolean
  ) => void;
  onRemove: () => void;
  onWithdraw: () => void;
  revision: number;
  refreshMembers: () => void;
}) {
  const locale = useLocale(),
    time = useAccountTime(),
    word = (key: string) => t(`team.${key}`, locale);
  const draft = useTeamRoleDraft(roles),
    owner = roles.includes('Owner'),
    pending = entry.type === 'invitation';
  const liveCanSave = useRef(false);
  liveCanSave.current = visible && canCommand && !draft.stale && !owner && !pending;
  // Keep the draft above the popup lifecycle, but never leave a second modal behind review.
  if (!visible) return null;
  return (
    <Dialog
      open={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
        finalFocus={false}
        closeLabel={word('close')}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{word(pending ? 'invitationDetails' : 'memberDetails')}</DialogTitle>
          <DialogDescription>{word('detailHint')}</DialogDescription>
        </DialogHeader>
        <TeamIdentity entry={entry} owner={owner} />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{word('status')}</dt>
          <dd>{word(pending ? 'pending' : 'active')}</dd>
          <dt className="text-muted-foreground">{word('roles')}</dt>
          <dd className="flex flex-wrap gap-1">
            {roles.map((role) => (
              <Badge key={role} variant="secondary">
                {word(role === 'Owner' ? 'owner' : role)}
              </Badge>
            ))}
          </dd>
          {(
            [
              ['invitedOn', pending ? entry.createdAt : entry.invitedAt],
              ['joined', entry.joinedAt],
              ['lastActive', entry.lastActiveAt],
            ] as const
          ).map(([label, date]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{word(label)}</dt>
              <dd>
                {date ? (
                  <time dateTime={date}>{time.format(date, { dateStyle: 'medium' })}</time>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          ))}
        </dl>
        {!pending && <p className="text-xs text-muted-foreground">{word('lastActiveHint')}</p>}
        {pending && entry.message && (
          <section className="space-y-2">
            <h3 className="font-medium">{word('message')}</h3>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{entry.message}</p>
          </section>
        )}
        {!pending && !owner && (
          <section className="space-y-3">
            <h3 className="font-medium">{word('roles')}</h3>
            <TeamRoleFields draft={draft} locked={!canCommand} canCommand={canCommand} />
            <Button
              disabled={
                !canCommand || draft.stale || draft.form.formState.isSubmitting || draft.unchanged
              }
              onClick={draft.form.handleSubmit(
                ({ roles }) =>
                  liveCanSave.current && onSave(roles, draft.confirm, draft.onValidationError)
              )}
            >
              {word('saveRoles')}
            </Button>
          </section>
        )}
        <section className="space-y-3" aria-label={word('activity')}>
          <h3 className="font-medium">{word('activity')}</h3>
          {pending ? (
            <>
              <p className="text-sm text-muted-foreground">{word('pendingActivityHint')}</p>
              <p className="text-sm">
                {word('activity.invitationCreated')}{' '}
                <time dateTime={entry.createdAt}>{time.format(entry.createdAt)}</time>
              </p>
            </>
          ) : (
            <ActivityHistory
              key={`${entry.userId}:${revision}`}
              profileId={profileId}
              userId={entry.userId!}
              scope={scope}
              onUnauthorized={onUnauthorized}
            />
          )}
        </section>
        {owner && <p className="text-sm text-muted-foreground">{word('lastOwner')}</p>}
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={refreshMembers}>
            {word('refreshMembers')}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {word('close')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canCommand || owner}
            onClick={pending ? onWithdraw : onRemove}
          >
            {word(pending ? 'withdraw' : 'remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function ActivityHistory({
  profileId,
  userId,
  scope,
  onUnauthorized,
}: {
  profileId: string;
  userId: string;
  scope: ReturnType<typeof useCatalogueScope>;
  onUnauthorized: () => void;
}) {
  const locale = useLocale(),
    time = useAccountTime(),
    word = (key: string) => t(`team.${key}`, locale);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    items: TeamActivityItem[];
    next: string | null;
    loaded: boolean;
  }>({ items: [], next: null, loaded: false });
  const consumed = useRef(new Set<string>());
  const validate = useCallback(
    (value: unknown): value is TeamActivityPage => validTeamActivity(value, profileId, userId),
    [profileId, userId]
  );
  const path = `/api/profiles/${encodeURIComponent(profileId)}/agents/${encodeURIComponent(userId)}/activity${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const resource = useCatalogueResource(scope, path, validate, { onUnauthorized });
  useEffect(() => {
    if (!resource.data || resource.loading || resource.error) return;
    const page = resource.data;
    if (cursor) consumed.current.add(cursor);
    else consumed.current.clear();
    setHistory((previous) => ({
      items: cursor
        ? [
            ...previous.items,
            ...page.items.filter(
              (item) => !previous.items.some((existing) => existing.id === item.id)
            ),
          ]
        : page.items,
      next: page.nextCursor && !consumed.current.has(page.nextCursor) ? page.nextCursor : null,
      loaded: true,
    }));
  }, [resource.data, resource.loading, resource.error, cursor]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{word('activityHint')}</p>
      {resource.loading && <p role="status">{word('activityLoading')}</p>}
      {resource.error && (
        <div className="space-y-2">
          <p role="alert">{word('activityError')}</p>
          <Button variant="outline" onClick={resource.retry}>
            {word('retryActivity')}
          </Button>
        </div>
      )}
      {history.loaded && !history.items.length && <p>{word('activityEmpty')}</p>}
      <ol className="space-y-3 border-s ps-4">
        {history.items.map((item) => (
          <li key={item.id} className="space-y-1 text-sm">
            <p>{word(`activity.${item.kind}`)}</p>
            {!item.performed && (
              <p className="text-xs text-muted-foreground">{word('activityAffectsMember')}</p>
            )}
            <time dateTime={item.createdAt} className="block text-xs text-muted-foreground">
              {time.format(item.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={resource.loading}
          onClick={() => {
            if (cursor) setCursor(null);
            else resource.retry();
          }}
        >
          {word('refreshActivity')}
        </Button>
        {history.next && (
          <Button
            variant="outline"
            disabled={resource.loading || resource.error}
            onClick={() => setCursor(history.next)}
          >
            {word('moreActivity')}
          </Button>
        )}
      </div>
    </div>
  );
}
