import { useEffect, useState } from 'react';
import { Button, Textarea } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

interface Comment {
  id: string;
  authorName: string;
  authorRole: 'staff' | 'customer';
  body: string;
  createdAt: string;
}
interface Page {
  comments: Comment[];
  nextBefore: string | null;
}
export function SavingOrderComments({
  orderId,
  staff = false,
}: {
  orderId: string;
  staff?: boolean;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSaving(key, locale);
  const base = staff
    ? `/api/staff/saving/orders/${encodeURIComponent(orderId)}/comments`
    : `/api/saving/orders/${encodeURIComponent(orderId)}/comments`;
  const [comments, setComments] = useState<Comment[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetch(cursor ? `${base}?before=${encodeURIComponent(cursor)}` : base, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('comments');
        return response.json() as Promise<Page>;
      })
      .then((page) => {
        if (controller.signal.aborted) return;
        setComments((old) => (cursor ? [...page.comments, ...old] : page.comments));
        setBefore(page.nextBefore);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, cursor, revision]);

  function send() {
    if (!note.trim()) return;
    setAction({
      title: copy('sendComment'),
      description: copy('confirmComment'),
      path: base,
      method: 'POST',
      body: { idempotencyKey: crypto.randomUUID(), body: note.trim() },
      conflictMessage: copy('staffConflict'),
      forbiddenMessage: copy('staffForbidden'),
    });
  }

  return (
    <section className="space-y-4" aria-label={copy('comments')}>
      <h2 className="text-xl font-semibold">{copy('comments')}</h2>
      {error && <p role="alert">{copy('commentError')}</p>}
      {loading && <p role="status">{copy('staffLoading')}</p>}
      {before && (
        <Button variant="outline" disabled={loading} onClick={() => setCursor(before)}>
          {copy('olderComments')}
        </Button>
      )}
      {!loading && !comments.length && (
        <p className="text-sm text-muted-foreground">{copy('noComments')}</p>
      )}
      <ol className="space-y-3">
        {comments.map((comment) => (
          <li key={comment.id} className="rounded-md border p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <strong>
                {comment.authorName} · {copy(comment.authorRole)}
              </strong>
              <time dateTime={comment.createdAt} className="text-muted-foreground">
                {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(new Date(comment.createdAt))}
              </time>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
          </li>
        ))}
      </ol>
      <div className="space-y-2">
        <label htmlFor={`saving-comment-${staff ? 'staff' : 'customer'}`} className="font-medium">
          {copy('writeComment')}
        </label>
        <Textarea
          id={`saving-comment-${staff ? 'staff' : 'customer'}`}
          value={note}
          maxLength={10000}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button disabled={!note.trim()} onClick={send}>
          {copy('sendComment')}
        </Button>
      </div>
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setNote('');
            setCursor(null);
            setRevision((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
