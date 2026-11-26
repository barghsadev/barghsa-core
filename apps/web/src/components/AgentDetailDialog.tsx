import { RecordListSkeleton } from './RecordListSkeleton.js';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  StatusBadge,
  Badge,
  Button,
  buttonVariants,
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
import { teamRecordLink } from '../lib/team-workspace.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';

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
  editorRefresh,
  recoveryNotice,
  refreshError,
  page,
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
  editorRefresh?: ReactNode;
  recoveryNotice: string | undefined;
  refreshError: boolean;
  page?: 'detail' | 'edit' | undefined;
}) {
  const locale = useLocale(),
    time = useAccountTime(),
    word = (key: string) => t(`team.${key}`, locale);
  const draft = useTeamRoleDraft(roles),
    owner = roles.includes('Owner'),
    pending = entry.type === 'invitation';
  const liveCanSave = useRef(false);
  liveCanSave.current = visible && canCommand && !draft.stale && !owner && !pending;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (page) heading.current?.focus();
  }, [page]);
  // Keep the draft above the popup lifecycle, but never leave a second modal behind review.
  if (!visible && !page) return null;
  const title = word(
    page === 'edit' ? 'editRoles' : pending ? 'invitationDetails' : 'memberDetails'
  );
  const submitRoles = draft.form.handleSubmit(
    ({ roles }) => liveCanSave.current && onSave(roles, draft.confirm, draft.onValidationError)
  );
  const saveDisabled =
    !canCommand || draft.stale || draft.form.formState.isSubmitting || draft.unchanged;
  if (page === 'edit' && !pending && !owner)
    return (
      <section className={`max-w-2xl ${recordEditorSurface}`} aria-label={title}>
        <div className="space-y-3 border-b px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <h2
              ref={heading}
              tabIndex={-1}
              className="text-lg font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
            >
              {title}
            </h2>
            {editorRefresh}
          </div>
          <TeamIdentity entry={entry} />
        </div>
        <form onSubmit={submitRoles} aria-label={title}>
          <div className="space-y-3 px-4 py-4 sm:px-6">
            {recoveryNotice && <p role="alert">{recoveryNotice}</p>}
            {refreshError && <p role="alert">{word('loadError')}</p>}
            <p className="text-sm text-muted-foreground">{word('rolesCombine')}</p>
            <TeamRoleFields
              draft={draft}
              locked={!canCommand}
              canCommand={canCommand}
              showEffects
            />
          </div>
          <RecordEditorActions>
            <Button type="button" variant="ghost" onClick={onClose}>
              {word('close')}
            </Button>
            <Button type="submit" disabled={saveDisabled}>
              {word('saveRoles')}
            </Button>
          </RecordEditorActions>
        </form>
      </section>
    );
  const content = (
    <>
      {recoveryNotice && <p role="alert">{recoveryNotice}</p>}
      {refreshError && <p role="alert">{word('loadError')}</p>}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <TeamIdentity entry={entry} owner={owner} />
        <StatusBadge
          state={pending ? 'pending' : 'active'}
          label={word(pending ? 'pending' : 'active')}
        />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{word('roles')}</dt>
          <dd className="mt-1 flex flex-wrap gap-1">
            {roles.map((role) => (
              <Badge key={role} variant="secondary">
                {word(role === 'Owner' ? 'owner' : role)}
              </Badge>
            ))}
          </dd>
        </div>
        {(
          [
            ['invitedOn', pending ? entry.createdAt : entry.invitedAt],
            ['joined', entry.joinedAt],
            ['lastActive', entry.lastActiveAt],
          ] as const
        ).map(
          ([label, date]) =>
            date && (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{word(label)}</dt>
                <dd className="mt-1">
                  <time dateTime={date}>{time.format(date, { dateStyle: 'medium' })}</time>
                </dd>
              </div>
            )
        )}
      </dl>
      {!pending && <p className="text-xs text-muted-foreground">{word('lastActiveHint')}</p>}
      {pending && entry.message && (
        <section className="space-y-2">
          <h3 className="font-medium">{word('message')}</h3>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{entry.message}</p>
        </section>
      )}
      {!pending && !owner && !page && (
        <section className="space-y-3">
          <h3 className="font-medium">{word('roles')}</h3>
          <TeamRoleFields draft={draft} locked={!canCommand} canCommand={canCommand} />
          <Button disabled={saveDisabled} onClick={submitRoles}>
            {word('saveRoles')}
          </Button>
        </section>
      )}
      {page !== 'edit' && (
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
      )}
      {page === 'detail' && !owner && !pending && entry.userId && (
        <Link
          {...teamRecordLink('members', entry.userId, true)}
          className={buttonVariants({ className: 'min-h-11' })}
          disabled={!canCommand}
        >
          {word('editRoles')}
        </Link>
      )}
      {owner && <p className="text-sm text-muted-foreground">{word('lastOwner')}</p>}
    </>
  );
  const footer = (
    <>
      {!page && (
        <Button variant="outline" onClick={refreshMembers}>
          {word('refreshMembers')}
        </Button>
      )}
      <Button variant="outline" onClick={onClose}>
        {word('close')}
      </Button>
      {page !== 'edit' && (
        <Button
          variant="destructive"
          disabled={!canCommand || owner}
          onClick={pending ? onWithdraw : onRemove}
        >
          {word(pending ? 'withdraw' : 'remove')}
        </Button>
      )}
    </>
  );
  if (page)
    return (
      <section className="space-y-5 rounded-xl border bg-card p-4 md:p-6" aria-label={title}>
        <div className="flex items-center justify-between gap-3">
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold">
            {title}
          </h2>
          {editorRefresh}
        </div>
        {content}
        <div className="flex flex-wrap gap-2 border-t pt-4">{footer}</div>
      </section>
    );
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
        {content}
        <DialogFooter className="flex-wrap">{footer}</DialogFooter>
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
      {resource.loading && (
        <RecordListSkeleton label={word('activityLoading')} view="card" headings={[]} />
      )}
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
