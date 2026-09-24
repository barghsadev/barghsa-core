import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  PageLoading,
  StatusBadge,
  Textarea,
  Timeline,
} from '@barghsa/ui';
import { documentText } from '@barghsa/i18n/documents';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import {
  documentBase,
  documentRequest,
  documentUrl,
  type BusinessDocument,
  type DocumentAction,
  type DocumentDetail as Detail,
} from '../lib/documents.js';

export function DocumentDetail({
  id,
  staff,
  onClose,
  onChanged,
  onReplace,
  onPrevious,
  savingPreSubmissionOnly = false,
  solarCustomer = false,
  allowReplacement = true,
}: {
  id: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
  onReplace: (document: BusinessDocument) => void;
  onPrevious: (id: string) => void;
  savingPreSubmissionOnly?: boolean;
  solarCustomer?: boolean;
  allowReplacement?: boolean;
}) {
  const locale = useLocale();
  const word = (key: string) => documentText(key, locale);
  const time = useAccountTime();
  const numbers = useNumberFormatting(locale);
  const [document, setDocument] = useState<Detail | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const previewController = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    previewController.current?.abort();
    setDocument(null);
    setDownload(null);
    setPreview(null);
    setPreviewing(false);
    setPreviewError(false);
    setError(false);
    void documentRequest<Detail>(`${documentBase(staff)}/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setDocument(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
      previewController.current?.abort();
    };
  }, [id, staff, reload]);

  async function getDownload() {
    setDownloading(true);
    setDownloadError(false);
    try {
      const data = await documentRequest<{ url: string }>(
        `${documentBase(staff)}/${encodeURIComponent(id)}/download`
      );
      setDownload(documentUrl(data.url));
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }
  async function getPreview() {
    const controller = new AbortController();
    previewController.current = controller;
    setPreviewing(true);
    setPreviewError(false);
    try {
      const data = await documentRequest<{ url: string }>(
        `${documentBase(staff)}/${encodeURIComponent(id)}/preview`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) setPreview(documentUrl(data.url));
    } catch {
      if (!controller.signal.aborted) setPreviewError(true);
    } finally {
      if (!controller.signal.aborted) setPreviewing(false);
    }
  }
  function choose(next: DocumentAction) {
    if (!document) return;
    if (['reject', 'request-changes', 'quarantine'].includes(next) && !reason.trim()) {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    setAction({
      title: word(next),
      description: document.originalName,
      path: `${documentBase(staff)}/${document.id}/${next}`,
      method: 'POST',
      body: {
        expectedRevision: document.revision,
        idempotencyKey: crypto.randomUUID(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const readable =
    document && !['Uploading', 'PendingScan', 'Quarantined'].includes(document.state);
  const customerCanChange =
    document?.businessRecordType !== 'contract' || document.contractRole === 'signed';
  const canChange = staff || customerCanChange;
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
    )
      actions.push('remove');
    if (staff && !['Removed', 'Quarantined'].includes(document.state)) actions.push('quarantine');
  }
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
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('denied')}</AlertDescription>
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : !document ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {time.notice}
          <StatusBadge label={word(document.state)} />
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
          {document.rejectionReason || document.reviewComment ? (
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
            <img
              src={preview}
              alt={document.originalName}
              referrerPolicy="no-referrer"
              className="max-h-[32rem] max-w-full object-contain"
            />
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
              {document.detectedMime &&
              ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
                document.detectedMime
              ) ? (
                <img
                  src={download}
                  alt={document.originalName}
                  referrerPolicy="no-referrer"
                  className="max-h-[32rem] max-w-full object-contain"
                />
              ) : document.detectedMime === 'application/pdf' ? (
                <iframe
                  src={download}
                  title={word('preview')}
                  referrerPolicy="no-referrer"
                  className="h-[32rem] w-full rounded-lg border"
                />
              ) : (
                <p>{word('previewUnavailable')}</p>
              )}
            </div>
          ) : null}
          {staff && actions.length ? (
            <Field data-invalid={reasonMissing || undefined}>
              <FieldLabel htmlFor="document-review-reason">{word('reason')}</FieldLabel>
              <Textarea
                id="document-review-reason"
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={reasonMissing}
              />
              {reasonMissing ? <p role="alert">{word('reasonRequired')}</p> : null}
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
              ...(event.reason ? { description: event.reason } : {}),
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
          onSuccess={async () => {
            setAction(null);
            setReason('');
            setReload((value) => value + 1);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
