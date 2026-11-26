import { confirmationText } from '@barghsa/i18n/confirmation';
import { normalizeUsername } from '@barghsa/shared/username-normalization';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { t } from '@barghsa/i18n/recovery';
import { staffRecoveryText } from '@barghsa/i18n/staff-recovery';
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
import { RecoveryProfileField } from '../components/RecoveryProfileField.js';
import { normalizeProfileDigits } from '../lib/profile-digits.js';
interface RecoveryAction extends TeamAction {
  expectedState?: string;
  caseId?: string;
  submissionKey?: string;
  previousChallengeId?: string | null;
  summary?: ReactNode;
}
const emptyDraft = { profileId: '', newLogin: '', supportReference: '', reason: '' };
const emptyNotices = { oldContact: '', newContact: '' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecoverySection = 'review' | 'complete';
type RecoveryEntry =
  | { mode: 'lookup' | 'create'; openCase: (id: string) => void }
  | { mode: 'record'; id: string; section: RecoverySection | undefined; openDetails: () => void };
const recoveryCaseRoute = '/admin/crm/recovery/$caseId/{-$section}';

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
      key={JSON.stringify([
        actor,
        revision,
        entry.mode,
        ...(entry.mode === 'record' ? [entry.id, entry.section] : []),
      ])}
      actor={actor}
      entry={entry}
    />
  );
}
function RecoveryWorkflow({ actor, entry }: { actor: string | null; entry: RecoveryEntry }) {
  const locale = useLocale();
  const text = (key: string) => staffRecoveryText(`auth.recovery.${key}`, locale);
  const time = useAccountTime();
  const { number } = useNumberFormatting(locale);
  const [draft, setDraft] = useState(emptyDraft);
  const [profileName, setProfileName] = useState('');
  const [draftChecked, setDraftChecked] = useState(false);
  const [contactTouched, setContactTouched] = useState(false);
  const [caseId, setCaseId] = useState('');
  const [invalidCaseId, setInvalidCaseId] = useState(false);
  const selectedId = entry.mode === 'record' ? entry.id : null;
  const section = entry.mode === 'record' ? entry.section : undefined;
  const heading = useRef<HTMLHeadingElement>(null);
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
  const contactInput = useRef<HTMLInputElement | null>(null);
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
  useEffect(() => {
    if (section) heading.current?.focus({ preventScroll: true });
  }, [section]);
  const denied = useCallback(() => {
    upload.current?.abort();
    writePending.current = false;
    setAction(null);
    setHeldCreation(null);
    setCaseRecovery(null);
    setCaseId('');
    setDraft(emptyDraft);
    setProfileName('');
    setDraftChecked(false);
    setContactTouched(false);
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
  const contact = draft.newLogin.trim();
  const normalizedContact = normalizeUsername(
    /^[+\d۰-۹٠-٩]+$/.test(contact) ? normalizeProfileDigits(contact) : contact
  );
  const invalidContact = (draftChecked || (contactTouched && !!contact)) && !normalizedContact;
  const profileId = draft.profileId.trim().toLowerCase();
  const editorDisabled = busy || !!action || !!heldCreation || scope.denied;
  function changeProfile(id: string, title?: string) {
    if (uuidPattern.test(profileId) && profileId !== id.trim().toLowerCase()) {
      setFiles([]);
      if (fileInput.current) fileInput.current.value = '';
    }
    setDraft((current) => ({ ...current, profileId: id }));
    setProfileName(title ?? '');
    if (title) contactInput.current?.focus();
  }
  async function create(event: FormEvent<HTMLFormElement>) {
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
    setDraftChecked(true);
    const supportReference = draft.supportReference.trim();
    const reason = draft.reason.trim();
    const invalidField = !uuidPattern.test(profileId)
      ? '#recovery-profileId, #recovery-profile-search'
      : !normalizedContact
        ? '#recovery-newLogin'
        : !supportReference
          ? '#recovery-supportReference'
          : !reason
            ? '#recovery-reason'
            : null;
    if (invalidField || !normalizedContact) {
      if (invalidField) event.currentTarget.querySelector<HTMLElement>(invalidField)?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(false);
    const input = { profileId, newLogin: normalizedContact, supportReference, reason };
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
        description: [profileName, input.profileId, input.newLogin, input.supportReference]
          .filter(Boolean)
          .join(' · '),
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
  function command(
    kind: 'approve' | 'reject' | 'sendCode' | 'apply' | 'complete',
    body?: unknown,
    summary?: ReactNode
  ) {
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
      ...(summary === undefined ? {} : { summary }),
    });
  }
  const canReview = !!(
    data &&
    actor &&
    ['open', 'approved'].includes(data.state) &&
    data.createdBy !== actor
  );
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canReview || !notes.trim()) return;
    const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if (decision !== 'reject' && !(decision === 'approve' && data.state === 'open')) return;
    command(
      decision,
      { decision: decision === 'approve' ? 'approved' : 'rejected', notes: notes.trim() },
      <dl className="space-y-1 text-sm">
        <dt className="text-muted-foreground">{text('notes')}</dt>
        <dd className="whitespace-pre-wrap wrap-anywhere" dir="auto">
          {notes.trim()}
        </dd>
      </dl>
    );
  }
  function complete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const oldContact = notices.oldContact.trim(),
      newContact = notices.newContact.trim();
    if (data?.state !== 'applied' || !oldContact || !newContact) return;
    command(
      'complete',
      { oldContact, newContact },
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {(
          [
            ['oldNotice', oldContact],
            ['newNotice', newContact],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-muted-foreground">{text(key)}</dt>
            <dd className="wrap-anywhere">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <section className="mx-auto min-w-0 max-w-3xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {section && selectedId ? (
        <Link
          to={recoveryCaseRoute}
          params={{ caseId: selectedId, section: undefined }}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {text('backToRecoveryCase')}
        </Link>
      ) : (
        entry.mode !== 'lookup' && (
          <Link
            to="/admin/crm/recovery"
            className="text-sm text-primary underline underline-offset-4"
          >
            {text('title')}
          </Link>
        )
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            ref={heading}
            tabIndex={section ? -1 : undefined}
            className="text-xl font-semibold outline-none"
          >
            {text(
              section === 'review'
                ? 'reviewCaseAction'
                : section === 'complete'
                  ? 'recordReceiptsAction'
                  : entry.mode === 'create'
                    ? 'newCase'
                    : entry.mode === 'record'
                      ? 'record'
                      : 'title'
            )}
          </h1>
        </div>
        {entry.mode === 'lookup' && (
          <Link
            to="/admin/crm/recovery/$caseId/{-$section}"
            params={{ caseId: 'new', section: undefined }}
            className={buttonVariants()}
          >
            {text('newCase')}
          </Link>
        )}
      </header>
      {entry.mode === 'create' && (
        <form onSubmit={(event) => void create(event)} className={recordEditorSurface}>
          <fieldset disabled={editorDisabled}>
            {!scope.denied && (
              <RecordEditorSection title={text('customerProfile')}>
                <RecoveryProfileField
                  label={text}
                  profileId={draft.profileId}
                  invalid={draftChecked && !uuidPattern.test(profileId)}
                  disabled={editorDisabled}
                  onChange={changeProfile}
                  onSessionExpired={scope.deny}
                />
              </RecordEditorSection>
            )}
            <RecordEditorSection title={text('contactDetails')}>
              <div className={recordEditorGrid}>
                <div className={recordEditorField}>
                  <Label htmlFor="recovery-newLogin">{text('newLogin')}</Label>
                  <Input
                    ref={contactInput}
                    id="recovery-newLogin"
                    required
                    aria-required="true"
                    aria-invalid={invalidContact || undefined}
                    aria-describedby="recovery-new-login-help"
                    dir="ltr"
                    maxLength={255}
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.newLogin}
                    onBlur={() => setContactTouched(true)}
                    onChange={(event) =>
                      setDraft((old) => ({ ...old, newLogin: event.target.value }))
                    }
                  />
                  <p
                    id="recovery-new-login-help"
                    className={`text-xs ${invalidContact ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {text(invalidContact ? 'invalidNewLogin' : 'newLoginHelp')}
                  </p>
                </div>
                <div className={recordEditorField}>
                  <Label htmlFor="recovery-supportReference">{text('supportReference')}</Label>
                  <Input
                    id="recovery-supportReference"
                    required
                    aria-required="true"
                    aria-invalid={(draftChecked && !draft.supportReference.trim()) || undefined}
                    aria-describedby="recovery-support-reference-help"
                    dir="auto"
                    maxLength={200}
                    autoComplete="off"
                    value={draft.supportReference}
                    onChange={(event) =>
                      setDraft((old) => ({ ...old, supportReference: event.target.value }))
                    }
                  />
                  <p id="recovery-support-reference-help" className="text-xs text-muted-foreground">
                    {text('supportReferenceHelp')}
                  </p>
                </div>
              </div>
            </RecordEditorSection>
            <RecordEditorSection title={text('evidenceTitle')}>
              <div className={recordEditorField}>
                <Label htmlFor="recovery-reason">{text('reason')}</Label>
                <Textarea
                  id="recovery-reason"
                  required
                  aria-required="true"
                  aria-invalid={(draftChecked && !draft.reason.trim()) || undefined}
                  aria-describedby="recovery-reason-help"
                  maxLength={2000}
                  rows={2}
                  className="min-h-14 resize-y"
                  value={draft.reason}
                  onChange={(event) => setDraft((old) => ({ ...old, reason: event.target.value }))}
                />
                <p id="recovery-reason-help" className="text-xs text-muted-foreground">
                  {text('reasonExample')}
                </p>
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
      {(busy || read.loading) &&
        (data ? (
          <LoadingStatus>{text('loading')}</LoadingStatus>
        ) : (
          <RecordDetailSkeleton label={text('loading')} />
        ))}
      {data && (
        <article className="space-y-4 rounded-xl border bg-card p-4 wrap-anywhere sm:p-6">
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <Badge variant={data.state === 'rejected' ? 'outline' : 'secondary'}>
                {text(`state.${data.state}`)}
              </Badge>
              <p className="text-sm">
                <span className="block text-muted-foreground sm:inline">{text('caseId')} </span>
                <bdi dir="ltr" className="break-all">
                  {data.id}
                </bdi>
              </p>
            </div>
            <ListRefreshButton
              label={text('refresh')}
              refreshing={read.loading}
              disabled={!!action}
              className="shrink-0"
              onClick={read.retry}
            />
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-4 text-sm">
            {(section === 'complete'
              ? (['supportReference'] as const)
              : (['oldLogin', 'newLogin', 'supportReference'] as const)
            ).map((key) => (
              <div key={key}>
                <dt className="text-muted-foreground">{text(key)}</dt>
                <dd className={key === 'newLogin' ? 'font-medium' : undefined}>
                  <bdi>{key === 'supportReference' ? data[key] : maskedContact(data[key])}</bdi>
                </dd>
              </div>
            ))}
            {!section && (
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
            )}
            {section !== 'complete' && (
              <div className="col-span-2">
                <dt className="font-medium">{text('reason')}</dt>
                <dd className="whitespace-pre-wrap">{data.reason}</dd>
              </div>
            )}
            {!section && data.reviewerNotes && (
              <div className="col-span-2">
                <dt className="font-medium">{text('reviewerNotes')}</dt>
                <dd className="whitespace-pre-wrap">{data.reviewerNotes}</dd>
              </div>
            )}
          </dl>
          <details
            key={JSON.stringify([data.oldLogin, data.newLogin, data.challengeId])}
            className="rounded-md border text-sm"
          >
            <summary className="cursor-pointer rounded-md px-3 py-2.5 font-medium pointer-coarse:min-h-11 pointer-coarse:py-3">
              {text('showContactDetails')}
            </summary>
            <dl className="grid gap-3 px-3 pb-3 sm:grid-cols-2">
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
          {section !== 'complete' && data.evidenceDownloadUrls.length > 0 && (
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
                    className={buttonVariants({ variant: 'outline' })}
                  >
                    {text('evidenceFile')} {number(index + 1)}
                  </a>
                );
              })}
            </section>
          )}
          {!section && ['open', 'approved', 'applied'].includes(data.state) && (
            <div className={recordEditorSurface}>
              {data.state === 'open' && !canReview && (
                <RecordEditorSection
                  title={text('reviewDecision')}
                  description={text('independentReview')}
                />
              )}
              {canReview && (
                <RecordEditorSection title={text('reviewDecision')}>
                  <Link
                    to={recoveryCaseRoute}
                    params={{ caseId: data.id, section: 'review' }}
                    className={buttonVariants({
                      variant: data.state === 'open' ? 'default' : 'outline',
                    })}
                    disabled={blocked}
                  >
                    {text('reviewCaseAction')}
                  </Link>
                </RecordEditorSection>
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
                <RecordEditorSection
                  title={text('noticeReceipts')}
                  description={text('noticeHelp')}
                >
                  <Link
                    to={recoveryCaseRoute}
                    params={{ caseId: data.id, section: 'complete' }}
                    className={buttonVariants()}
                    disabled={blocked}
                  >
                    {text('recordReceiptsAction')}
                  </Link>
                </RecordEditorSection>
              )}
            </div>
          )}
          {!section && (
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
                        <pre className="whitespace-pre-wrap break-words text-sm">
                          {item.metadata}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </article>
      )}
      {data &&
        section === 'review' &&
        (canReview ? (
          <form
            className={recordEditorSurface}
            aria-labelledby="recovery-review-notes-title"
            onSubmit={review}
          >
            <RecordEditorSection
              title={text('reviewNotesTitle')}
              anchorId="recovery-review-notes-title"
            >
              <div className={recordEditorField}>
                <Label htmlFor="recovery-notes">{text('notes')}</Label>
                <Textarea
                  id="recovery-notes"
                  required
                  aria-required="true"
                  aria-describedby="recovery-review-notes-help"
                  className="min-h-14 resize-y"
                  dir="auto"
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  disabled={blocked}
                  onChange={(event) => setNotes(event.target.value)}
                />
                <p id="recovery-review-notes-help" className="text-xs text-muted-foreground">
                  {text('noteExample')}
                </p>
              </div>
            </RecordEditorSection>
            <RecordEditorActions>
              {data.state === 'open' && (
                <Button type="submit" value="approve" disabled={blocked || !notes.trim()}>
                  {text('approve')}
                </Button>
              )}
              <Button
                type="submit"
                value="reject"
                variant="outline"
                disabled={blocked || !notes.trim()}
              >
                {text('reject')}
              </Button>
            </RecordEditorActions>
          </form>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {text(data.createdBy === actor ? 'independentReview' : 'reviewUnavailable')}
          </p>
        ))}
      {data &&
        section === 'complete' &&
        (data.state === 'applied' ? (
          <form
            className={recordEditorSurface}
            aria-labelledby="recovery-receipts-title"
            onSubmit={complete}
          >
            <RecordEditorSection
              title={text('noticeReceipts')}
              anchorId="recovery-receipts-title"
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
                      required
                      aria-required="true"
                      aria-describedby={`recovery-notice-${key}-contact`}
                      disabled={blocked}
                      maxLength={200}
                      dir="auto"
                      autoComplete="off"
                      spellCheck={false}
                      value={notices[key]}
                      onChange={(event) =>
                        setNotices((old) => ({ ...old, [key]: event.target.value }))
                      }
                    />
                    <p
                      id={`recovery-notice-${key}-contact`}
                      className="text-xs text-muted-foreground"
                    >
                      <bdi dir="ltr">
                        {maskedContact(key === 'oldContact' ? data.oldLogin : data.newLogin)}
                      </bdi>
                    </p>
                  </div>
                ))}
              </div>
            </RecordEditorSection>
            <RecordEditorActions>
              <Button
                type="submit"
                disabled={blocked || !notices.oldContact.trim() || !notices.newContact.trim()}
              >
                {text('completeCaseAction')}
              </Button>
            </RecordEditorActions>
          </form>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {text('receiptsUnavailable')}
          </p>
        ))}
      {action && (
        <TeamActionDialog
          action={action}
          summary={
            action.summary ??
            (action.submissionKey && (
              <p className="text-sm text-muted-foreground">{text('staffReviewNext')}</p>
            ))
          }
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
            else if (entry.mode === 'record' && section) entry.openDetails();
            else read.retry();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </section>
  );
}
