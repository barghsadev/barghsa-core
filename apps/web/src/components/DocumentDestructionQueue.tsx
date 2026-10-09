import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  ListPage,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentRequestError } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

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

export function DocumentDestructionQueue() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedDocumentDestructionQueue key={JSON.stringify([actor, revision])} />;
}
function OwnedDocumentDestructionQueue() {
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
  const [selected, setSelected] = useState<Item | null>(null);
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);

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
    if (!selected) return;
    if (
      !data?.canManage ||
      !data.items.some(
        (item) =>
          item.id === selected.id &&
          item.status === 'pending_approval' &&
          item.documentId === selected.documentId
      )
    ) {
      setSelected(null);
      setNote('');
      setAction(null);
    }
  }, [data, selected]);

  function approve(event: FormEvent) {
    event.preventDefault();
    if (
      accessDenied.current ||
      !data?.canManage ||
      !selected ||
      !data.items.some((item) => item.id === selected.id && item.status === 'pending_approval')
    )
      return;
    if (note.trim().length < 3) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
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

  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">{word('destructionQueue')}</summary>
      <ListPage className="mt-4" role="region" aria-label={word('destructionQueue')}>
        <ListPage.Toolbar>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
          >
            {word('refresh')}
          </Button>
        </ListPage.Toolbar>
        <p className="text-sm text-muted-foreground">{word('destructionDescription')}</p>
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!data?.items.length}
          retainContent={!!data?.items.length && !denied}
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
          emptyView={<p className="text-sm text-muted-foreground">{word('destructionEmpty')}</p>}
        >
          {data?.counts.length ? (
            <div className="flex flex-wrap gap-2" aria-label={word('destructionQueue')}>
              {data.counts.map((count) => (
                <StatusBadge
                  key={count.status}
                  label={`${statusText(count.status)}: ${count.count}`}
                />
              ))}
            </div>
          ) : null}
          {data?.items.length ? (
            <ul className="divide-y">
              {data.items.map((item) => (
                <li key={item.id} className="space-y-2 py-3 text-sm first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{word(item.businessRecordType)}</strong>
                    <StatusBadge label={statusText(item.status)} />
                  </div>
                  <p className="break-all text-muted-foreground">{item.documentId}</p>
                  <p className="text-muted-foreground">
                    {word('destructionDeadline')}: {time.format(item.retentionDeadline)}
                  </p>
                  {item.lastError ? <p role="status">{word('destructionFailed')}</p> : null}
                  {data.canManage && item.status === 'pending_approval' ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(item);
                        setNote('');
                      }}
                    >
                      {word('destructionApprove')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </ListPage.Content>
        {selected && data?.canManage ? (
          <form onSubmit={approve} className="space-y-3 border-t pt-4">
            <p className="text-sm">{word('destructionWarning')}</p>
            <p className="break-all text-sm text-muted-foreground">{selected.documentId}</p>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="destruction-note">{word('destructionApprovalNote')}</FieldLabel>
              <Textarea
                id="destruction-note"
                value={note}
                maxLength={1000}
                onChange={(event) => setNote(event.target.value)}
                required
              />
            </Field>
            {invalid ? <p role="alert">{word('reasonRequired')}</p> : null}
            <div className="flex gap-2">
              <Button type="submit">{word('destructionApprove')}</Button>
              <Button type="button" variant="outline" onClick={() => setSelected(null)}>
                {word('cancel')}
              </Button>
            </div>
          </form>
        ) : null}
      </ListPage>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            if (accessDenied.current) return;
            setSelected(null);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </details>
  );
}
