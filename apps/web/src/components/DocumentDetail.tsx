import { validDocumentDetail } from '../lib/document-records.js';
import { feedbackText } from '@barghsa/i18n/feedback';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
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
import { DocumentLegalHolds } from './DocumentLegalHolds.js';
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
      key={JSON.stringify([actor, revision, props.id, props.profileId, props.staff])}
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
  allowReplacement = true,
  showRetention = false,
}: {
  id: string;
  profileId?: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
  onReplace: (document: BusinessDocument) => void;
  onPrevious: (id: string) => void;
  savingPreSubmissionOnly?: boolean;
  solarCustomer?: boolean;
  allowReplacement?: boolean;
  showRetention?: boolean;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    staff,
    profileId,
    JSON.stringify([id, staff])
  );
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const numbers = useNumberFormatting(locale);
  const [document, setDocument] = useState<Detail | null>(null);
  const [error, setError] = useState<'retry' | 'denied' | null>(null);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [action, setAction] = useState<Transition | null>(null);
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
    if (!document || needsRead || action) return;
    if (reasonRequiredActions.has(next) && !reason.trim()) {
      setReasonMissing(true);
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
  }
  function withdrawDenied() {
    withdraw();
    unconfirmed.current = null;
    setNeedsRead(false);
    setReason('');
    setReasonMissing(false);
    setError('denied');
  }
  const readable =
    document &&
    !isQuarantinedDocument(document) &&
    document.permissions?.download !== false &&
    !['Uploading', 'PendingScan'].includes(document.state);
  const customerCanChange =
    document?.businessRecordType !== 'contract' || document.contractRole === 'signed';
  const canChange = document?.permissions?.write !== false && (staff || customerCanChange);
  const actions: DocumentAction[] = [];
  if (document && canChange) {
    if (document.state === 'Available') actions.push('submit');
    if (
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
      if (document.permissions?.remove !== false) actions.push('remove');
    }
    if (staff && !['Removed', 'Quarantined'].includes(document.state)) actions.push('quarantine');
  }
  const showReasonHelp = actions.some((item) => reasonRequiredActions.has(item));
  return (
    <section
      className="flex flex-col gap-5 rounded-xl border bg-card p-5"
      aria-label={word('details')}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="break-words text-xl font-semibold">
          {document?.originalName ?? word('details')}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {word('close')}
        </Button>
      </div>
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
      ) : (
        <>
          {time.notice}
          <DocumentStatusBadge
            state={document.state}
            locale={locale}
            reason={isQuarantinedDocument(document) ? null : document.rejectionReason}
          />
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
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
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
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{word('checksum')}</dt>
                <dd className="break-all" dir="ltr">
                  {document.checksum}
                </dd>
              </div>
            ) : null}
          </dl>
          {isQuarantinedDocument(document) ? (
            <p className="text-sm text-muted-foreground">{word('quarantinedNotice')}</p>
          ) : document.rejectionReason || document.reviewComment ? (
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
          {staff && showRetention ? <DocumentLegalHolds document={document} /> : null}
          <div className="flex flex-wrap gap-2">
            {readable &&
            document.state !== 'Removed' &&
            ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(
              document.detectedMime ?? ''
            ) ? (
              <Button variant="outline" disabled={previewing} onClick={() => void getPreview()}>
                {word('preview')}
              </Button>
            ) : null}
            {readable ? (
              <Button variant="outline" disabled={downloading} onClick={() => void getDownload()}>
                {word('download')}
              </Button>
            ) : null}
            {document.supersedesDocumentId ? (
              <Button variant="outline" onClick={() => onPrevious(document.supersedesDocumentId!)}>
                {word('predecessor')}
              </Button>
            ) : null}
            {allowReplacement &&
            document.permissions?.replace !== false &&
            canChange &&
            (solarCustomer
              ? document.uploadedByType === 'customer' &&
                ['Available', 'SubmittedForReview', 'Approved', 'Rejected'].includes(document.state)
              : savingPreSubmissionOnly
                ? document.state === 'Available' && document.uploadedByType === 'customer'
                : ['Available', 'Approved', 'Rejected'].includes(document.state) ||
                  (staff &&
                    document.state === 'Quarantined' &&
                    document.businessRecordType === 'contract' &&
                    document.contractRole === 'original')) ? (
              <Button variant="outline" onClick={() => onReplace(document)}>
                {word('replace')}
              </Button>
            ) : null}
          </div>
          {downloadError ? <p role="alert">{word('error')}</p> : null}
          {previewError ? <p role="alert">{word('previewUnavailable')}</p> : null}
          {preview ? (
            <FilePreview imageUrl={preview} name={document.originalName} locale={locale} />
          ) : null}
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
          {staff && actions.length ? (
            <Field data-invalid={reasonMissing || undefined}>
              <FieldLabel htmlFor="document-review-reason">{word('reason')}</FieldLabel>
              <Textarea
                id="document-review-reason"
                maxLength={1000}
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
                <p id="document-review-reason-error" role="alert">
                  {word('reasonRequired')}
                </p>
              ) : null}
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.map((item) => (
              <Button
                key={item}
                variant={item === 'submit' || item === 'approve' ? 'default' : 'outline'}
                onClick={() => choose(item)}
              >
                {word(item)}
              </Button>
            ))}
          </div>
          <h3 className="font-semibold">{word('history')}</h3>
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
        <TeamActionDialog
          action={action}
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
              receipt.state !== target.state
            )
              throw new Error('Document transition receipt mismatch');
            setAction(null);
            unconfirmed.current = null;
            setReason('');
            setReload((value) => value + 1);
            onChanged();
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
