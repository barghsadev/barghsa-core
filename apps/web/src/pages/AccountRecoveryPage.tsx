import { confirmationText } from '@barghsa/i18n/confirmation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import {
  Alert,
  Badge,
  Button,
  Input,
  Label,
  ListRefreshButton,
  LoadingStatus,
  Textarea,
  buttonVariants,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/recovery';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import {
  INVOICE_BANK_RECEIPT_FILE_ACCEPT,
  isAllowedInvoiceReceiptFile,
  uploadVerificationEvidence,
} from '../lib/invoice-bank-receipt-upload.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { VerificationEvidencePicker } from '../components/VerificationEvidencePicker.js';
interface RecoveryAction extends TeamAction {
  expectedState?: string;
  caseId?: string;
  submissionKey?: string;
  previousChallengeId?: string | null;
}
const emptyDraft = { profileId: '', newLogin: '', supportReference: '', reason: '' };
const emptyNotices = { oldContact: '', newContact: '' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecoveryEntry =
  { mode: 'lookup' | 'create'; openCase: (id: string) => void } | { mode: 'record'; id: string };

function maskedContact(login: string) {
  const at = login.lastIndexOf('@');
  if (at > 0) return `${login.slice(0, 1)}•••${login.slice(at)}`;
  return login.length > 4 ? `••••${login.slice(-4)}` : '••••';
}
interface RecoveryCase {
  id: string;
  profileId: string;
  targetUserId: string;
  oldLogin: string;
  newLogin: string;
  state: string;
  createdBy: string;
  reviewedBy: string | null;
  supportReference: string;
  reason: string;
  reviewerNotes: string | null;
  challengeId: string | null;
  contactVerified: boolean;
  evidenceDownloadUrls: string[];
  history: Array<{
    event: string;
    created_at: string;
    user_id: string;
    metadata: string;
    correlation_id: string;
  }>;
}
function valid(value: unknown): value is RecoveryCase {
  if (typeof value !== 'object' || !value) return false;
  const row = value as RecoveryCase;
  return (
    [
      'id',
      'profileId',
      'targetUserId',
      'oldLogin',
      'newLogin',
      'createdBy',
      'supportReference',
      'reason',
    ].every((k) => typeof row[k as keyof RecoveryCase] === 'string') &&
    uuidPattern.test(row.profileId) &&
    (row.reviewedBy === null || typeof row.reviewedBy === 'string') &&
    (row.reviewerNotes === null || typeof row.reviewerNotes === 'string') &&
    ['open', 'approved', 'rejected', 'applied', 'completed'].includes(row.state) &&
    typeof row.contactVerified === 'boolean' &&
    (row.challengeId === null || typeof row.challengeId === 'string') &&
    Array.isArray(row.evidenceDownloadUrls) &&
    row.evidenceDownloadUrls.every((x) => typeof x === 'string') &&
    Array.isArray(row.history) &&
    row.history.every(
      (x) =>
        x &&
        typeof x.event === 'string' &&
        typeof x.created_at === 'string' &&
        Number.isFinite(Date.parse(x.created_at)) &&
        typeof x.user_id === 'string' &&
        typeof x.correlation_id === 'string'
    )
  );
}
export default function AccountRecoveryPage({ entry }: { entry: RecoveryEntry }) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  return (
    <RecoveryWorkflow
      key={JSON.stringify([actor, revision, entry.mode, entry.mode === 'record' ? entry.id : null])}
      actor={actor}
      entry={entry}
    />
  );
}
function RecoveryWorkflow({ actor, entry }: { actor: string | null; entry: RecoveryEntry }) {
  const locale = useLocale();
  const text = (key: string) => t(`auth.recovery.${key}`, locale);
  const time = useAccountTime();
  const { number } = useNumberFormatting(locale);
  const [draft, setDraft] = useState(emptyDraft);
  const [caseId, setCaseId] = useState('');
  const [invalidCaseId, setInvalidCaseId] = useState(false);
  const selectedId = entry.mode === 'record' ? entry.id : null;
  const [files, setFiles] = useState<File[]>([]),
    [notes, setNotes] = useState('');
  const invalidEvidence =
    files.length > 5 || files.some((file) => !isAllowedInvoiceReceiptFile(file));
  const [notices, setNotices] = useState(emptyNotices);
  const [action, setAction] = useState<RecoveryAction | null>(null),
    [heldCreation, setHeldCreation] = useState<RecoveryAction | null>(null),
    [caseRecovery, setCaseRecovery] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const mounted = useRef(true),
    inFlight = useRef(false);
  const upload = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const writePending = useRef(false);
  useBlocker({
    shouldBlockFn: () => inFlight.current || writePending.current,
    enableBeforeUnload: () => inFlight.current || writePending.current,
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      upload.current?.abort();
    };
  }, []);
  const denied = useCallback(() => {
    upload.current?.abort();
    writePending.current = false;
    setAction(null);
    setHeldCreation(null);
    setCaseRecovery(null);
    setCaseId('');
    setDraft(emptyDraft);
    setFiles([]);
    setNotes('');
    setNotices(emptyNotices);
    if (fileInput.current) fileInput.current.value = '';
  }, []);
  const scope = useCatalogueScope(denied);
  const validateCase = useCallback(
    (value: unknown): value is RecoveryCase => valid(value) && value.id === selectedId,
    [selectedId]
  );
  const read = useCatalogueResource(
    scope,
    selectedId ? `/api/crm/account-recovery/${selectedId}` : null,
    validateCase
  );
  const data = read.data;
  const blocked =
    busy ||
    !!action ||
    !!heldCreation ||
    read.loading ||
    scope.denied ||
    read.error ||
    (caseRecovery !== null && (read.readAttempt ?? -1) < caseRecovery);
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      entry.mode !== 'create' ||
      inFlight.current ||
      busy ||
      action ||
      heldCreation ||
      scope.denied ||
      invalidEvidence ||
      !files.length
    )
      return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    const input = { ...draft };
    const controller = new AbortController();
    upload.current = controller;
    const keys: string[] = [];
    try {
      for (const file of files) {
        const key = await uploadVerificationEvidence(file, input.profileId, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        if (!key) throw new Error();
        keys.push(key);
      }
      const submissionKey = crypto.randomUUID();
      setAction({
        title: t('auth.recovery.create', locale),
        description: `${input.profileId} · ${input.newLogin} · ${input.supportReference}`,
        path: '/api/crm/account-recovery',
        method: 'POST',
        successStatus: 201,
        expectedState: 'open',
        submissionKey,
        body: { ...input, evidenceKeys: keys, submissionKey },
      });
    } catch {
      if (mounted.current && !controller.signal.aborted) setError(true);
    } finally {
      inFlight.current = false;
      upload.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  function command(kind: 'approve' | 'reject' | 'sendCode' | 'apply' | 'complete', body?: unknown) {
    if (!data || blocked) return;
    setError(false);
    setCaseRecovery(null);
    setAction({
      title: t(`auth.recovery.${kind}`, locale),
      description: `${data.id} · ${data.targetUserId} · ${data.oldLogin} → ${data.newLogin}`,
      path: `/api/crm/account-recovery/${data.id}/${kind === 'approve' || kind === 'reject' ? 'review' : kind === 'sendCode' ? 'code' : kind}`,
      method: 'POST',
      caseId: data.id,
      ...(kind === 'sendCode'
        ? { previousChallengeId: data.challengeId, body: { expectedChallengeId: data.challengeId } }
        : {
            expectedState:
              kind === 'approve'
                ? 'approved'
                : kind === 'reject'
                  ? 'rejected'
                  : kind === 'apply'
                    ? 'applied'
                    : 'completed',
          }),
      ...(body === undefined ? {} : { body }),
    });
  }
  const canReview = data && ['open', 'approved'].includes(data.state) && data.createdBy !== actor;
  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {entry.mode !== 'lookup' && (
        <Link
          to="/admin/crm/recovery"
          className="text-sm text-primary underline underline-offset-4"
        >
          {text('title')}
        </Link>
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {text(
              entry.mode === 'create' ? 'newCase' : entry.mode === 'record' ? 'record' : 'title'
            )}
          </h1>
        </div>
        {entry.mode === 'lookup' && (
          <Link to="/admin/crm/recovery/new" className={buttonVariants()}>
            {text('newCase')}
          </Link>
        )}
      </header>
      {entry.mode === 'create' && (
        <form onSubmit={(event) => void create(event)} className={recordEditorSurface}>
          <fieldset disabled={busy || !!action || !!heldCreation || scope.denied}>
            <RecordEditorSection title={text('contactDetails')}>
              <div className={recordEditorGrid}>
                {(['profileId', 'newLogin', 'supportReference'] as const).map((key) => (
                  <div key={key} className={recordEditorField}>
                    <Label htmlFor={`recovery-${key}`}>{text(key)}</Label>
                    <Input
                      id={`recovery-${key}`}
                      required
                      aria-required="true"
                      value={draft[key]}
                      dir={key === 'supportReference' ? 'auto' : 'ltr'}
                      maxLength={key === 'profileId' ? 36 : key === 'newLogin' ? 255 : 200}
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby={key === 'profileId' ? 'recovery-profile-hint' : undefined}
                      onChange={(event) =>
                        setDraft((old) => ({ ...old, [key]: event.target.value }))
                      }
                    />
                    {key === 'profileId' && (
                      <p id="recovery-profile-hint" className="text-sm text-muted-foreground">
                        {text('profileIdHint')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </RecordEditorSection>
            <RecordEditorSection title={text('evidenceTitle')}>
              <div className={recordEditorField}>
                <Label htmlFor="recovery-reason">{text('reason')}</Label>
                <Textarea
                  id="recovery-reason"
                  required
                  aria-required="true"
                  maxLength={2000}
                  rows={2}
                  className="min-h-14 resize-y"
                  placeholder={text('reasonExample')}
                  value={draft.reason}
                  onChange={(event) => setDraft((old) => ({ ...old, reason: event.target.value }))}
                />
              </div>
              <VerificationEvidencePicker
                id="recovery-evidence"
                locale={locale}
                inputRef={fileInput}
                accept={INVOICE_BANK_RECEIPT_FILE_ACCEPT}
                instructions={text('evidence')}
                chooseLabel={text('chooseEvidence')}
                emptyLabel={text('noEvidence')}
                files={files}
                error={invalidEvidence ? text('invalidEvidence') : undefined}
                onChange={setFiles}
              />
            </RecordEditorSection>
            <RecordEditorSection title={text('reviewProcess')} description={text('instructions')} />
            <RecordEditorActions>
              <Button type="submit" disabled={!files.length || invalidEvidence}>
                {text('create')}
              </Button>
            </RecordEditorActions>
          </fieldset>
        </form>
      )}
      {heldCreation && !action && (
        <div className="space-y-2">
          <p role="alert">{confirmationText('unconfirmed', locale)}</p>
          <Button
            variant="outline"
            onClick={() =>
              setAction({ ...heldCreation, title: t('auth.recovery.retryCreation', locale) })
            }
          >
            {t('auth.recovery.retryCreation', locale)}
          </Button>
        </div>
      )}
      {caseRecovery !== null && <p role="alert">{confirmationText('unconfirmed', locale)}</p>}
      {entry.mode === 'lookup' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const id = caseId.trim().toLowerCase();
            if (!uuidPattern.test(id)) {
              setInvalidCaseId(true);
              e.currentTarget.querySelector('input')?.focus();
              return;
            }
            entry.openCase(id);
          }}
          className={recordEditorSurface}
        >
          <RecordEditorSection title={text('caseLookup')} description={text('lookupHelp')}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1 basis-64 space-y-1.5">
                <Label htmlFor="recovery-case-id">{t('auth.recovery.caseId', locale)}</Label>
                <Input
                  id="recovery-case-id"
                  required
                  aria-required="true"
                  value={caseId}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={invalidCaseId || undefined}
                  aria-describedby={invalidCaseId ? 'recovery-lookup-error' : undefined}
                  onChange={(e) => {
                    setCaseId(e.target.value);
                    setInvalidCaseId(false);
                  }}
                />
              </div>
              <Button type="submit">{t('auth.recovery.load', locale)}</Button>
            </div>
            {invalidCaseId && (
              <p id="recovery-lookup-error" role="alert" className="mt-2 text-sm text-destructive">
                {text('invalidCaseId')}
              </p>
            )}
          </RecordEditorSection>
        </form>
      )}
      {(error || read.error || scope.denied) && (
        <Alert variant="destructive" className="space-y-2">
          <p>{text('error')}</p>
          {(scope.denied || read.error) && (
            <Button
              variant="outline"
              onClick={() => (scope.denied ? scope.recover() : read.retry())}
            >
              {text('refresh')}
            </Button>
          )}
        </Alert>
      )}
      {(busy || read.loading) && <LoadingStatus>{text('loading')}</LoadingStatus>}
      {data && (
        <article className="space-y-6 rounded-lg border bg-card p-4 [overflow-wrap:anywhere] sm:p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Badge variant={data.state === 'rejected' ? 'outline' : 'secondary'}>
                {text(`state.${data.state}`)}
              </Badge>
              <p className="text-sm">
                <span className="text-muted-foreground">{text('caseId')} </span>
                <bdi dir="ltr">{data.id}</bdi>
              </p>
            </div>
            <ListRefreshButton
              label={text('refresh')}
              refreshing={read.loading}
              disabled={!!action}
              onClick={read.retry}
            />
          </header>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            {(['oldLogin', 'newLogin', 'supportReference'] as const).map((key) => (
              <div key={key}>
                <dt className="text-muted-foreground">{text(key)}</dt>
                <dd>
                  <bdi>{key === 'supportReference' ? data[key] : maskedContact(data[key])}</bdi>
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-muted-foreground">{text('profileId')}</dt>
              <dd>
                <Link
                  to="/admin/crm/profiles/$profileId"
                  params={{ profileId: data.profileId }}
                  className="text-primary underline underline-offset-4"
                >
                  <bdi dir="ltr">{data.profileId}</bdi>
                </Link>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="font-medium">{text('reason')}</dt>
              <dd className="whitespace-pre-wrap">{data.reason}</dd>
            </div>
            {data.reviewerNotes && (
              <div className="sm:col-span-2">
                <dt className="font-medium">{text('reviewerNotes')}</dt>
                <dd className="whitespace-pre-wrap">{data.reviewerNotes}</dd>
              </div>
            )}
          </dl>
          <details
            key={JSON.stringify([data.oldLogin, data.newLogin, data.challengeId])}
            className="rounded-md border p-3 text-sm"
          >
            <summary className="cursor-pointer font-medium pointer-coarse:min-h-11 pointer-coarse:py-2">
              {text('showContactDetails')}
            </summary>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt>{text('oldLogin')}</dt>
                <dd>
                  <bdi dir="ltr">{data.oldLogin}</bdi>
                </dd>
              </div>
              <div>
                <dt>{text('newLogin')}</dt>
                <dd>
                  <bdi dir="ltr">{data.newLogin}</bdi>
                </dd>
              </div>
              {data.challengeId && (
                <div className="sm:col-span-2">
                  <dt>{text('challengeId')}</dt>
                  <dd>
                    <bdi dir="ltr">{data.challengeId}</bdi>
                  </dd>
                </div>
              )}
            </dl>
          </details>
          {data.evidenceDownloadUrls.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-semibold">{text('evidenceTitle')}</h2>
              {data.evidenceDownloadUrls.map((url, index) => {
                try {
                  if (!['https:', 'http:'].includes(new URL(url).protocol)) return null;
                } catch {
                  return null;
                }
                return (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block underline"
                  >
                    {text('evidenceFile')} {number(index + 1)}
                  </a>
                );
              })}
            </section>
          )}
          {['open', 'approved', 'applied'].includes(data.state) && (
            <div className={recordEditorSurface}>
              {data.state === 'open' && !canReview && (
                <RecordEditorSection
                  title={text('reviewDecision')}
                  description={text('independentReview')}
                />
              )}
              {canReview && (
                <>
                  <RecordEditorSection title={text('reviewDecision')}>
                    <div className={recordEditorField}>
                      <Label htmlFor="recovery-notes">{text('notes')}</Label>
                      <Textarea
                        id="recovery-notes"
                        aria-required="true"
                        className="min-h-14 resize-y"
                        rows={2}
                        placeholder={text('noteExample')}
                        value={notes}
                        disabled={blocked}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </div>
                  </RecordEditorSection>
                  <RecordEditorActions>
                    {data.state === 'open' && (
                      <Button
                        disabled={blocked || !notes.trim()}
                        onClick={() => command('approve', { decision: 'approved', notes })}
                      >
                        {text('approve')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      disabled={blocked || !notes.trim()}
                      onClick={() => command('reject', { decision: 'rejected', notes })}
                    >
                      {text('reject')}
                    </Button>
                  </RecordEditorActions>
                </>
              )}
              {data.state === 'approved' && (
                <>
                  <RecordEditorSection
                    title={text('contactVerification')}
                    description={text(data.contactVerified ? 'contactChecked' : 'awaitingContact')}
                  />
                  <RecordEditorActions>
                    <Button
                      variant={data.contactVerified ? 'outline' : 'default'}
                      disabled={blocked}
                      onClick={() => command('sendCode')}
                    >
                      {text('sendCode')}
                    </Button>
                    {data.createdBy !== actor && (
                      <Button
                        variant="destructive"
                        disabled={blocked || !data.contactVerified}
                        onClick={() => command('apply')}
                      >
                        {text('apply')}
                      </Button>
                    )}
                  </RecordEditorActions>
                </>
              )}
              {data.state === 'applied' && (
                <>
                  <RecordEditorSection
                    title={text('noticeReceipts')}
                    description={text('noticeHelp')}
                  >
                    <div className={recordEditorGrid}>
                      {(['oldContact', 'newContact'] as const).map((key) => (
                        <div key={key} className={recordEditorField}>
                          <Label htmlFor={`recovery-notice-${key}`}>
                            {text(key === 'oldContact' ? 'oldNotice' : 'newNotice')}
                          </Label>
                          <Input
                            id={`recovery-notice-${key}`}
                            aria-required="true"
                            disabled={blocked}
                            value={notices[key]}
                            onChange={(event) =>
                              setNotices((old) => ({ ...old, [key]: event.target.value }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </RecordEditorSection>
                  <RecordEditorActions>
                    <Button
                      disabled={blocked || !notices.oldContact.trim() || !notices.newContact.trim()}
                      onClick={() => command('complete', notices)}
                    >
                      {text('complete')}
                    </Button>
                  </RecordEditorActions>
                </>
              )}
            </div>
          )}
          <section className="space-y-3 border-t pt-4">
            <h2 className="font-semibold">{text('history')}</h2>
            {time.notice}
            {data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{text('emptyHistory')}</p>
            ) : (
              <ol className="space-y-2">
                {data.history.map((item, index) => (
                  <li key={index}>
                    <details>
                      <summary className="cursor-pointer pointer-coarse:min-h-11 pointer-coarse:py-2">
                        <bdi>
                          {time.format(item.created_at)} ·{' '}
                          {text(`event.${item.event}`) === `auth.recovery.event.${item.event}`
                            ? item.event
                            : text(`event.${item.event}`)}
                        </bdi>
                      </summary>
                      <p>
                        <bdi>
                          {item.user_id} · {item.correlation_id}
                        </bdi>
                      </p>
                      <pre className="whitespace-pre-wrap break-words text-sm">{item.metadata}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </article>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          onPendingChange={(pending) => {
            writePending.current = pending;
          }}
          onClose={() => {
            writePending.current = false;
            setAction(null);
          }}
          onDenied={() => scope.deny()}
          onUnconfirmed={() => {
            writePending.current = false;
            if (action.submissionKey) {
              setHeldCreation(action);
            } else {
              setCaseRecovery(read.retry());
              setAction(null);
            }
          }}
          onSuccess={async (result) => {
            if (!mounted.current) return;
            if (
              typeof result !== 'object' ||
              result === null ||
              !('id' in result) ||
              typeof result.id !== 'string' ||
              !uuidPattern.test(result.id)
            )
              throw new Error('Unconfirmed recovery receipt');
            if (
              action.expectedState &&
              (!('state' in result) ||
                (result.state !== action.expectedState &&
                  !(action.expectedState === 'applied' && result.state === 'completed')))
            )
              throw new Error('Unconfirmed recovery state');
            if (
              action.previousChallengeId !== undefined &&
              (!('challengeId' in result) ||
                typeof result.challengeId !== 'string' ||
                !uuidPattern.test(result.challengeId) ||
                result.challengeId === action.previousChallengeId)
            )
              throw new Error('Unconfirmed recovery challenge');
            if (action.caseId && result.id !== action.caseId)
              throw new Error('Wrong recovery receipt');
            if (action.submissionKey) {
              if (!('submissionKey' in result) || result.submissionKey !== action.submissionKey)
                throw new Error('Wrong creation receipt');
              setHeldCreation(null);
              setDraft(emptyDraft);
              setFiles([]);
              setNotes('');
              setNotices(emptyNotices);
              if (fileInput.current) fileInput.current.value = '';
            }
            writePending.current = false;
            setAction(null);
            if (entry.mode === 'create') entry.openCase(result.id);
            else read.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
