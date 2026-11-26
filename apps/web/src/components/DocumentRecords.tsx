import {
  Download as TableDownloadIcon,
  ExternalLink as TableExternalLinkIcon,
  Eye as TableEyeIcon,
  EyeOff as TableEyeOffIcon,
  FileUp as TableFileUpIcon,
  RotateCw as TableRotateCwIcon,
  Trash2 as TableTrash2Icon,
} from 'lucide-react';
import { TableActionIcon } from './TableActionIcon.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedDocumentRead } from '../hooks/useOwnedDocumentRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  buttonVariants,
  type ListView,
} from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import { canReplaceDocument } from '../lib/document-records.js';
import { isContractAttachmentRole } from '../lib/contract-attachments.js';
import {
  relatedDocumentLocation,
  type RelatedDocumentLinks,
} from '../lib/related-document-route.js';
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
const documentGroups = ['actionGroup', 'reviewGroup', 'Approved', 'otherGroup'] as const;
function documentGroup({ state }: BusinessDocument): (typeof documentGroups)[number] {
  if (state === 'Available' || state === 'Rejected') return 'actionGroup';
  if (state === 'PendingScan' || state === 'SubmittedForReview') return 'reviewGroup';
  return state === 'Approved' ? 'Approved' : 'otherGroup';
}
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
type Removal = {
  key: string;
  documentId: string;
  profileId: string;
  revision: number;
  state: BusinessDocument['state'];
  action: TeamAction;
};
type RemovalRecovery = { removal: Removal; checked: boolean; failed: boolean };
const identity = (item: BusinessDocument) =>
  JSON.stringify([
    item.id,
    item.profileId,
    item.revision,
    item.state,
    item.scanState,
    item.detectedMime,
    item.updatedAt,
    item.permissions,
  ]);

/** File access is lazy and stays bound to the accepted document revision in either layout. */
const documentTableColumns = ['file', 'state', 'created', 'fileActions'] as const;

export function documentTableHeadings(locale: Locale) {
  return documentTableColumns.map((column) => documentText(column, locale));
}

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
  recordSearch,
  relatedLinks,
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
  recordSearch?: Record<string, unknown> | undefined;
  relatedLinks?: RelatedDocumentLinks | undefined;
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
  const groups =
    recordSearch && !recordSearch.q && !recordSearch.state
      ? documentGroups.map((label) => ({
          label,
          rows: rows.filter((item) => documentGroup(item) === label),
        }))
      : [{ label: null, rows }];
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [recovery, setRecovery] = useState<RemovalRecovery | null>(null);
  const [checkingKey, setCheckingKey] = useState<string | null>(null);
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
    setRecovery((current) => (current && !valid.has(current.removal.key) ? null : current));
    setReceipts((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => valid.has(key)))
    );
  }, [basis]);
  async function checkRemoval(current: Removal) {
    const operation = `${current.key}:removal-check`;
    if (controllers.current.has(operation)) return;
    const abort = new AbortController();
    controllers.current.set(operation, abort);
    setCheckingKey(current.key);
    const owned = () => alive.current && !abort.signal.aborted && keys.current.has(current.key);
    try {
      const data = await readDocument<BusinessDocument>(
        `${documentBase(staff)}/${encodeURIComponent(current.documentId)}`,
        { signal: abort.signal }
      );
      if (!owned()) return;
      if (
        data.id !== current.documentId ||
        data.profileId !== current.profileId ||
        !Number.isSafeInteger(data.revision)
      )
        throw new Error('Document status mismatch');
      if (
        data.revision === current.revision &&
        data.state === current.state &&
        data.permissions?.remove === true
      ) {
        setRecovery({ removal: current, checked: true, failed: false });
      } else {
        onChanged?.(current.documentId);
      }
    } catch (error) {
      if (!owned()) return;
      if (error instanceof DocumentRequestError && [401, 403].includes(error.status)) {
        setRecovery(null);
        setReceipts({});
        onDenied?.();
      } else if (error instanceof DocumentRequestError && error.status === 404) {
        onChanged?.(current.documentId);
      } else {
        setRecovery({ removal: current, checked: false, failed: true });
      }
    } finally {
      if (alive.current) setCheckingKey((key) => (key === current.key ? null : key));
      if (controllers.current.get(operation) === abort) controllers.current.delete(operation);
    }
  }
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
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 space-y-1">
          {relatedLinks || recordSearch ? (
            staffOrderId(item.id) ? (
              <Link
                {...(relatedLinks
                  ? relatedDocumentLocation(relatedLinks.context, item.id)
                  : {
                      to: staff
                        ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                        : '/documents/$documentId/{-$operation}',
                      params: { documentId: item.id, operation: undefined },
                      search: recordSearch,
                    })}
                disabled={relatedLinks?.disabled}
                onClick={(event) => {
                  if (relatedLinks?.blocked?.()) event.preventDefault();
                }}
                className="touch-action inline-flex min-w-0 items-center font-medium text-primary underline underline-offset-4 [overflow-wrap:anywhere]"
              >
                <bdi>{item.originalName}</bdi>
              </Link>
            ) : (
              <bdi>{item.originalName}</bdi>
            )
          ) : (
            <Button
              variant="link"
              className="min-w-0 justify-start whitespace-normal break-all text-start"
              aria-pressed={selectedId === item.id}
              onClick={() => onSelect(item.id)}
            >
              <bdi>{item.originalName}</bdi>
            </Button>
          )}
          <p className="text-xs font-normal text-muted-foreground">
            {word(item.category)} · <bdi>{size(item)}</bdi>
          </p>
        </div>
      </div>
    );
  }
  function files(item: BusinessDocument) {
    const key = identity(item);
    const pending = recovery?.removal.key === key ? recovery : null;
    const canRead =
      !pending &&
      !isQuarantinedDocument(item) &&
      (readable.has(item.state) || (staff && item.state === 'Removed'));
    const canPreview =
      !pending &&
      !isQuarantinedDocument(item) &&
      readable.has(item.state) &&
      item.permissions?.download !== false &&
      previewMime.has(item.detectedMime ?? '');
    const canDownload = canRead && item.permissions?.download !== false;
    const canRemove =
      item.permissions?.remove === true &&
      (relatedLinks?.context.kind !== 'contract' || relatedLinks.allowChanges !== false) &&
      (recordSearch || relatedLinks ? !!staffOrderId(item.id) : !!onChanged);
    const canReplace =
      !pending &&
      item.permissions?.replace === true &&
      relatedLinks?.allowChanges !== false &&
      (relatedLinks?.context.kind !== 'contract' || isContractAttachmentRole(item.contractRole)) &&
      (relatedLinks || recordSearch
        ? !!staffOrderId(item.id) &&
          canReplaceDocument(
            item,
            staff,
            relatedLinks?.context.kind === 'solar_request',
            relatedLinks?.context.kind === 'order' && !staff
          )
        : !!onReplace);
    if (!canDownload && !canRemove && !canReplace && !pending) return null;
    const entry = receipts[key] ?? {};
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {canPreview && (
            <Button
              variant="outline"
              disabled={entry.preview?.pending}
              onClick={() => void access(item, 'preview')}
              data-table-action-tooltip={word(
                entry.preview?.pending
                  ? 'previewLoading'
                  : entry.preview?.visible
                    ? 'hidePreview'
                    : 'preview'
              )}
            >
              <TableActionIcon icon={entry.preview?.visible ? TableEyeOffIcon : TableEyeIcon}>
                {word(
                  entry.preview?.pending
                    ? 'previewLoading'
                    : entry.preview?.visible
                      ? 'hidePreview'
                      : 'preview'
                )}
              </TableActionIcon>
            </Button>
          )}
          {canDownload && (
            <Button
              variant="outline"
              disabled={entry.download?.pending}
              onClick={() => void access(item, 'download')}
              data-table-action-tooltip={word(
                entry.download?.pending ? 'downloadLoading' : 'download'
              )}
            >
              <TableActionIcon icon={TableDownloadIcon}>
                {word(entry.download?.pending ? 'downloadLoading' : 'download')}
              </TableActionIcon>
            </Button>
          )}
          {canReplace &&
            (relatedLinks || recordSearch ? (
              <Link
                {...(relatedLinks
                  ? relatedDocumentLocation(relatedLinks.context, item.id, 'replace')
                  : {
                      to: staff
                        ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                        : '/documents/$documentId/{-$operation}',
                      params: {
                        documentId: item.id,
                        section: staff ? 'replace' : undefined,
                        operation: staff ? undefined : 'replace',
                      },
                      search: recordSearch,
                    })}
                disabled={relatedLinks?.disabled}
                onClick={(event) => {
                  if (relatedLinks?.blocked?.()) event.preventDefault();
                }}
                className={buttonVariants({ variant: 'outline' })}
                data-table-action-tooltip={word('replace')}
              >
                <TableActionIcon icon={TableFileUpIcon}>{word('replace')}</TableActionIcon>
              </Link>
            ) : (
              <Button
                variant="outline"
                onClick={() => onReplace?.(item)}
                data-table-action-tooltip={word('replace')}
              >
                <TableActionIcon icon={TableFileUpIcon}>{word('replace')}</TableActionIcon>
              </Button>
            ))}
          {canRemove && (recordSearch || relatedLinks) ? (
            <Link
              {...(relatedLinks
                ? relatedDocumentLocation(relatedLinks.context, item.id, 'remove')
                : {
                    to: staff
                      ? '/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}'
                      : '/documents/$documentId/{-$operation}',
                    params: {
                      documentId: item.id,
                      section: staff ? 'decisions' : undefined,
                      action: staff ? 'remove' : undefined,
                      holdId: undefined,
                      operation: staff ? undefined : 'remove',
                    },
                    search: recordSearch,
                  })}
              disabled={relatedLinks?.disabled}
              onClick={(event) => {
                if (relatedLinks?.blocked?.()) event.preventDefault();
              }}
              className={buttonVariants({ variant: 'outline' })}
              data-table-action-tooltip={word('remove')}
            >
              <TableActionIcon icon={TableTrash2Icon}>{word('remove')}</TableActionIcon>
            </Link>
          ) : canRemove ? (
            <Button
              variant="outline"
              disabled={!!recovery && !pending?.checked}
              onClick={() =>
                setRemoval(
                  pending?.removal ?? {
                    key,
                    documentId: item.id,
                    profileId: item.profileId,
                    revision: item.revision,
                    state: item.state,
                    action: {
                      risk: 'destructive',
                      title: word('remove'),
                      description: item.originalName,
                      path: `${documentBase(staff)}/${encodeURIComponent(item.id)}/remove`,
                      method: 'POST',
                      body: {
                        expectedRevision: item.revision,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      conflictMessage: word('conflict'),
                      forbiddenMessage: word('denied'),
                    },
                  }
                )
              }
              data-table-action-tooltip={word('remove')}
            >
              <TableActionIcon icon={TableTrash2Icon}>{word('remove')}</TableActionIcon>
            </Button>
          ) : null}
        </div>
        {pending && (
          <div className="space-y-2">
            <p role="alert" className="max-w-sm text-sm text-destructive">
              {pending.failed ? word('error') : confirmationText('unconfirmed', locale)}
            </p>
            {!pending.checked && (
              <Button
                variant="outline"
                disabled={checkingKey === key}
                onClick={() => void checkRemoval(pending.removal)}
                data-table-action-tooltip={confirmationText('checkStatus', locale)}
              >
                <TableActionIcon icon={TableRotateCwIcon}>
                  {confirmationText('checkStatus', locale)}
                </TableActionIcon>
              </Button>
            )}
          </div>
        )}
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
            data-table-action-tooltip={word('openFile')}
          >
            <TableActionIcon icon={TableExternalLinkIcon}>{word('openFile')}</TableActionIcon>
          </a>
        )}
      </div>
    );
  }
  const source = (item: BusinessDocument) => (
    <div className="space-y-1">
      <time dateTime={Number.isFinite(Date.parse(item.createdAt)) ? item.createdAt : undefined}>
        {formatDate(item.createdAt)}
      </time>
      <p className="text-xs text-muted-foreground">
        {word(item.uploadedByType)} · {word(item.businessRecordType)}
      </p>
    </div>
  );
  const [file, state, created, actions] = documentTableHeadings(locale);
  const columns: HistoryColumn<BusinessDocument>[] = [
    { id: 'file', label: file, render: name },
    { id: 'status', label: state, render: status },
    { id: 'uploaded', label: created, render: source },
    { id: 'actions', label: actions, render: files, actions: true },
  ];
  return (
    <div data-slot="document-records" data-view={view} className="min-w-0">
      {view === 'table' ? (
        <HistoryTable
          caption={word('listTitle')}
          items={groups.flatMap((group) => group.rows)}
          columns={columns}
          rowKey={(item) => item.id}
        />
      ) : (
        groups
          .filter((group) => group.rows.length)
          .map(({ label, rows }) => (
            <section key={label ?? 'all'} className="space-y-3 [&+section]:mt-6">
              {label && <h2 className="text-lg font-semibold">{word(label)}</h2>}
              <ul className="flex flex-col gap-3">
                {rows.map((item) => (
                  <li key={item.id}>
                    <Card className="gap-3">
                      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className="min-w-0">{name(item)}</CardTitle>
                        {status(item)}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="border-t pt-3 text-sm">{source(item)}</div>
                        {files(item)}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
      {activeRemoval && (
        <TeamActionDialog
          action={activeRemoval.action}
          onClose={() => setRemoval(null)}
          onDenied={() => {
            setRemoval(null);
            setRecovery(null);
            for (const controller of controllers.current.values()) controller.abort();
            controllers.current.clear();
            setReceipts({});
            onDenied?.();
          }}
          onUnconfirmed={() => {
            if (!alive.current || !keys.current.has(activeRemoval.key)) return;
            for (const [operation, controller] of controllers.current) {
              if (operation.startsWith(`${activeRemoval.key}:`)) {
                controller.abort();
                controllers.current.delete(operation);
              }
            }
            setReceipts((current) =>
              Object.fromEntries(
                Object.entries(current).filter(([key]) => key !== activeRemoval.key)
              )
            );
            setRemoval(null);
            setRecovery({ removal: activeRemoval, checked: false, failed: false });
          }}
          onSuccess={async (value) => {
            if (!alive.current || !keys.current.has(activeRemoval.key)) return;
            const receipt = value as Partial<BusinessDocument> | null;
            if (
              !receipt ||
              receipt.id !== activeRemoval.documentId ||
              receipt.profileId !== activeRemoval.profileId ||
              receipt.revision !== activeRemoval.revision + 1 ||
              receipt.state !== 'Removed'
            )
              throw new Error('Document removal receipt mismatch');
            for (const [operation, controller] of controllers.current)
              if (operation.startsWith(`${activeRemoval.key}:`)) {
                controller.abort();
                controllers.current.delete(operation);
              }
            setRemoval(null);
            setRecovery(null);
            setReceipts({});
            onChanged?.(activeRemoval.documentId);
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </div>
  );
}

export { DocumentList as DocumentRecords };
