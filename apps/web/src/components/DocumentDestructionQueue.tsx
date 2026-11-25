import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  ListPage,
  ListRefreshButton,
  PageLoading,
  StatusBadge,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentRequestError } from '../lib/documents.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';

type Item = {
  id: string;
  documentId: string;
  businessRecordType: string;
  retentionDeadline: string;
  status: 'pending_approval' | 'approved' | 'destroying' | 'cancelled' | 'destroyed';
  attempts: number;
  lastError: string | null;
};
type Response = {
  items: Item[];
  counts: Array<{ status: string; count: number }>;
  canManage: boolean;
};

type Location = { recordId?: string | undefined; search: Record<string, unknown> };

export function DocumentDestructionQueue({ location }: { location?: Location } = {}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedDocumentDestructionQueue
      key={JSON.stringify([actor, revision, location?.recordId])}
      location={location}
    />
  );
}
function OwnedDocumentDestructionQueue({ location }: { location?: Location | undefined }) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    true,
    undefined,
    'DocumentDestructionQueue'
  );
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const accessDenied = useRef(false);
  const [reload, setReload] = useState(0);
  const [inlineSelection, setSelected] = useState<Item | null>(null);
  const listed = location?.recordId
    ? data?.items.find((item) => item.id === location.recordId)
    : undefined;
  const selected = location
    ? data?.canManage && listed?.status === 'pending_approval'
      ? listed
      : null
    : inlineSelection;
  const items = location?.recordId ? (listed ? [listed] : []) : (data?.items ?? []);
  const [note, setNote] = useState('');
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const selectedId = selected?.id;
  const [invalid, setInvalid] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [action, setAction] = useState<
    (TeamAction & { target: { id: string; documentId: string }; body: { note: string } }) | null
  >(null);
  useEffect(() => {
    if (selectedId && !location) noteInput.current?.focus();
  }, [selectedId, location]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void readDocument<Response>('/api/admin/document-retention/destruction', {
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          if (!Array.isArray(response.items) || !Array.isArray(response.counts))
            throw new DocumentRequestError(502, null);
          accessDenied.current = false;
          setDenied(false);
          setData(response);
          setError(false);
          if (
            location?.recordId &&
            (!response.canManage ||
              !response.items.some(
                (item) => item.id === location.recordId && item.status === 'pending_approval'
              ))
          )
            setNote('');
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(true);
        if (reason instanceof DocumentRequestError && [401, 403].includes(reason.status)) {
          accessDenied.current = true;
          setDenied(true);
          setData(null);
          setSelected(null);
          setNote('');
          setAction(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, readDocument]);

  useEffect(() => {
    if (!inlineSelection) return;
    if (
      !data?.canManage ||
      !data.items.some(
        (item) =>
          item.id === inlineSelection.id &&
          item.status === 'pending_approval' &&
          item.documentId === inlineSelection.documentId
      )
    ) {
      setSelected(null);
      setNote('');
      setAction(null);
    }
  }, [data, inlineSelection]);

  function approve(event: FormEvent) {
    event.preventDefault();
    if (
      accessDenied.current ||
      loading ||
      error ||
      action ||
      recorded ||
      !data?.canManage ||
      !selected ||
      !data.items.some((item) => item.id === selected.id && item.status === 'pending_approval')
    )
      return;
    if (note.trim().length < 3) {
      setInvalid(true);
      noteInput.current?.focus();
      return;
    }
    setInvalid(false);
    setAction({
      target: { id: selected.id, documentId: selected.documentId },
      risk: 'destructive',
      title: word('destructionApprove'),
      description: word('destructionWarning'),
      path: `/api/admin/document-retention/destruction/${selected.id}/approve`,
      method: 'POST',
      body: { note: note.trim() },
      forbiddenMessage: word('denied'),
      conflictMessage: word('conflict'),
    });
  }

  const statusText = (status: string) =>
    word(
      (
        {
          pending_approval: 'destructionPending',
          approved: 'destructionApproved',
          destroying: 'destructionDestroying',
          cancelled: 'destructionCancelled',
          destroyed: 'destructionDestroyed',
        } as Record<string, string>
      )[status] ?? status
    );

  const Wrapper = location ? 'section' : 'details';
  return (
    <Wrapper className="group rounded-xl border bg-card">
      {location && <RecordCommandGuard blocked={() => !!action} />}
      {!location && (
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 font-semibold hover:bg-muted/35 [&::-webkit-details-marker]:hidden">
          {word('destructionQueue')}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
      )}
      <ListPage
        className={`p-4 ${location ? '' : 'border-t'}`}
        role="region"
        aria-label={word('destructionQueue')}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="max-w-prose pt-2 text-sm text-muted-foreground">
            {word('destructionDescription')}
          </p>
          <ListRefreshButton
            label={word('refresh')}
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
          />
        </div>
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!items.length}
          retainContent={!!items.length && !denied}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            <Alert variant="destructive">
              <AlertDescription>
                {word(denied ? 'denied' : 'destructionLoadError')}
              </AlertDescription>
              {!denied && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setReload((value) => value + 1)}
                >
                  {word('retry')}
                </Button>
              )}
            </Alert>
          }
          emptyView={
            <p className="text-sm text-muted-foreground">
              {word(location?.recordId ? 'destructionUnavailable' : 'destructionEmpty')}
            </p>
          }
        >
          {!location?.recordId && data?.counts.length ? (
            <div className="flex flex-wrap gap-2" aria-label={word('destructionQueue')}>
              {data.counts.map((count) => (
                <StatusBadge
                  key={count.status}
                  label={`${statusText(count.status)}: ${count.count}`}
                />
              ))}
            </div>
          ) : null}
          {items.length ? (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="space-y-2 py-3 text-sm first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{word(item.businessRecordType)}</strong>
                    <StatusBadge label={statusText(item.status)} />
                  </div>
                  <p className="text-muted-foreground [overflow-wrap:anywhere]">
                    <bdi>{item.documentId}</bdi>
                  </p>
                  <p className="text-muted-foreground">
                    {word('destructionDeadline')}: {time.format(item.retentionDeadline)}
                  </p>
                  {location?.recordId && staffOrderId(item.documentId) && (
                    <Link
                      to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
                      params={{
                        documentId: item.documentId,
                        section: undefined,
                        action: undefined,
                        holdId: undefined,
                      }}
                      search={{ ...location.search, profileId: undefined }}
                      className="inline-flex min-h-10 items-center font-medium text-primary underline underline-offset-4"
                    >
                      {word('reviewDestructionDocument')}
                    </Link>
                  )}
                  {item.lastError ? <p role="status">{word('destructionFailed')}</p> : null}
                  {data?.canManage && item.status === 'pending_approval' && !location?.recordId ? (
                    location ? (
                      <Link
                        to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
                        params={{
                          documentId: 'governance',
                          section: 'destruction',
                          action: item.id,
                        }}
                        search={location.search}
                        className={buttonVariants({ variant: 'outline' })}
                      >
                        {word('destructionApprove')}
                      </Link>
                    ) : (
                      <Button
                        variant="outline"
                        aria-expanded={selectedId === item.id}
                        onClick={() => {
                          if (selectedId === item.id) {
                            noteInput.current?.focus();
                            return;
                          }
                          setSelected(item);
                          setNote('');
                          setInvalid(false);
                        }}
                      >
                        {word('destructionApprove')}
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </ListPage.Content>
        {recorded && location && (
          <p role="status" className="rounded-lg bg-success-soft p-3 text-sm text-success">
            {word('destructionApprovalRecorded')}
          </p>
        )}
        {selected && data?.canManage && !recorded ? (
          <form noValidate onSubmit={approve} className={recordEditorSurface}>
            <div className="space-y-2 border-b bg-muted/25 px-4 py-3 sm:px-6">
              <h2 className="text-base font-semibold">
                {word(location ? 'destructionReviewDetails' : 'destructionApprove')}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">
                {word('destructionWarning')}
              </p>
              {!location && (
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  <bdi>{selected.documentId}</bdi>
                </p>
              )}
            </div>
            <div className="px-4 py-3 sm:px-6">
              <Field className="max-w-prose gap-1.5" data-invalid={invalid || undefined}>
                <FieldLabel htmlFor="destruction-note">
                  {word('destructionApprovalNote')}
                </FieldLabel>
                <Textarea
                  id="destruction-note"
                  ref={noteInput}
                  value={note}
                  maxLength={1000}
                  rows={2}
                  dir="auto"
                  className={`min-h-14 resize-y ${locale === 'fa' ? 'placeholder:text-right' : 'placeholder:text-left'}`}
                  placeholder={word('destructionExample')}
                  onChange={(event) => {
                    setNote(event.target.value);
                    if (event.target.value.trim().length >= 3) setInvalid(false);
                  }}
                  required
                  aria-required="true"
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? 'destruction-note-error' : undefined}
                />
                {invalid && (
                  <p id="destruction-note-error" role="alert" className="text-sm text-destructive">
                    {word('legalReasonLength')}
                  </p>
                )}
              </Field>
            </div>
            <RecordEditorActions>
              {!location && (
                <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                  {word('cancel')}
                </Button>
              )}
              <Button
                type="submit"
                variant={location ? 'destructive' : 'default'}
                disabled={loading || error || !!action}
              >
                {word(location ? 'destructionReview' : 'destructionApprove')}
              </Button>
            </RecordEditorActions>
          </form>
        ) : null}
      </ListPage>
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            location && (
              <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{word('record')}</dt>
                  <dd>
                    <bdi className="wrap-anywhere">{action.target.documentId}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('destructionApprovalNote')}</dt>
                  <dd dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                    {action.body.note}
                  </dd>
                </div>
              </dl>
            )
          }
          onClose={() => setAction(null)}
          onDenied={() => {
            accessDenied.current = true;
            setDenied(true);
            setError(true);
            setData(null);
            setSelected(null);
            setNote('');
            setAction(null);
          }}
          onUnconfirmed={() => {
            if (accessDenied.current) return;
            setAction(null);
            setSelected(null);
            setNote('');
            setData(null);
            setReload((value) => value + 1);
          }}
          onSuccess={async (value) => {
            if (accessDenied.current) return;
            const receipt = value as { id?: string; document_id?: string; status?: string } | null;
            if (
              !receipt ||
              receipt.id !== action.target.id ||
              receipt.document_id !== action.target.documentId ||
              receipt.status !== 'approved'
            )
              throw new Error('Destruction approval receipt mismatch');
            setSelected(null);
            if (location) setRecorded(true);
            setReload((value) => value + 1);
            return location ? undefined : confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </Wrapper>
  );
}
