import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest } from '../lib/documents.js';
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
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Item | null>(null);
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void documentRequest<Response>('/api/admin/document-retention/destruction', {
      signal: controller.signal,
    })
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
  }, [reload]);

  function approve(event: FormEvent) {
    event.preventDefault();
    if (!selected || note.trim().length < 3) {
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
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{word('destructionDescription')}</p>
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
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{word('error')}</AlertDescription>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              {word('refresh')}
            </Button>
          </Alert>
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
        ) : data ? (
          <p className="text-sm text-muted-foreground">{word('destructionEmpty')}</p>
        ) : null}
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
      </div>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSelected(null);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </details>
  );
}
