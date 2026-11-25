import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  LoadingStatus,
  NativeSelect,
  StatusBadge,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { type BusinessDocument } from '../lib/documents.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import type { HoldExpiryFields } from './LegalHoldExpiryDatePicker.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorSurface,
} from './RecordEditorLayout.js';

export type DocumentHoldPage = 'history' | 'new' | { releaseId: string };
type HoldLocation = { page: 'summary' | DocumentHoldPage; search: Record<string, unknown> };
const holdsRoute = '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}';
const ExpiryDatePicker = lazy(() => import('./LegalHoldExpiryDatePicker.js'));

type Hold = {
  id: string;
  documentId: string | null;
  profileId: string | null;
  reason: string;
  initiatedAt: string;
  expiresAt: string | null;
  releasedAt: string | null;
  active: boolean;
};
type HoldsResponse = { held: boolean; canManage: boolean; holds: Hold[] };
type HoldAction = TeamAction & {
  target: Pick<Hold, 'documentId' | 'profileId' | 'reason' | 'expiresAt'> & { holdId?: string };
  note?: string;
};

function matchesHold(value: unknown, { target }: HoldAction) {
  if (!value || typeof value !== 'object') return false;
  const hold = value as Partial<Hold>;
  if (
    typeof hold.id !== 'string' ||
    !hold.id ||
    hold.documentId !== target.documentId ||
    hold.profileId !== target.profileId ||
    hold.reason !== target.reason ||
    hold.expiresAt !== target.expiresAt
  )
    return false;
  return target.holdId
    ? hold.id === target.holdId &&
        hold.active === false &&
        typeof hold.releasedAt === 'string' &&
        Number.isFinite(Date.parse(hold.releasedAt))
    : hold.releasedAt === null;
}

export function DocumentLegalHolds(props: Parameters<typeof OwnedDocumentLegalHolds>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedDocumentLegalHolds
      key={JSON.stringify([
        actor,
        revision,
        props.document.id,
        props.document.profileId,
        props.location?.page,
      ])}
      {...props}
    />
  );
}
function OwnedDocumentLegalHolds({
  document,
  heading: Heading = 'h3',
  location,
}: {
  document: BusinessDocument;
  heading?: 'h2' | 'h3';
  location?: HoldLocation | undefined;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    true,
    document.profileId,
    JSON.stringify([document.id, document.profileId])
  );
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const timezone = time.status === 'ready' ? time.timezone : null;
  const [data, setData] = useState<HoldsResponse | null>(null);
  const [error, setError] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [reload, setReload] = useState(0);
  const [scope, setScope] = useState<'document' | 'profile'>('document');
  const [reason, setReason] = useState('');
  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [releaseDraft, setReleaseDraft] = useState<{
    holdId: string;
    note: string;
    invalid: boolean;
  } | null>(
    typeof location?.page === 'object'
      ? { holdId: location.page.releaseId, note: '', invalid: false }
      : null
  );
  const [invalidReason, setInvalidReason] = useState(false);
  const [invalidExpiry, setInvalidExpiry] = useState(false);
  const [action, setAction] = useState<HoldAction | null>(null);
  const holdReason = useRef<HTMLTextAreaElement>(null);
  const holdExpiry = useRef<HoldExpiryFields>(null);
  const releaseNote = useRef<HTMLTextAreaElement>(null);
  const releaseId = releaseDraft?.holdId;

  useEffect(() => {
    if (releaseId && !location) releaseNote.current?.focus();
  }, [releaseId, location]);

  useEffect(() => {
    const controller = new AbortController();
    void readDocument<HoldsResponse>(
      `/api/admin/document-retention/holds?documentId=${encodeURIComponent(document.id)}`,
      { signal: controller.signal }
    )
      .then((response) => {
        if (!controller.signal.aborted) {
          if (
            !Array.isArray(response?.holds) ||
            typeof response.canManage !== 'boolean' ||
            typeof response.held !== 'boolean'
          )
            throw new Error('Invalid legal hold list');
          setData({
            ...response,
            holds: response.holds.filter(
              (hold) =>
                hold &&
                typeof hold.id === 'string' &&
                !!staffOrderId(hold.id) &&
                ((hold.documentId === document.id && hold.profileId === null) ||
                  (hold.profileId === document.profileId && hold.documentId === null))
            ),
          });
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(true);
        }
      });
    return () => controller.abort();
  }, [document.id, document.profileId, reload, readDocument]);

  function create(event: FormEvent) {
    event.preventDefault();
    if (!data?.canManage || error || action || needsCheck || recorded) return;
    const expiry = expiryEnabled ? (holdExpiry.current?.read() ?? null) : null;
    const cleanedReason = reason.trim();
    const reasonInvalid = cleanedReason.length < 3 || cleanedReason.length > 1000;
    const expiryInvalid = expiryEnabled && (!expiry || Date.parse(expiry) <= Date.now());
    setInvalidReason(reasonInvalid);
    setInvalidExpiry(expiryInvalid);
    if (reasonInvalid || expiryInvalid) {
      if (expiryInvalid) holdExpiry.current?.focus();
      else holdReason.current?.focus();
      return;
    }
    setAction({
      target: {
        profileId: scope === 'profile' ? document.profileId : null,
        documentId: scope === 'document' ? document.id : null,
        reason: cleanedReason,
        expiresAt: expiry,
      },
      title: word('createHold'),
      description: word('holdEffect'),
      path: '/api/admin/document-retention/holds',
      method: 'POST',
      successStatus: 201,
      body: {
        ...(scope === 'profile' ? { profileId: document.profileId } : { documentId: document.id }),
        reason: cleanedReason,
        ...(expiry ? { expiresAt: expiry } : {}),
      },
      forbiddenMessage: word('denied'),
    });
  }
  function release(event: FormEvent, hold: Hold) {
    event.preventDefault();
    if (
      !data?.canManage ||
      error ||
      action ||
      needsCheck ||
      recorded ||
      !hold.active ||
      releaseDraft?.holdId !== hold.id
    )
      return;
    const note = releaseDraft.note.trim();
    if (note.length < 3 || note.length > 1000) {
      setReleaseDraft({ ...releaseDraft, invalid: true });
      releaseNote.current?.focus();
      return;
    }
    setAction({
      target: { ...hold, holdId: hold.id },
      risk: 'destructive',
      title: word('releaseHold'),
      description: word('releaseEffect'),
      path: `/api/admin/document-retention/holds/${hold.id}/release`,
      method: 'POST',
      successStatus: 200,
      body: { note },
      note,
      forbiddenMessage: word('denied'),
      conflictMessage: word('conflict'),
    });
  }

  const page = location?.page;
  const editor = page === 'new' || typeof page === 'object';
  const canManage = data?.canManage && !error && !needsCheck && !recorded;
  const visibleHolds =
    typeof page === 'object'
      ? data?.holds.filter((hold) => hold.id === page.releaseId)
      : data?.holds;
  const holdLink = (action?: 'new' | 'release', holdId?: string) => ({
    documentId: document.id,
    section: 'holds',
    action,
    holdId,
  });
  const releaseForm = (hold: Hold) =>
    releaseDraft?.holdId === hold.id && (
      <form noValidate onSubmit={(event) => release(event, hold)} className={recordEditorSurface}>
        <RecordEditorSection title={word('releaseSettings')} description={word('releaseEffect')}>
          <Field className="max-w-prose gap-1.5" data-invalid={releaseDraft.invalid || undefined}>
            <FieldLabel htmlFor="hold-release-note">{word('releaseNote')}</FieldLabel>
            <Textarea
              id="hold-release-note"
              ref={releaseNote}
              value={releaseDraft.note}
              maxLength={1000}
              rows={2}
              dir="auto"
              className={`min-h-14 resize-y ${locale === 'fa' ? 'placeholder:text-right' : 'placeholder:text-left'}`}
              placeholder={word('releaseExample')}
              onChange={(event) => {
                const note = event.target.value;
                setReleaseDraft({
                  ...releaseDraft,
                  note,
                  invalid: releaseDraft.invalid && note.trim().length < 3,
                });
              }}
              required
              aria-required="true"
              aria-invalid={releaseDraft.invalid || undefined}
              aria-describedby={releaseDraft.invalid ? 'hold-release-note-error' : undefined}
            />
            {releaseDraft.invalid && (
              <p id="hold-release-note-error" role="alert" className="text-sm text-destructive">
                {word('legalReasonLength')}
              </p>
            )}
          </Field>
        </RecordEditorSection>
        <RecordEditorActions>
          {!page && (
            <Button type="button" variant="ghost" onClick={() => setReleaseDraft(null)}>
              {word('cancel')}
            </Button>
          )}
          <Button type="submit" variant="destructive" className="min-h-11">
            {word(page ? 'reviewRelease' : 'releaseHold')}
          </Button>
        </RecordEditorActions>
      </form>
    );
  const createForm = (
    <form noValidate onSubmit={create} className={recordEditorSurface}>
      <RecordEditorSection title={word('holdSettings')} description={word('holdEffect')}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Field className="min-w-0 gap-1.5">
            <FieldLabel htmlFor="hold-scope">{word('holdScope')}</FieldLabel>
            <NativeSelect
              id="hold-scope"
              className="w-full"
              aria-required="true"
              aria-describedby="hold-scope-help"
              value={scope}
              onChange={(event) => setScope(event.target.value as 'document' | 'profile')}
            >
              <option value="document">{word('holdDocument')}</option>
              <option value="profile">{word('holdProfile')}</option>
            </NativeSelect>
            <p id="hold-scope-help" className="text-xs text-muted-foreground">
              {word(scope === 'profile' ? 'holdProfileHelp' : 'holdDocumentHelp')}
            </p>
          </Field>
          <Field className="min-w-0 gap-1.5" data-invalid={invalidExpiry || undefined}>
            <label className="flex min-h-11 w-fit items-center gap-2 text-sm font-medium">
              <input
                id="hold-expiry-enabled"
                type="checkbox"
                className="size-4 accent-primary"
                checked={expiryEnabled}
                aria-describedby="hold-expiry-help"
                onChange={(event) => {
                  setExpiryEnabled(event.target.checked);
                  setInvalidExpiry(false);
                }}
              />
              {word('setHoldExpiry')}
            </label>
            {expiryEnabled && (
              <Suspense fallback={<LoadingStatus>{word('holdExpiryLoading')}</LoadingStatus>}>
                <ExpiryDatePicker
                  locale={locale}
                  timezone={timezone}
                  invalid={invalidExpiry}
                  editorRef={holdExpiry}
                  onEdit={() => setInvalidExpiry(false)}
                />
              </Suspense>
            )}
            {invalidExpiry ? (
              <p id="hold-expiry-error" role="alert" className="text-sm text-destructive">
                {word('holdExpiryError')}
              </p>
            ) : null}
            <p id="hold-expiry-help" className="text-xs text-muted-foreground">
              {!expiryEnabled ? (
                word('holdUntilReleased')
              ) : timezone ? (
                <>
                  {word('holdExpiryZone')} <bdi dir="ltr">{timezone}</bdi>
                </>
              ) : (
                word('holdExpiryUnavailable')
              )}
            </p>
          </Field>
          <Field
            className="max-w-prose gap-1.5 sm:col-span-2"
            data-invalid={invalidReason || undefined}
          >
            <FieldLabel htmlFor="hold-reason">{word('holdReason')}</FieldLabel>
            <Textarea
              id="hold-reason"
              ref={holdReason}
              value={reason}
              maxLength={1000}
              rows={2}
              dir="auto"
              className={`min-h-14 resize-y ${locale === 'fa' ? 'placeholder:text-right' : 'placeholder:text-left'}`}
              placeholder={word('holdExample')}
              onChange={(event) => {
                setReason(event.target.value);
                if (event.target.value.trim().length >= 3) setInvalidReason(false);
              }}
              required
              aria-required="true"
              aria-invalid={invalidReason || undefined}
              aria-describedby={invalidReason ? 'hold-reason-error' : undefined}
            />
            {invalidReason && (
              <p id="hold-reason-error" role="alert" className="text-sm text-destructive">
                {word('legalReasonLength')}
              </p>
            )}
          </Field>
        </div>
      </RecordEditorSection>
      <RecordEditorActions>
        <Button type="submit" className="min-h-11">
          {word(page ? 'reviewHold' : 'createHold')}
        </Button>
      </RecordEditorActions>
    </form>
  );

  return (
    <section
      className={
        editor ? 'min-w-0 space-y-3' : 'min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4'
      }
      aria-label={word('legalHolds')}
    >
      {editor && <RecordCommandGuard blocked={() => !!action} />}
      {!editor && (
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {page !== 'history' && (
              <Heading className="font-semibold">{word('legalHolds')}</Heading>
            )}
            {data && <StatusBadge label={word(data.held ? 'held' : 'notHeld')} />}
          </div>
          {location && data && (page === 'summary' || canManage) && (
            <div className="flex flex-wrap gap-2">
              {page === 'summary' && (
                <Link
                  to={holdsRoute}
                  params={holdLink()}
                  search={location.search}
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                >
                  {word('openHolds')}
                </Link>
              )}
              {canManage && (
                <Link
                  to={holdsRoute}
                  params={holdLink('new')}
                  search={location.search}
                  className={buttonVariants({ className: 'min-h-11' })}
                >
                  {word('newHold')}
                </Link>
              )}
            </div>
          )}
        </header>
      )}
      {editor && time.notice}
      {needsCheck ? (
        <Alert variant="destructive">
          <AlertDescription>{word('checkHoldHistory')}</AlertDescription>
        </Alert>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : !data && !recorded ? (
        <LoadingStatus>{word('loading')}</LoadingStatus>
      ) : null}
      {recorded && (
        <p
          role="status"
          className="rounded-lg border bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          {word(page === 'new' ? 'holdRecorded' : 'releaseRecorded')}
        </p>
      )}
      {editor &&
        data &&
        !recorded &&
        !needsCheck &&
        (!canManage ||
          (typeof page === 'object' && !visibleHolds?.some((hold) => hold.active))) && (
          <Alert>
            <AlertDescription>{word(canManage ? 'holdUnavailable' : 'denied')}</AlertDescription>
          </Alert>
        )}
      {page !== 'summary' && page !== 'new' && visibleHolds?.length ? (
        <ul className="space-y-3">
          {visibleHolds.map((hold) => (
            <li key={hold.id} className="space-y-2.5">
              <article className="min-w-0 space-y-2 rounded-lg border bg-card p-3 text-sm sm:px-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {word(hold.profileId ? 'holdProfile' : 'holdDocument')}
                  </span>
                  <StatusBadge
                    label={word(
                      hold.active ? 'holdActive' : hold.releasedAt ? 'holdReleased' : 'holdExpired'
                    )}
                  />
                </div>
                <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                  {hold.reason}
                </p>
                <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <div>
                    <dt className="text-muted-foreground">{word('holdStarted')}</dt>
                    <dd>{time.format(hold.initiatedAt)}</dd>
                  </div>
                  {hold.expiresAt && (
                    <div>
                      <dt className="text-muted-foreground">{word('holdExpires')}</dt>
                      <dd>{time.format(hold.expiresAt)}</dd>
                    </div>
                  )}
                  {hold.releasedAt && (
                    <div>
                      <dt className="text-muted-foreground">{word('holdEnded')}</dt>
                      <dd>{time.format(hold.releasedAt)}</dd>
                    </div>
                  )}
                </dl>
                {canManage &&
                  hold.active &&
                  (location && page === 'history' ? (
                    <Link
                      to={holdsRoute}
                      params={holdLink('release', hold.id)}
                      search={location.search}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'min-h-10',
                      })}
                    >
                      {word('releaseHold')}
                    </Link>
                  ) : (
                    !page &&
                    releaseId !== hold.id && (
                      <Button
                        variant="ghost"
                        className="text-primary"
                        onClick={() =>
                          setReleaseDraft({ holdId: hold.id, note: '', invalid: false })
                        }
                      >
                        {word('releaseHold')}
                      </Button>
                    )
                  ))}
              </article>
              {canManage && hold.active && releaseForm(hold)}
            </li>
          ))}
        </ul>
      ) : (page === 'history' || !page) && data ? (
        <p className="text-sm text-muted-foreground">{word('noHolds')}</p>
      ) : null}
      {canManage &&
        (page === 'new'
          ? createForm
          : !page && (
              <details className="group rounded-lg border bg-card">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium text-primary hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                  {word('newHold')}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                {createForm}
              </details>
            ))}
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{word('holdScope')}</dt>
                <dd>{word(action.target.profileId ? 'holdProfile' : 'holdDocument')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{word('holdReason')}</dt>
                <dd dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                  {action.target.reason}
                </dd>
              </div>
              {action.target.expiresAt && (
                <div>
                  <dt className="text-muted-foreground">{word('holdExpires')}</dt>
                  <dd>{time.format(action.target.expiresAt)}</dd>
                </div>
              )}
              {action.note && (
                <div>
                  <dt className="text-muted-foreground">{word('releaseNote')}</dt>
                  <dd dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                    {action.note}
                  </dd>
                </div>
              )}
            </dl>
          }
          onClose={() => setAction(null)}
          onDenied={() => {
            setAction(null);
            setData(null);
            setError(true);
          }}
          onUnconfirmed={() => {
            setAction(null);
            setData(null);
            if (editor) setNeedsCheck(true);
            else setReload((value) => value + 1);
          }}
          onSuccess={async (result) => {
            if (!matchesHold(result, action)) throw new Error('Legal hold receipt mismatch');
            setReload((value) => value + 1);
            if (editor) setRecorded(true);
            if (action.target.holdId) setReleaseDraft(null);
            else {
              setReason('');
              setInvalidReason(false);
            }
            return editor ? undefined : confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
