import { canReplaceDocument, validDocumentDetail } from '../lib/document-records.js';
import { isContractAttachmentRole } from '../lib/contract-attachments.js';
import {
  relatedDocumentListLocation,
  relatedDocumentLocation,
  relatedDocumentMatches,
  type RelatedDocumentContext,
} from '../lib/related-document-route.js';
import { RecordCommandGuard } from './RecordCommandGuard.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  Field,
  FieldLabel,
  PageLoading,
  Textarea,
  Timeline,
  WaitingForBarghsa,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';
import { Link } from '@tanstack/react-router';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import { DocumentLegalHolds, type DocumentHoldPage } from './DocumentLegalHolds.js';
import { DocumentStatusBadge } from './DocumentStatusBadge.js';
import { FilePreview } from './FilePreview.js';
import {
  documentBase,
  DocumentRequestError,
  isQuarantinedDocument,
  documentUrl,
  type BusinessDocument,
  type DocumentAction,
  type DocumentDetail as Detail,
} from '../lib/documents.js';

const transitionState: Record<DocumentAction, BusinessDocument['state']> = {
  submit: 'SubmittedForReview',
  approve: 'Approved',
  reject: 'Rejected',
  'request-changes': 'Available',
  quarantine: 'Quarantined',
  remove: 'Removed',
};
const reasonRequiredActions = new Set<DocumentAction>(['reject', 'request-changes', 'quarantine']);
type Transition = TeamAction & {
  target: { id: string; profileId: string; revision: number; state: BusinessDocument['state'] };
  body: { expectedRevision: number; idempotencyKey: string; reason?: string };
};

function unavailable(failure: unknown) {
  return failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status);
}

export function DocumentDetail(props: Parameters<typeof OwnedDocumentDetail>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedDocumentDetail
      key={JSON.stringify([
        actor,
        revision,
        props.id,
        props.profileId,
        props.staff,
        props.decision,
        props.related?.kind,
        props.related?.id,
        props.related?.kind === 'contract' ? props.related.versionId : undefined,
      ])}
      {...props}
    />
  );
}
function OwnedDocumentDetail({
  id,
  profileId = '',
  staff,
  onClose,
  onChanged,
  onReplace,
  onPrevious,
  savingPreSubmissionOnly = false,
  solarCustomer = false,
  related,
  allowReplacement = true,
  previewOnly = false,
  showRetention = false,
  holdPage,
  decision,
  recordSearch,
}: {
  id: string;
  profileId?: string;
  staff: boolean;
  onClose?: () => void;
  onChanged?: () => void;
  onReplace?: (document: BusinessDocument) => void;
  onPrevious?: (id: string) => void;
  savingPreSubmissionOnly?: boolean;
  solarCustomer?: boolean;
  related?: RelatedDocumentContext;
  allowReplacement?: boolean;
  previewOnly?: boolean;
  showRetention?: boolean;
  holdPage?: DocumentHoldPage | undefined;
  decision?: DocumentAction | undefined;
  recordSearch?: Record<string, unknown>;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    staff,
    profileId,
    JSON.stringify([id, staff, related?.kind, related?.id])
  );
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const numbers = useNumberFormatting(locale);
  const [document, setDocument] = useState<Detail | null>(null);
  const [error, setError] = useState<'retry' | 'denied' | null>(null);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [action, setAction] = useState<Transition | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const inlineDecision = !staff && !!decision;
  const [recordedState, setRecordedState] = useState<BusinessDocument['state'] | null>(null);
  const unconfirmed = useRef<Transition | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [download, setDownload] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewController = useRef<AbortController | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const recordHeading = useRef<HTMLHeadingElement>(null);
  const recordPage = !!(recordSearch || related);
  useEffect(() => {
    if (recordPage) recordHeading.current?.focus({ preventScroll: true });
  }, [id, recordPage, recordSearch, holdPage, decision]);
  useEffect(() => {
    const controller = new AbortController();
    previewController.current?.abort();
    downloadController.current?.abort();
    setDownloading(false);
    setDownloadError(false);
    setDocument(null);
    setDownload(null);
    setPreview(null);
    setPreviewing(false);
    setPreviewError(false);
    setError(null);
    void readDocument<unknown>(`${documentBase(staff)}/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        const pending = unconfirmed.current;
        if (
          !validDocumentDetail(data, id, profileId) ||
          (pending && data.profileId !== pending.target.profileId)
        )
          throw new Error('Invalid document detail');
        if (related && !relatedDocumentMatches(data, related))
          throw new DocumentRequestError(404, null);
        if (pending?.body.expectedRevision !== data.revision || data.permissions?.write === false)
          unconfirmed.current = null;
        setDocument(data);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (unavailable(failure)) withdrawDenied();
        else setError('retry');
      });
    return () => {
      controller.abort();
      previewController.current?.abort();
      downloadController.current?.abort();
    };
  }, [id, staff, profileId, reload, readDocument]);

  async function getDownload() {
    downloadController.current?.abort();
    const controller = new AbortController();
    downloadController.current = controller;
    setDownload(null);
    setDownloading(true);
    setDownloadError(false);
    try {
      const data = await readDocument<{ url: string }>(
        `${documentBase(staff)}/${encodeURIComponent(id)}/download`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) setDownload(documentUrl(data.url));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (unavailable(failure)) withdrawDenied();
      else setDownloadError(true);
    } finally {
      if (!controller.signal.aborted) setDownloading(false);
    }
  }
  async function getPreview() {
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreview(null);
    setPreviewing(true);
    setPreviewError(false);
    try {
      const data = await readDocument<{ url: string }>(
        `${documentBase(staff)}/${encodeURIComponent(id)}/preview`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) setPreview(documentUrl(data.url));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (unavailable(failure)) withdrawDenied();
      else setPreviewError(true);
    } finally {
      if (!controller.signal.aborted) setPreviewing(false);
    }
  }
  function choose(next: DocumentAction) {
    if (!document || needsRead || action || recordedState || !actions.includes(next)) return;
    if (reasonRequiredActions.has(next) && !reason.trim()) {
      setReasonMissing(true);
      reasonInput.current?.focus();
      return;
    }
    setReasonMissing(false);
    const path = `${documentBase(staff)}/${document.id}/${next}`;
    const note = reason.trim() || undefined;
    const pending = unconfirmed.current;
    if (pending?.path === path && pending.body.reason === note) {
      setAction(pending);
      return;
    }
    setAction({
      target: {
        id: document.id,
        profileId: document.profileId,
        revision: document.revision + 1,
        state: transitionState[next],
      },
      ...(['remove', 'quarantine', 'reject'].includes(next)
        ? { risk: 'destructive' as const }
        : {}),
      title: word(next),
      description: document.originalName,
      path,
      method: 'POST',
      body: {
        expectedRevision: document.revision,
        idempotencyKey: crypto.randomUUID(),
        ...(note ? { reason: note } : {}),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  function withdraw() {
    previewController.current?.abort();
    downloadController.current?.abort();
    setDocument(null);
    setPreview(null);
    setDownload(null);
    setAction(null);
    setDecisionPending(false);
  }
  function withdrawDenied() {
    withdraw();
    unconfirmed.current = null;
    setNeedsRead(false);
    setRecordedState(null);
    setReason('');
    setReasonMissing(false);
    setError('denied');
  }
  const readable =
    document &&
    !isQuarantinedDocument(document) &&
    document.permissions?.download !== false &&
    !['Uploading', 'PendingScan'].includes(document.state);
  const canPreview =
    readable &&
    document.state !== 'Removed' &&
    ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
      document.detectedMime ?? ''
    );
  const customerCanChange =
    document?.businessRecordType !== 'contract' || document.contractRole === 'signed';
  const canChange = document?.permissions?.write !== false && (staff || customerCanChange);
  const canChangeVersion = related?.kind !== 'contract' || allowReplacement;
  const actions: DocumentAction[] = [];
  if (document && canChange && !previewOnly) {
    if (canChangeVersion && document.state === 'Available') actions.push('submit');
    if (
      canChangeVersion &&
      staff &&
      (document.state === 'SubmittedForReview' ||
        (document.businessRecordType === 'solar_request' && document.state === 'Available'))
    )
      actions.push('approve', 'reject', 'request-changes');
    if (
      solarCustomer
        ? document.uploadedByType === 'customer' &&
          [
            'Uploading',
            'PendingScan',
            'Available',
            'SubmittedForReview',
            'Approved',
            'Rejected',
          ].includes(document.state)
        : savingPreSubmissionOnly
          ? document.uploadedByType === 'customer' &&
            ['Uploading', 'PendingScan', 'Available'].includes(document.state)
          : ['Uploading', 'PendingScan', 'Superseded', 'Quarantined'].includes(document.state)
    ) {
      if (canChangeVersion && document.permissions?.remove !== false) actions.push('remove');
    }
    if (staff && !['Removed', 'Quarantined'].includes(document.state)) actions.push('quarantine');
  }
  const showReasonHelp = actions.some((item) => reasonRequiredActions.has(item));
  useEffect(() => {
    if (inlineDecision && decision) choose(decision);
  }, [action, decision, document, inlineDecision, needsRead, recordedState]);
  const canReplace =
    document &&
    allowReplacement &&
    (related?.kind !== 'contract' ||
      (document.permissions?.replace === true &&
        isContractAttachmentRole(document.contractRole))) &&
    canReplaceDocument(document, staff, solarCustomer, savingPreSubmissionOnly);
  const predecessor = document?.supersedesDocumentId;
  const SectionHeading = recordPage ? 'h2' : 'h3';
  const title = holdPage
    ? word(holdPage === 'history' ? 'legalHolds' : holdPage === 'new' ? 'newHold' : 'releaseHold')
    : decision
      ? word(decision)
      : (document?.originalName ?? word('details'));
  const previewButton = canPreview && (
    <Button
      type="button"
      variant="outline"
      disabled={previewing || decisionPending}
      onClick={() => void getPreview()}
    >
      {word('preview')}
    </Button>
  );
  const previewContent = (
    <>
      {previewError && <p role="alert">{word('previewUnavailable')}</p>}
      {preview && document && (
        <FilePreview imageUrl={preview} name={document.originalName} locale={locale} />
      )}
    </>
  );
  const required = !!decision && reasonRequiredActions.has(decision);
  const decisionLabel = required ? word(`decisionLabel.${decision}`) : word('decisionNote');
  const decisionReasonField = (
    <Field className="gap-1.5" data-invalid={reasonMissing || undefined}>
      <FieldLabel htmlFor="document-review-reason">{decisionLabel}</FieldLabel>
      <Textarea
        id="document-review-reason"
        ref={reasonInput}
        rows={2}
        maxLength={1000}
        required={required}
        aria-required={required || undefined}
        aria-invalid={reasonMissing || undefined}
        aria-describedby={reasonMissing ? 'document-review-reason-error' : undefined}
        dir="auto"
        className="min-h-14 resize-y placeholder-shown:[direction:inherit]"
        placeholder={word(`decisionExample.${decision}`)}
        value={reason}
        disabled={!!action}
        onChange={(event) => {
          setReason(event.target.value);
          if (event.target.value.trim()) setReasonMissing(false);
        }}
      />
      {reasonMissing && (
        <p id="document-review-reason-error" role="alert" className="text-sm text-destructive">
          {word('reasonRequired')}
        </p>
      )}
    </Field>
  );
  const decisionContext = document && decision && (
    <div className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p dir="auto" className="wrap-anywhere font-semibold">
            {document.originalName}
          </p>
          <p className="text-xs text-muted-foreground">
            {word('reviewRevision').replace('{revision}', numbers.number(document.revision))}
          </p>
        </div>
        <DocumentStatusBadge state={document.state} locale={locale} />
      </div>
      <p className="text-muted-foreground">{word(`decisionEffect.${decision}`)}</p>
    </div>
  );
  return (
    <section
      className={
        holdPage || decision
          ? 'min-w-0 space-y-3'
          : 'flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5'
      }
      aria-label={word('details')}
    >
      {recordPage && (
        <RecordCommandGuard
          blocked={() => needsRead || (inlineDecision ? decisionPending : !!action)}
        />
      )}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {recordPage ? (
            <h1
              ref={recordHeading}
              tabIndex={-1}
              className="min-w-0 text-xl font-semibold [overflow-wrap:anywhere] focus-visible:shadow-none! focus-visible:outline-hidden! sm:text-2xl"
              dir="auto"
            >
              {title}
            </h1>
          ) : (
            <h2 className="break-words text-xl font-semibold">{title}</h2>
          )}
          {holdPage && document && (
            <p dir="auto" className="wrap-anywhere text-sm text-muted-foreground">
              {document.originalName}
            </p>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" onClick={onClose}>
            {word('close')}
          </Button>
        )}
      </header>
      {needsRead ? (
        <Alert variant="destructive">
          <AlertDescription>{confirmationText('unconfirmed', locale)}</AlertDescription>
          <Button
            variant="outline"
            onClick={() => {
              setNeedsRead(false);
              setReload((value) => value + 1);
            }}
          >
            {confirmationText('checkStatus', locale)}
          </Button>
        </Alert>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{word(error === 'denied' ? 'denied' : 'error')}</AlertDescription>
          {error === 'retry' && (
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              {word('refresh')}
            </Button>
          )}
        </Alert>
      ) : !document ? (
        <PageLoading label={word('loading')} />
      ) : holdPage && staff && recordSearch ? (
        <DocumentLegalHolds
          document={document}
          heading="h2"
          location={{ page: holdPage, search: recordSearch }}
        />
      ) : decision ? (
        recordedState ? (
          <div role="status" className="space-y-2 rounded-xl border bg-card p-4">
            <p className="font-medium">{confirmationText('recorded', locale)}</p>
            <p dir="auto" className="wrap-anywhere text-sm">
              {document.originalName}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <DocumentStatusBadge state={recordedState} locale={locale} />
              {recordPage && (
                <Link
                  {...(related
                    ? relatedDocumentListLocation(related)
                    : { to: staff ? '/admin/documents' : '/documents', search: recordSearch })}
                  className="touch-action inline-flex items-center text-sm text-primary underline"
                >
                  {word('backToDocuments')}
                </Link>
              )}
            </div>
          </div>
        ) : !actions.includes(decision) ? (
          <Alert variant="destructive">
            <AlertDescription>{word('decisionUnavailable')}</AlertDescription>
          </Alert>
        ) : inlineDecision ? (
          action ? null : (
            <PageLoading label={word('loading')} />
          )
        ) : (
          <form
            aria-label={word('reviewDecision')}
            className={recordEditorSurface}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              choose(decision);
            }}
          >
            <div className="space-y-4 p-4 sm:p-5">
              {decisionContext}
              {previewButton}
              {previewContent}
              {related && !required ? (
                <details
                  open={reason.trim() ? true : undefined}
                  className="rounded-lg border border-input px-3 open:pb-3"
                >
                  <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium text-primary">
                    {word(reason.trim() ? 'decisionNote' : 'addDecisionNote')}
                  </summary>
                  {decisionReasonField}
                </details>
              ) : (
                decisionReasonField
              )}
            </div>
            <RecordEditorActions>
              <Button
                type="submit"
                variant={
                  ['quarantine', 'reject', 'remove'].includes(decision) ? 'destructive' : 'default'
                }
                disabled={!!action}
              >
                {word('reviewDecisionAction')}
              </Button>
            </RecordEditorActions>
          </form>
        )
      ) : (
        <>
          {time.notice}
          <DocumentStatusBadge
            state={document.state}
            locale={locale}
            reason={isQuarantinedDocument(document) ? null : document.rejectionReason}
          />
          {recordSearch &&
            document.state === 'Rejected' &&
            document.rejectionReason &&
            !isQuarantinedDocument(document) && (
              <div className="space-y-1 rounded-lg border p-4">
                <h2 className="font-semibold">{word('correctionRequired')}</h2>
                <p dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {document.rejectionReason}
                </p>
              </div>
            )}
          {!staff && document.state === 'SubmittedForReview' && (
            <WaitingForBarghsa
              title={workflowFeedback('waiting', locale)}
              description={word(document.state)}
              submittedAt={(() => {
                const event = document.history
                  .filter((row) => row.state === 'SubmittedForReview')
                  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
                return event
                  ? `${workflowFeedback('submitted', locale)}: ${time.format(event.createdAt)}`
                  : workflowFeedback('submissionUnknown', locale);
              })()}
              expectedResponse={workflowFeedback('responseUnknown', locale)}
              help={
                <Link to="/tickets" className="touch-action underline">
                  {feedbackText('support', locale)}
                </Link>
              }
            />
          )}
          <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/25 p-3 text-sm lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{word('kind')}</dt>
              <dd>{word(document.businessRecordType)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('size')}</dt>
              <dd>{numbers.number(document.sizeBytes)} B</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('uploadedBy')}</dt>
              <dd>{word(document.uploadedByType)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('created')}</dt>
              <dd>{time.format(document.createdAt)}</dd>
            </div>
            {document.checksum ? (
              <div className="col-span-full">
                <dt className="text-muted-foreground">{word('checksum')}</dt>
                <dd className="break-all" dir="ltr">
                  {document.checksum}
                </dd>
              </div>
            ) : null}
          </dl>
          {isQuarantinedDocument(document) ? (
            <p className="text-sm text-muted-foreground">{word('quarantinedNotice')}</p>
          ) : (document.rejectionReason || document.reviewComment) &&
            !(recordSearch && document.state === 'Rejected' && document.rejectionReason) ? (
            <Alert>
              <AlertDescription>
                {document.rejectionReason ?? document.reviewComment}
              </AlertDescription>
            </Alert>
          ) : null}
          {document.businessRecordType === 'contract' ? (
            <p className="text-sm text-muted-foreground">{word('signedNotice')}</p>
          ) : null}
          {document.state === 'Removed' ? (
            <p className="text-sm text-muted-foreground">{word('removedNotice')}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {previewButton}
            {readable ? (
              <Button variant="outline" disabled={downloading} onClick={() => void getDownload()}>
                {word('download')}
              </Button>
            ) : null}
            {predecessor &&
              (related && staffOrderId(predecessor) ? (
                <Link
                  {...relatedDocumentLocation(related, predecessor)}
                  className="touch-action text-primary underline"
                >
                  {word('predecessor')}
                </Link>
              ) : recordSearch && staffOrderId(predecessor) ? (
                <Link
                  className="touch-action text-primary underline"
                  to={
                    staff
                      ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                      : '/documents/$documentId/{-$operation}'
                  }
                  params={{ documentId: predecessor, operation: undefined }}
                  search={recordSearch}
                >
                  {word('predecessor')}
                </Link>
              ) : (
                onPrevious && (
                  <Button variant="outline" onClick={() => onPrevious(predecessor)}>
                    {word('predecessor')}
                  </Button>
                )
              ))}
            {canReplace &&
              (related ? (
                <Link
                  {...relatedDocumentLocation(related, document.id, 'replace')}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  {word('replace')}
                </Link>
              ) : recordSearch ? (
                <Link
                  className="touch-action text-primary underline"
                  to={
                    staff
                      ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                      : '/documents/$documentId/{-$operation}'
                  }
                  params={{
                    documentId: document.id,
                    section: staff ? 'replace' : undefined,
                    operation: staff ? undefined : 'replace',
                  }}
                  search={recordSearch}
                >
                  {word('replace')}
                </Link>
              ) : (
                onReplace && (
                  <Button variant="outline" onClick={() => onReplace(document)}>
                    {word('replace')}
                  </Button>
                )
              ))}
          </div>
          {downloadError ? <p role="alert">{word('error')}</p> : null}
          {previewContent}
          {download ? (
            <div className="flex flex-col gap-3">
              <a
                href={download}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="text-primary underline"
              >
                {word('openFile')}
              </a>
            </div>
          ) : null}
          {actions.length > 0 && recordPage ? (
            <section className="space-y-2" aria-label={word('reviewDecision')}>
              <h2 className="text-base font-semibold">{word('reviewDecision')}</h2>
              <div className="flex flex-wrap gap-2">
                {actions.map((item) => (
                  <Link
                    key={item}
                    {...(related
                      ? relatedDocumentLocation(related, document.id, item)
                      : {
                          to: staff
                            ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                            : '/documents/$documentId/{-$operation}',
                          params: {
                            documentId: document.id,
                            section: 'decisions',
                            action: item,
                            holdId: undefined,
                            operation: staff ? undefined : item,
                          },
                          search: recordSearch,
                        })}
                    className={buttonVariants({
                      variant: item === 'approve' || item === 'submit' ? 'default' : 'outline',
                    })}
                  >
                    {word(item)}
                  </Link>
                ))}
              </div>
            </section>
          ) : actions.length > 0 ? (
            <section
              className={staff ? 'rounded-xl border bg-card' : undefined}
              aria-label={staff ? word('reviewDecision') : undefined}
            >
              {staff && (
                <div className="space-y-2.5 px-3 py-3 sm:px-4">
                  <SectionHeading className="text-base font-semibold">
                    {word('reviewDecision')}
                  </SectionHeading>
                  <Field className="max-w-prose gap-1.5" data-invalid={reasonMissing || undefined}>
                    <FieldLabel htmlFor="document-review-reason">{word('reason')}</FieldLabel>
                    <Textarea
                      id="document-review-reason"
                      ref={reasonInput}
                      maxLength={1000}
                      rows={2}
                      dir="auto"
                      className="min-h-14 resize-y"
                      placeholder={word('reviewExample')}
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value);
                        if (event.target.value.trim()) setReasonMissing(false);
                      }}
                      aria-invalid={reasonMissing}
                      aria-required={reasonMissing || undefined}
                      aria-describedby={
                        reasonMissing
                          ? 'document-review-reason-help document-review-reason-error'
                          : showReasonHelp
                            ? 'document-review-reason-help'
                            : undefined
                      }
                    />
                    {showReasonHelp && (
                      <p id="document-review-reason-help" className="text-sm text-muted-foreground">
                        {word('reviewReasonHelp')}
                      </p>
                    )}
                    {reasonMissing ? (
                      <p
                        id="document-review-reason-error"
                        role="alert"
                        className="text-sm text-destructive"
                      >
                        {word('reasonRequired')}
                      </p>
                    ) : null}
                  </Field>
                </div>
              )}
              <div
                className={
                  staff
                    ? 'flex flex-wrap justify-end gap-2 border-t bg-muted/35 px-3 py-2.5 sm:px-4'
                    : 'flex flex-wrap gap-2'
                }
              >
                {actions.map((item) => (
                  <Button
                    key={item}
                    variant={
                      item === 'approve' || (item === 'submit' && !actions.includes('approve'))
                        ? 'default'
                        : item === 'quarantine'
                          ? 'ghost'
                          : 'outline'
                    }
                    className={item === 'quarantine' ? 'text-destructive' : undefined}
                    onClick={() => choose(item)}
                  >
                    {word(item)}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
          {staff && showRetention ? (
            <DocumentLegalHolds
              document={document}
              heading={SectionHeading}
              location={recordSearch && { page: 'summary', search: recordSearch }}
            />
          ) : null}
          <SectionHeading className="font-semibold">{word('history')}</SectionHeading>
          <Timeline
            label={word('history')}
            items={document.history.map((event) => ({
              id: event.id,
              title: word(event.state),
              ...(event.reason && (staff || event.state !== 'Quarantined')
                ? { description: event.reason }
                : {}),
              dateTime: event.createdAt,
              dateLabel: time.format(event.createdAt),
            }))}
          />
        </>
      )}
      {action ? (
        <div className={inlineDecision ? `${recordEditorSurface} p-4 sm:p-5` : undefined}>
          <TeamActionDialog
            action={action}
            {...(inlineDecision && decision
              ? { inlineConfirmLabel: word(decision), onPendingChange: setDecisionPending }
              : {})}
            summary={
              inlineDecision ? (
                <>
                  {decisionContext}
                  {previewButton}
                  {previewContent}
                </>
              ) : (
                decision && (
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">{word('decisionNextStatus')}</dt>
                      <dd>{word(action.target.state)}</dd>
                    </div>
                    {action.body.reason && (
                      <div>
                        <dt className="text-muted-foreground">{decisionLabel}</dt>
                        <dd dir="auto" className="wrap-anywhere whitespace-pre-wrap">
                          {action.body.reason}
                        </dd>
                      </div>
                    )}
                  </dl>
                )
              )
            }
            onClose={() => setAction(null)}
            onDenied={withdrawDenied}
            onUnconfirmed={() => {
              withdraw();
              unconfirmed.current = action;
              setNeedsRead(true);
            }}
            onSuccess={async (result) => {
              const receipt = result as Partial<BusinessDocument> | null;
              const target = action.target;
              if (
                !receipt ||
                receipt.id !== target.id ||
                receipt.profileId !== target.profileId ||
                receipt.revision !== target.revision ||
                receipt.state !== target.state ||
                (related && !relatedDocumentMatches(receipt, related))
              )
                throw new Error('Document transition receipt mismatch');
              setAction(null);
              unconfirmed.current = null;
              setReason('');
              if (decision) setRecordedState(target.state);
              setDecisionPending(false);
              if (!inlineDecision && !(related && decision)) setReload((value) => value + 1);
              onChanged?.();
              return confirmationText('recorded', locale);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
