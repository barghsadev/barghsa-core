import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { type BusinessDocument } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

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
      key={JSON.stringify([actor, revision, props.document.id, props.document.profileId])}
      {...props}
    />
  );
}
function OwnedDocumentLegalHolds({ document }: { document: BusinessDocument }) {
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
  const [data, setData] = useState<HoldsResponse | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [scope, setScope] = useState<'document' | 'profile'>('document');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  const [invalidReason, setInvalidReason] = useState(false);
  const [invalidExpiry, setInvalidExpiry] = useState(false);
  const [invalidReleaseNote, setInvalidReleaseNote] = useState(false);
  const [action, setAction] = useState<HoldAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readDocument<HoldsResponse>(
      `/api/admin/document-retention/holds?documentId=${encodeURIComponent(document.id)}`,
      { signal: controller.signal }
    )
      .then((response) => {
        if (!controller.signal.aborted) {
          setData(response);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [document.id, reload, readDocument]);

  function create(event: FormEvent) {
    event.preventDefault();
    if (!data?.canManage || error || action) return;
    const expiry = expiresAt ? new Date(expiresAt) : null;
    const reasonInvalid = reason.trim().length < 3;
    const expiryInvalid = !!expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date());
    setInvalidReason(reasonInvalid);
    setInvalidExpiry(expiryInvalid);
    if (reasonInvalid || expiryInvalid) return;
    setAction({
      target: {
        profileId: scope === 'profile' ? document.profileId : null,
        documentId: scope === 'document' ? document.id : null,
        reason: reason.trim(),
        expiresAt: expiry?.toISOString() ?? null,
      },
      title: word('createHold'),
      description: scope === 'profile' ? word('holdProfile') : word('holdDocument'),
      path: '/api/admin/document-retention/holds',
      method: 'POST',
      body: {
        ...(scope === 'profile' ? { profileId: document.profileId } : { documentId: document.id }),
        reason: reason.trim(),
        ...(expiry ? { expiresAt: expiry.toISOString() } : {}),
      },
      forbiddenMessage: word('denied'),
    });
  }
  function release(hold: Hold) {
    if (!data?.canManage || error || action || !hold.active) return;
    if (releaseNote.trim().length < 3) {
      setInvalidReleaseNote(true);
      return;
    }
    setInvalidReleaseNote(false);
    setAction({
      target: { ...hold, holdId: hold.id },
      risk: 'destructive',
      title: word('releaseHold'),
      description: hold.reason,
      path: `/api/admin/document-retention/holds/${hold.id}/release`,
      method: 'POST',
      body: { note: releaseNote.trim() },
      forbiddenMessage: word('denied'),
      conflictMessage: word('conflict'),
    });
  }

  return (
    <section
      className="space-y-4 rounded-xl border bg-muted/20 p-4"
      aria-label={word('legalHolds')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('legalHolds')}</h3>
        {data ? <StatusBadge label={word(data.held ? 'held' : 'notHeld')} /> : null}
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : null}
      {data?.holds.length ? (
        <ul className="space-y-3">
          {data.holds.map((hold) => (
            <li key={hold.id} className="rounded-lg border bg-card p-3 text-sm">
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
              <p className="mt-2 whitespace-pre-wrap break-words">{hold.reason}</p>
              <p className="mt-1 text-muted-foreground">
                {time.format(hold.initiatedAt)}
                {hold.expiresAt ? ` · ${word('holdExpiry')}: ${time.format(hold.expiresAt)}` : ''}
              </p>
              {data.canManage && !error && hold.active ? (
                <Button variant="outline" className="mt-3" onClick={() => release(hold)}>
                  {word('releaseHold')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : data ? (
        <p className="text-sm text-muted-foreground">{word('noHolds')}</p>
      ) : null}
      {data?.canManage && !error ? (
        <div className="space-y-4 border-t pt-4">
          <form noValidate onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="hold-scope">{word('holdScope')}</FieldLabel>
              <NativeSelect
                id="hold-scope"
                aria-required="true"
                value={scope}
                onChange={(event) => setScope(event.target.value as 'document' | 'profile')}
              >
                <option value="document">{word('holdDocument')}</option>
                <option value="profile">{word('holdProfile')}</option>
              </NativeSelect>
            </Field>
            <Field data-invalid={invalidExpiry || undefined}>
              <FieldLabel htmlFor="hold-expiry">{word('holdExpiry')}</FieldLabel>
              <Input
                id="hold-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => {
                  setExpiresAt(event.target.value);
                  setInvalidExpiry(false);
                }}
                aria-invalid={invalidExpiry || undefined}
                aria-describedby={invalidExpiry ? 'hold-expiry-error' : undefined}
              />
              {invalidExpiry && (
                <p id="hold-expiry-error" role="alert" className="text-sm text-destructive">
                  {word('holdExpiryError')}
                </p>
              )}
            </Field>
            <Field className="sm:col-span-2" data-invalid={invalidReason || undefined}>
              <FieldLabel htmlFor="hold-reason">{word('holdReason')}</FieldLabel>
              <Textarea
                id="hold-reason"
                value={reason}
                maxLength={1000}
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
            <Button type="submit" className="justify-self-start">
              {word('createHold')}
            </Button>
          </form>
          {data.holds.some((hold) => hold.active) ? (
            <Field data-invalid={invalidReleaseNote || undefined}>
              <FieldLabel htmlFor="hold-release-note">{word('releaseNote')}</FieldLabel>
              <Textarea
                id="hold-release-note"
                value={releaseNote}
                maxLength={1000}
                onChange={(event) => {
                  setReleaseNote(event.target.value);
                  if (event.target.value.trim().length >= 3) setInvalidReleaseNote(false);
                }}
                aria-required="true"
                aria-invalid={invalidReleaseNote || undefined}
                aria-describedby={invalidReleaseNote ? 'hold-release-note-error' : undefined}
              />
              {invalidReleaseNote && (
                <p id="hold-release-note-error" role="alert" className="text-sm text-destructive">
                  {word('legalReasonLength')}
                </p>
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onUnconfirmed={() => {
            setAction(null);
            setData(null);
            setReload((value) => value + 1);
          }}
          onSuccess={async (result) => {
            if (!matchesHold(result, action)) throw new Error('Legal hold receipt mismatch');
            setReload((value) => value + 1);
            setReason('');
            setReleaseNote('');
            setInvalidReason(false);
            setInvalidReleaseNote(false);
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
