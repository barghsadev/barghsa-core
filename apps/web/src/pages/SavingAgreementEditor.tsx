import { useEffect, useState, type FormEvent } from 'react';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import { Button, Label, Input, Textarea } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';

interface Agreement {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'active' | 'superseded';
  effective_from: string | null;
}

export function SavingAgreementEditor({
  planId,
  onChanged,
}: {
  planId: string;
  onChanged: () => void;
}) {
  const locale = useLocale();
  const label = (key: string) => tCatalogue(key, locale);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const base = `/api/admin/catalogue/saving-plans/${encodeURIComponent(planId)}`;

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    void fetch(`${base}/configuration`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Load failed');
        return response.json() as Promise<{ agreements: Agreement[] }>;
      })
      .then(({ agreements: versions }) => {
        if (controller.signal.aborted) return;
        setAgreements(versions);
        const editable =
          versions.find((version) => version.status === 'draft') ??
          versions.find((version) => version.status === 'active');
        setTitle(editable?.title ?? '');
        setBody(editable?.body ?? '');
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [base, revision]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setAction({
      path: `${base}/agreements/draft`,
      method: 'POST',
      title: label('saveAgreement'),
      description: label('confirmAgreementDraft'),
      body: { title: title.trim(), body: body.trim() },
      forbiddenMessage: label('denied'),
      conflictMessage: label('conflict'),
    });
  }

  const draft = agreements.find((agreement) => agreement.status === 'draft');
  const active = agreements.find((agreement) => agreement.status === 'active');
  return (
    <section className="space-y-4 border-y py-5" aria-label={label('agreement')}>
      <h2 className="text-xl font-semibold">{label('agreement')}</h2>
      {state === 'loading' && <p role="status">{label('loading')}</p>}
      {state === 'error' && <p role="alert">{label('error')}</p>}
      {state === 'ready' && (
        <>
          <p className="text-sm text-muted-foreground">{label('agreementHelp')}</p>
          {active && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer font-medium">
                {label('activeAgreement')}: {active.title}
              </summary>
              <p className="mt-2 whitespace-pre-wrap">{active.body}</p>
            </details>
          )}
          <form className="space-y-3" onSubmit={save}>
            <div>
              <Label htmlFor="saving-agreement-title">{label('agreementTitle')}</Label>
              <Input
                id="saving-agreement-title"
                value={title}
                maxLength={300}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="saving-agreement-body">{label('agreementBody')}</Label>
              <Textarea
                id="saving-agreement-body"
                value={body}
                maxLength={50_000}
                required
                rows={8}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <Button type="submit">{label('saveAgreement')}</Button>
          </form>
          {draft && (
            <div className="rounded-md border p-3">
              <p className="font-medium">
                {label('draftAgreement')}: {draft.title}
              </p>
              <Button
                className="mt-3"
                onClick={() =>
                  setAction({
                    path: `${base}/agreements/${encodeURIComponent(draft.id)}/activate`,
                    method: 'POST',
                    title: label('activateAgreement'),
                    description: label('confirmAgreementActivation'),
                    forbiddenMessage: label('denied'),
                    conflictMessage: label('conflict'),
                  })
                }
              >
                {label('activateAgreement')}
              </Button>
            </div>
          )}
          {agreements.filter((agreement) => agreement.status === 'superseded').length > 0 && (
            <details>
              <summary className="cursor-pointer">{label('agreementHistory')}</summary>
              <ol className="space-y-2">
                {agreements
                  .filter((agreement) => agreement.status === 'superseded')
                  .map((agreement) => (
                    <li key={agreement.id} className="border-b py-2">
                      <p className="font-medium">{agreement.title}</p>
                      <p className="whitespace-pre-wrap">{agreement.body}</p>
                    </li>
                  ))}
              </ol>
            </details>
          )}
        </>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setRevision((value) => value + 1);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
