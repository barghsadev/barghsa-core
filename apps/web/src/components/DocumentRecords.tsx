import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, type ListView } from '@barghsa/ui';
import { FileImage, FileText, FileVideo } from 'lucide-react';
import { documentText } from '@barghsa/i18n/documents';
import type { Locale } from '@barghsa/i18n/app';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import {
  documentBase,
  isQuarantinedDocument,
  DocumentRequestError,
  documentUrl,
  type BusinessDocument,
} from '../lib/documents.js';
import { DocumentStatusBadge } from './DocumentStatusBadge.js';
import { FilePreview } from './FilePreview.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { HistoryTable, type HistoryColumn } from './HistoryTable.js';

const readable = new Set(['Available', 'SubmittedForReview', 'Approved', 'Rejected', 'Superseded']);
const previewMime = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
type FileAccess = 'preview' | 'download';
type Receipt = {
  url?: string;
  expiresAt?: number;
  pending?: boolean;
  error?: boolean;
  denied?: boolean;
  visible?: boolean;
};
type Entry = Partial<Record<FileAccess, Receipt>>;
const identity = (item: BusinessDocument) =>
  JSON.stringify([
    item.id,
    item.revision,
    item.state,
    item.scanState,
    item.detectedMime,
    item.updatedAt,
    item.permissions,
  ]);

/** File access is lazy and stays bound to the accepted document revision in either layout. */
export function DocumentList(props: Parameters<typeof OwnedDocumentList>[0]) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedDocumentList key={JSON.stringify([actor, revision, props.staff])} {...props} />;
}
function OwnedDocumentList({
  items,
  staff,
  locale,
  view,
  selectedId,
  onSelect,
  formatDate,
  onReplace,
  onChanged,
  onDenied,
}: {
  items: readonly BusinessDocument[];
  staff: boolean;
  locale: Locale;
  view: ListView;
  selectedId: string | null;
  onSelect: (id: string) => void;
  formatDate: (value: string) => string;
  onReplace?: (document: BusinessDocument) => void;
  onChanged?: (documentId: string) => void;
  onDenied?: () => void;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readDocument = useOwnedDocumentRead(
    actor,
    revision,
    staff,
    undefined,
    'document-record-links'
  );
  const word = (key: string) => documentText(key, locale),
    numbers = useNumberFormatting(locale);
  const rows = items.filter((item) => staff || item.state !== 'Removed');
  const [removal, setRemoval] = useState<{
    key: string;
    documentId: string;
    action: TeamAction;
  } | null>(null);
  const activeRemoval =
    removal &&
    rows.some((item) => identity(item) === removal.key && item.permissions?.remove === true)
      ? removal
      : null;
  const [receipts, setReceipts] = useState<Record<string, Entry>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const alive = useRef(false);
  const keys = useRef(new Set<string>());
  keys.current = new Set(rows.map(identity));
  const basis = JSON.stringify([...keys.current]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const abort of controllers.current.values()) abort.abort();
      controllers.current.clear();
    };
  }, []);
  useEffect(() => {
    const valid = keys.current;
    for (const [operation, abort] of controllers.current)
      if (!valid.has(operation.slice(0, operation.lastIndexOf(':')))) {
        abort.abort();
        controllers.current.delete(operation);
      }
    setRemoval((current) => (current && !valid.has(current.key) ? null : current));
    setReceipts((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => valid.has(key)))
    );
  }, [basis]);
  async function access(item: BusinessDocument, type: FileAccess) {
    const key = identity(item),
      operation = `${key}:${type}`;
    if (controllers.current.has(operation)) return;
    const cached = receipts[key]?.[type];
    if (cached?.url && (cached.expiresAt ?? 0) > Date.now()) {
      setReceipts((previous) => ({
        ...previous,
        [key]: { ...previous[key], [type]: { ...cached, visible: !cached.visible } },
      }));
      return;
    }
    const abort = new AbortController();
    controllers.current.set(operation, abort);
    setReceipts((previous) => ({
      ...previous,
      [key]: { ...previous[key], [type]: { pending: true } },
    }));
    const current = () => alive.current && !abort.signal.aborted && keys.current.has(key);
    try {
      const result = await readDocument<{ url: string; expiresIn?: number }>(
        `${documentBase(staff)}/${encodeURIComponent(item.id)}/${type}`,
        { signal: abort.signal }
      );
      const url = documentUrl(result.url);
      if (current())
        setReceipts((previous) => ({
          ...previous,
          [key]: {
            ...previous[key],
            [type]: {
              url,
              expiresAt:
                Date.now() +
                Math.min(
                  300,
                  typeof result.expiresIn === 'number' &&
                    Number.isFinite(result.expiresIn) &&
                    result.expiresIn > 0
                    ? result.expiresIn
                    : 300
                ) *
                  1000,
              visible: true,
            },
          },
        }));
    } catch (error) {
      if (current()) {
        const denied =
          error instanceof DocumentRequestError && [401, 403, 404, 409].includes(error.status);
        const accountDenied =
          error instanceof DocumentRequestError && [401, 403].includes(error.status);
        if (accountDenied) onDenied?.();
        if (denied) {
          for (const [siblingOperation, controller] of controllers.current) {
            if ((accountDenied || siblingOperation.startsWith(`${key}:`)) && controller !== abort) {
              controller.abort();
              controllers.current.delete(siblingOperation);
            }
          }
        }
        setReceipts((previous) => ({
          ...(accountDenied ? {} : previous),
          [key]: denied
            ? { preview: { error: true, denied: true }, download: { error: true, denied: true } }
            : { ...previous[key], [type]: { error: true } },
        }));
      }
    } finally {
      if (controllers.current.get(operation) === abort) controllers.current.delete(operation);
    }
  }
  function size(item: BusinessDocument) {
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0)
      return word('metadataUnavailable');
    const unit =
      item.sizeBytes >= 1048576 ? 'sizeMb' : item.sizeBytes >= 1024 ? 'sizeKb' : 'sizeBytes';
    const divisor = unit === 'sizeMb' ? 1048576 : unit === 'sizeKb' ? 1024 : 1;
    const digits = numbers.number(item.sizeBytes / divisor, {
      maximumFractionDigits: unit === 'sizeBytes' ? 0 : 1,
    });
    return `${digits} ${word(unit)}`;
  }
  function status(item: BusinessDocument) {
    return (
      <div className="space-y-2">
        <DocumentStatusBadge
          state={item.state}
          locale={locale}
          reason={isQuarantinedDocument(item) ? null : item.rejectionReason}
        />
        {isQuarantinedDocument(item) ? (
          <p className="max-w-sm text-sm text-muted-foreground">{word('quarantinedNotice')}</p>
        ) : item.state === 'Rejected' && item.rejectionReason ? (
          <p className="max-w-sm whitespace-pre-wrap break-words text-sm text-destructive">
            {item.rejectionReason}
          </p>
        ) : null}
      </div>
    );
  }
  function name(item: BusinessDocument) {
    const Icon =
      item.category === 'image' ? FileImage : item.category === 'video' ? FileVideo : FileText;
    return (
      <div className="flex min-w-0 items-start gap-2">
        <Icon aria-hidden="true" className="mt-3 size-4 shrink-0 text-muted-foreground" />
        <Button
          variant="link"
          className="min-w-0 justify-start whitespace-normal break-all text-start"
          aria-pressed={selectedId === item.id}
          onClick={() => onSelect(item.id)}
        >
          <bdi>{item.originalName}</bdi>
        </Button>
      </div>
    );
  }
  function files(item: BusinessDocument) {
    const canRead =
      !isQuarantinedDocument(item) &&
      (readable.has(item.state) || (staff && item.state === 'Removed'));
    const canPreview =
      !isQuarantinedDocument(item) &&
      readable.has(item.state) &&
      item.permissions?.download !== false &&
      previewMime.has(item.detectedMime ?? '');
    const canDownload = canRead && item.permissions?.download !== false;
    const canRemove = item.permissions?.remove === true && !!onChanged;
    const canReplace = item.permissions?.replace === true && !!onReplace;
    if (!canDownload && !canRemove && !canReplace) return null;
    const key = identity(item),
      entry = receipts[key] ?? {};
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {canPreview && (
            <Button
              variant="outline"
              disabled={entry.preview?.pending}
              onClick={() => void access(item, 'preview')}
            >
              {word(
                entry.preview?.pending
                  ? 'previewLoading'
                  : entry.preview?.visible
                    ? 'hidePreview'
                    : 'preview'
              )}
            </Button>
          )}
          {canDownload && (
            <Button
              variant="outline"
              disabled={entry.download?.pending}
              onClick={() => void access(item, 'download')}
            >
              {word(entry.download?.pending ? 'downloadLoading' : 'download')}
            </Button>
          )}
          {canReplace && (
            <Button variant="outline" onClick={() => onReplace?.(item)}>
              {word('replace')}
            </Button>
          )}
          {canRemove && (
            <Button
              variant="outline"
              onClick={() =>
                setRemoval({
                  key,
                  documentId: item.id,
                  action: {
                    title: word('remove'),
                    description: item.originalName,
                    path: `${documentBase(staff)}/${encodeURIComponent(item.id)}/remove`,
                    method: 'POST',
                    body: { expectedRevision: item.revision, idempotencyKey: crypto.randomUUID() },
                    conflictMessage: word('conflict'),
                    forbiddenMessage: word('denied'),
                  },
                })
              }
            >
              {word('remove')}
            </Button>
          )}
        </div>
        {(entry.preview?.error || entry.download?.error) && (
          <p role="alert" className="max-w-sm text-sm text-destructive">
            {word(
              entry.preview?.denied || entry.download?.denied
                ? 'fileUnavailable'
                : 'fileAccessError'
            )}
          </p>
        )}
        {canPreview && entry.preview?.url && entry.preview.visible && (
          <FilePreview
            imageUrl={entry.preview.url}
            name={item.originalName}
            locale={locale}
            onError={() => {
              if (!alive.current || !keys.current.has(key)) return;
              setReceipts((previous) => ({
                ...previous,
                [key]: { ...previous[key], preview: { error: true } },
              }));
            }}
          />
        )}
        {canDownload && entry.download?.url && entry.download.visible && (
          <a
            href={entry.download.url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            className="w-fit text-primary underline"
          >
            {word('openFile')}
          </a>
        )}
      </div>
    );
  }
  const columns: HistoryColumn<BusinessDocument>[] = [
    { id: 'file', label: word('file'), render: name },
    { id: 'status', label: word('state'), render: status },
    {
      id: 'size',
      label: word('size'),
      render: (item) => <span className="whitespace-nowrap">{size(item)}</span>,
    },
    {
      id: 'uploaded',
      label: word('created'),
      render: (item) => (
        <time dateTime={Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined}>
          {formatDate(item.createdAt)}
        </time>
      ),
    },
    {
      id: 'source',
      label: word('uploadedBy'),
      render: (item) => (
        <>
          {word(item.uploadedByType)} · {word(item.category)}
          <span className="block text-muted-foreground">{word(item.businessRecordType)}</span>
        </>
      ),
    },
    { id: 'actions', label: word('fileActions'), render: files },
  ];
  return (
    <div data-slot="document-records" data-view={view} className="min-w-0">
      {view === 'table' ? (
        <HistoryTable
          caption={word('listTitle')}
          items={rows}
          columns={columns}
          rowKey={(item) => item.id}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((item) => (
            <li key={item.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{name(item)}</CardTitle>
                  {status(item)}
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <dl className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">{word('size')}</dt>
                      <dd>{size(item)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{word('created')}</dt>
                      <dd>
                        <time
                          dateTime={
                            Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined
                          }
                        >
                          {formatDate(item.createdAt)}
                        </time>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{word('uploadedBy')}</dt>
                      <dd>{word(item.uploadedByType)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{word('kind')}</dt>
                      <dd>
                        {word(item.businessRecordType)} · {word(item.category)}
                      </dd>
                    </div>
                  </dl>
                  {files(item)}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {activeRemoval && (
        <TeamActionDialog
          action={activeRemoval.action}
          onClose={() => setRemoval(null)}
          onDenied={() => {
            setRemoval(null);
            for (const controller of controllers.current.values()) controller.abort();
            controllers.current.clear();
            setReceipts({});
            onDenied?.();
          }}
          onSuccess={async () => {
            if (!alive.current || !keys.current.has(activeRemoval.key)) return;
            for (const [operation, controller] of controllers.current)
              if (operation.startsWith(`${activeRemoval.key}:`)) {
                controller.abort();
                controllers.current.delete(operation);
              }
            setRemoval(null);
            setReceipts({});
            onChanged?.(activeRemoval.documentId);
          }}
        />
      )}
    </div>
  );
}

export { DocumentList as DocumentRecords };
