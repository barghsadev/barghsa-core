import { useEffect, useState } from 'react';
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
}: {
  id: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
  onReplace: (document: BusinessDocument) => void;
  onPrevious: (id: string) => void;
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
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setDocument(null);
    setDownload(null);
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
    return () => controller.abort();
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
    if (staff && document.state === 'SubmittedForReview')
      actions.push('approve', 'reject', 'request-changes');
    if (['Uploading', 'PendingScan', 'Superseded', 'Quarantined'].includes(document.state))
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
            {canChange && ['Available', 'Approved', 'Rejected'].includes(document.state) ? (
              <Button variant="outline" onClick={() => onReplace(document)}>
                {word('replace')}
              </Button>
            ) : null}
          </div>
          {downloadError ? <p role="alert">{word('error')}</p> : null}
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
