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
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest, type BusinessDocument } from '../lib/documents.js';
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

export function DocumentLegalHolds({ document }: { document: BusinessDocument }) {
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
  const [invalid, setInvalid] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void documentRequest<HoldsResponse>(
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
  }, [document.id, reload]);

  function create(event: FormEvent) {
    event.preventDefault();
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (
      reason.trim().length < 3 ||
      (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date()))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
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
    if (releaseNote.trim().length < 3) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
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
              {data.canManage && hold.active ? (
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
      {data?.canManage ? (
        <div className="space-y-4 border-t pt-4">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="hold-scope">{word('holdScope')}</FieldLabel>
              <NativeSelect
                id="hold-scope"
                value={scope}
                onChange={(event) => setScope(event.target.value as 'document' | 'profile')}
              >
                <option value="document">{word('holdDocument')}</option>
                <option value="profile">{word('holdProfile')}</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="hold-expiry">{word('holdExpiry')}</FieldLabel>
              <Input
                id="hold-expiry"
                type="datetime-local"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
              />
            </Field>
            <Field className="sm:col-span-2" data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="hold-reason">{word('holdReason')}</FieldLabel>
              <Textarea
                id="hold-reason"
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" className="justify-self-start">
              {word('createHold')}
            </Button>
          </form>
          {data.holds.some((hold) => hold.active) ? (
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="hold-release-note">{word('releaseNote')}</FieldLabel>
              <Textarea
                id="hold-release-note"
                value={releaseNote}
                maxLength={1000}
                onChange={(event) => setReleaseNote(event.target.value)}
              />
            </Field>
          ) : null}
          {invalid ? (
            <p role="alert" className="text-sm">
              {word('reasonRequired')}
            </p>
          ) : null}
        </div>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setReload((value) => value + 1);
            setReason('');
            setReleaseNote('');
          }}
        />
      ) : null}
    </section>
  );
}
