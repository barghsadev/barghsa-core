import { CommandFeedback } from './CommandFeedback.js';
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
  Textarea,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentRequestError } from '../lib/documents.js';
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
type PolicyChange = TeamAction & {
  kind: string;
  previousVersion: string | undefined;
  body: Pick<Policy, 'retentionYears' | 'legalHold' | 'approvalNote'>;
};
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

function validPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== 'object') return false;
  const policy = value as Policy;
  return (
    typeof policy.id === 'string' &&
    !!policy.id.trim() &&
    kinds.some((kind) => kind === policy.businessRecordType) &&
    Number.isInteger(policy.retentionYears) &&
    policy.retentionYears >= 1 &&
    policy.retentionYears <= 100 &&
    typeof policy.legalHold === 'boolean' &&
    typeof policy.approvalNote === 'string' &&
    typeof policy.effectiveDate === 'string' &&
    Number.isFinite(Date.parse(policy.effectiveDate))
  );
}

export function DocumentRetentionPolicies() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedDocumentRetentionPolicies key={JSON.stringify([actor, revision])} />;
}
function OwnedDocumentRetentionPolicies() {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    true,
    undefined,
    'DocumentRetentionPolicies'
  );
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<PoliciesResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState<string>('contract');
  const [years, setYears] = useState(10);
  const [held, setHeld] = useState(false);
  const [note, setNote] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [action, setAction] = useState<PolicyChange | null>(null);
  const current = data?.policies.find((item) => item.businessRecordType === kind);
  const version = current?.id;
  const savedYears = current?.retentionYears;
  const savedHold = current?.legalHold;
  const validYears = Number.isInteger(years) && years >= 1 && years <= 100;
  const validNote = note.trim().length >= 3;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void readDocument<PoliciesResponse>('/api/admin/document-retention/policies', {
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        if (
          typeof response.canManage !== 'boolean' ||
          !Array.isArray(response.policies) ||
          !response.policies.every(validPolicy)
        )
          throw new Error('Invalid retention policy list');
        setData(response);
        setError(false);
        setUnconfirmed(false);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          if (failure instanceof DocumentRequestError && [401, 403].includes(failure.status))
            setData(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload, readDocument]);
  useEffect(() => {
    setYears(savedYears ?? 10);
    setHeld(savedHold ?? false);
    setNote('');
    setAttempted(false);
  }, [kind, version, savedYears, savedHold]);

  function select(next: string) {
    setKind(next);
    setSaved(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!data?.canManage || loading || error || unconfirmed || action) return;
    if (!validYears || !validNote) {
      setAttempted(true);
      return;
    }
    setAttempted(false);
    setSaved(false);
    setAction({
      kind,
      previousVersion: current?.id,
      title: word('savePolicy'),
      description: word('retentionChangeWarning'),
      path: `/api/admin/document-retention/policies/${kind}`,
      method: 'PUT',
      body: { retentionYears: years, legalHold: held, approvalNote: note.trim() },
      forbiddenMessage: word('denied'),
    });
  }
  return (
    <details className="rounded-xl border bg-card p-5">
      <summary className="cursor-pointer font-semibold pointer-coarse:min-h-11 pointer-coarse:py-2">
        {word('retentionPolicies')}
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-muted-foreground">{word('retentionDescription')}</p>
        {loading && <p role="status">{word('loading')}</p>}
        {error || unconfirmed ? (
          <Alert variant="destructive">
            <AlertDescription>
              {unconfirmed ? confirmationText('unconfirmed', locale) : word('error')}
            </AlertDescription>
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => setReload((value) => value + 1)}
            >
              {unconfirmed ? confirmationText('checkStatus', locale) : word('refresh')}
            </Button>
          </Alert>
        ) : null}
        <Field>
          <FieldLabel htmlFor="retention-kind">{word('kind')}</FieldLabel>
          <NativeSelect
            id="retention-kind"
            aria-required="true"
            value={kind}
            disabled={unconfirmed || !!action}
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
          <form noValidate onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={(attempted && !validYears) || undefined}>
              <FieldLabel htmlFor="retention-years">{word('retentionYears')}</FieldLabel>
              <Input
                id="retention-years"
                type="number"
                min={1}
                max={100}
                required
                aria-required="true"
                aria-invalid={(attempted && !validYears) || undefined}
                aria-describedby={attempted && !validYears ? 'retention-years-error' : undefined}
                value={years}
                onChange={(event) => setYears(Number(event.target.value))}
              />
              {attempted && !validYears && (
                <p id="retention-years-error" role="alert" className="text-sm text-destructive">
                  {word('retentionYearsError')}
                </p>
              )}
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={held}
                onChange={(event) => setHeld(event.target.checked)}
              />
              {word('policyHold')}
            </label>
            <Field className="sm:col-span-2" data-invalid={(attempted && !validNote) || undefined}>
              <FieldLabel htmlFor="retention-note">{word('approvalNote')}</FieldLabel>
              <Textarea
                id="retention-note"
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                aria-required="true"
                aria-invalid={(attempted && !validNote) || undefined}
                aria-describedby={attempted && !validNote ? 'retention-note-error' : undefined}
              />
              {attempted && !validNote && (
                <p id="retention-note-error" role="alert" className="text-sm text-destructive">
                  {word('legalReasonLength')}
                </p>
              )}
            </Field>
            <Button
              type="submit"
              className="justify-self-start"
              disabled={loading || error || unconfirmed || !!action}
            >
              {word('savePolicy')}
            </Button>
          </form>
        ) : null}
        <CommandFeedback message={saved ? word('policyUpdated') : null} />
      </div>
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onDenied={() => {
            setAction(null);
            setData(null);
            setError(true);
          }}
          onUnconfirmed={() => {
            setAction(null);
            setUnconfirmed(true);
          }}
          onSuccess={async (receipt) => {
            if (
              !validPolicy(receipt) ||
              receipt.id === action.previousVersion ||
              receipt.businessRecordType !== action.kind ||
              receipt.retentionYears !== action.body.retentionYears ||
              receipt.legalHold !== action.body.legalHold ||
              receipt.approvalNote !== action.body.approvalNote
            )
              throw new Error('Retention policy receipt mismatch');
            setSaved(true);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
    </details>
  );
}
