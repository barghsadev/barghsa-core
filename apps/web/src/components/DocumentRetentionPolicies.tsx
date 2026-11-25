import { CommandFeedback } from './CommandFeedback.js';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
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
  Input,
  NativeSelect,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentRequestError } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorSurface,
} from './RecordEditorLayout.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

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
export const retentionKinds = [
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
    retentionKinds.some((kind) => kind === policy.businessRecordType) &&
    Number.isInteger(policy.retentionYears) &&
    policy.retentionYears >= 1 &&
    policy.retentionYears <= 100 &&
    typeof policy.legalHold === 'boolean' &&
    typeof policy.approvalNote === 'string' &&
    typeof policy.effectiveDate === 'string' &&
    Number.isFinite(Date.parse(policy.effectiveDate))
  );
}

type Location = { recordId?: string | undefined; search: Record<string, unknown> };

export function DocumentRetentionPolicies({ location }: { location?: Location } = {}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedDocumentRetentionPolicies
      key={JSON.stringify([actor, revision, location?.recordId])}
      location={location}
    />
  );
}
function OwnedDocumentRetentionPolicies({ location }: { location?: Location | undefined }) {
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
  const numbers = useNumberFormatting(locale);
  const yearsInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const [data, setData] = useState<PoliciesResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState(location?.recordId ?? 'contract');
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
  const directory = location && !location.recordId;
  const Wrapper = location ? 'section' : 'details';

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
      if (!validYears) yearsInput.current?.focus();
      else noteInput.current?.focus();
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
    <Wrapper
      className="group rounded-xl border bg-card"
      aria-label={location ? word('retentionPolicies') : undefined}
    >
      {location && <RecordCommandGuard blocked={() => !!action} />}
      {!location && (
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 font-semibold hover:bg-muted/35 [&::-webkit-details-marker]:hidden">
          {word('retentionPolicies')}
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
      )}
      <div className={`space-y-3 p-4 ${location ? '' : 'border-t'}`}>
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
        {directory && data && !error && (
          <ul className="divide-y">
            {retentionKinds.map((kind) => {
              const policy = data.policies.find((entry) => entry.businessRecordType === kind);
              return (
                <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="space-y-0.5">
                    <h2 className="text-sm font-medium">{word(kind)}</h2>
                    <p className="text-xs text-muted-foreground">
                      {policy
                        ? word('retentionDuration').replace(
                            '{years}',
                            numbers.number(policy.retentionYears)
                          )
                        : word('noRetentionVersion')}
                    </p>
                  </div>
                  {data.canManage && (
                    <Link
                      to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
                      params={{ documentId: 'governance', section: 'retention', action: kind }}
                      search={location.search}
                      className={buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                        className: 'min-h-10',
                      })}
                      aria-label={word('editRetentionFor').replace('{kind}', word(kind))}
                    >
                      {word(policy ? 'editRetention' : 'setRetention')}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {location?.recordId && <h2 className="font-medium">{word(kind)}</h2>}
        {!location && (
          <Field className="max-w-sm gap-1.5">
            <FieldLabel htmlFor="retention-kind">{word('kind')}</FieldLabel>
            <NativeSelect
              id="retention-kind"
              className="w-full"
              aria-required="true"
              value={kind}
              disabled={unconfirmed || !!action}
              onChange={(event) => select(event.target.value)}
            >
              {retentionKinds.map((option) => (
                <option key={option} value={option}>
                  {word(option)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {!directory && current ? (
          <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/25 px-3 py-2.5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{word('currentRetention')}</dt>
              <dd className="font-medium">
                <bdi>{numbers.number(current.retentionYears)}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{word('policyEffective')}</dt>
              <dd>{time.format(current.effectiveDate)}</dd>
            </div>
          </dl>
        ) : null}
        {!directory && data?.canManage ? (
          <form noValidate onSubmit={submit} className={recordEditorSurface}>
            <RecordEditorSection title={word('retentionSettings')}>
              <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
                <Field className="gap-1.5" data-invalid={(attempted && !validYears) || undefined}>
                  <FieldLabel htmlFor="retention-years">{word('retentionYears')}</FieldLabel>
                  <Input
                    id="retention-years"
                    ref={yearsInput}
                    dir="ltr"
                    className="max-w-28"
                    type="number"
                    min={1}
                    max={100}
                    required
                    aria-required="true"
                    aria-invalid={(attempted && !validYears) || undefined}
                    aria-describedby={
                      attempted && !validYears ? 'retention-years-error' : undefined
                    }
                    value={years}
                    onChange={(event) => setYears(Number(event.target.value))}
                  />
                  {attempted && !validYears && (
                    <p id="retention-years-error" role="alert" className="text-sm text-destructive">
                      {word('retentionYearsError')}
                    </p>
                  )}
                </Field>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-sm sm:mt-5">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={held}
                    onChange={(event) => setHeld(event.target.checked)}
                  />
                  {word('policyHold')}
                </label>
                <Field
                  className="max-w-prose gap-1.5 sm:col-span-2"
                  data-invalid={(attempted && !validNote) || undefined}
                >
                  <FieldLabel htmlFor="retention-note">{word('approvalNote')}</FieldLabel>
                  <Textarea
                    id="retention-note"
                    ref={noteInput}
                    maxLength={1000}
                    rows={2}
                    dir="auto"
                    className={`min-h-14 resize-y ${locale === 'fa' ? 'placeholder:text-right' : 'placeholder:text-left'}`}
                    placeholder={word('policyExample')}
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
              </div>
            </RecordEditorSection>
            <RecordEditorActions>
              <Button type="submit" disabled={loading || error || unconfirmed || !!action}>
                {word(location ? 'reviewRetention' : 'savePolicy')}
              </Button>
            </RecordEditorActions>
          </form>
        ) : null}
        <CommandFeedback message={saved ? word('policyUpdated') : null} />
      </div>
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            location && (
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{word(action.kind)}</p>
                <p>
                  {word('retentionDuration').replace(
                    '{years}',
                    numbers.number(action.body.retentionYears)
                  )}
                </p>
                {action.body.legalHold && <p>{word('policyHold')}</p>}
                <div>
                  <p className="text-muted-foreground">{word('approvalNote')}</p>
                  <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                    {action.body.approvalNote}
                  </p>
                </div>
              </div>
            )
          }
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
    </Wrapper>
  );
}
