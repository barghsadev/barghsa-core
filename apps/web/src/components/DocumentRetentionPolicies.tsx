import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  Textarea,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

type Policy = {
  id: string;
  businessRecordType: string;
  retentionYears: number;
  legalHold: boolean;
  approvalNote: string;
  effectiveDate: string;
};
type PoliciesResponse = { canManage: boolean; policies: Policy[] };
const kinds = [
  'contract',
  'invoice',
  'payment',
  'refund',
  'signed_document',
  'order',
  'solar_request',
  'standalone',
] as const;

export function DocumentRetentionPolicies() {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<PoliciesResponse | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<string>('contract');
  const [years, setYears] = useState(10);
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void documentRequest<PoliciesResponse>('/api/admin/document-retention/policies', {
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setData(response);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const current = data?.policies.find((item) => item.businessRecordType === kind);
    if (!current) return;
    setYears(current.retentionYears);
    setHeld(current.legalHold);
    setNote('');
    setInvalid(false);
  }, [data, kind]);

  function select(next: string) {
    setKind(next);
    setSaved(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!Number.isInteger(years) || years < 1 || years > 100 || note.trim().length < 3) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setAction({
      title: word('savePolicy'),
      description: word('retentionChangeWarning'),
      path: `/api/admin/document-retention/policies/${kind}`,
      method: 'PUT',
      body: { retentionYears: years, legalHold: held, approvalNote: note.trim() },
      forbiddenMessage: word('denied'),
    });
  }
  const current = data?.policies.find((item) => item.businessRecordType === kind);
  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold">{word('retentionPolicies')}</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{word('retentionDescription')}</p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{word('error')}</AlertDescription>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              {word('refresh')}
            </Button>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="retention-kind">{word('kind')}</FieldLabel>
          <NativeSelect
            id="retention-kind"
            value={kind}
            onChange={(event) => select(event.target.value)}
          >
            {kinds.map((option) => (
              <option key={option} value={option}>
                {word(option)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {current ? (
          <p className="text-sm text-muted-foreground">
            {word('retentionYears')}: {current.retentionYears} · {word('policyEffective')}:{' '}
            {time.format(current.effectiveDate)}
          </p>
        ) : null}
        {data?.canManage ? (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="retention-years">{word('retentionYears')}</FieldLabel>
              <Input
                id="retention-years"
                type="number"
                min={1}
                max={100}
                value={years}
                onChange={(event) => setYears(Number(event.target.value))}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={held}
                onChange={(event) => setHeld(event.target.checked)}
              />
              {word('policyHold')}
            </label>
            <Field className="sm:col-span-2" data-invalid={invalid || undefined}>
              <FieldLabel htmlFor="retention-note">{word('approvalNote')}</FieldLabel>
              <Textarea
                id="retention-note"
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
              />
            </Field>
            {invalid ? (
              <p role="alert" className="sm:col-span-2">
                {word('reasonRequired')}
              </p>
            ) : null}
            <Button type="submit" className="justify-self-start">
              {word('savePolicy')}
            </Button>
          </form>
        ) : null}
        {saved ? <p role="status">{word('policyUpdated')}</p> : null}
      </div>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setSaved(true);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </details>
  );
}
