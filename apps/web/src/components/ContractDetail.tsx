import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldLabel,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest } from '../lib/documents.js';
import { contractBase, type ContractDetailData, type ContractVersion } from '../lib/contracts.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractActivationPanel } from './ContractActivationPanel.js';
import { ContractSignaturePanel } from './ContractSignaturePanel.js';
import { ContractTerms } from './ContractTerms.js';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import { DocumentUpload, type ContractDocumentAssociation } from './DocumentUpload.js';

type VersionPage = { versions: ContractVersion[]; nextBefore: number | null };
export function ContractDetail({
  id,
  staff,
  onClose,
  onChanged,
}: {
  id: string;
  staff: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const time = useAccountTime();
  const [data, setData] = useState<{
    contract: ContractDetailData;
    version: ContractVersion;
  } | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setData(null);
    setVersions([]);
    setNext(null);
    setError(false);
    setHistoryError(false);
    setLoadingMore(false);
    setAcknowledged(false);
    setAction(null);
    setReason('');
    setReasonMissing(false);
    const base = `${contractBase(staff)}/${encodeURIComponent(id)}`;
    void Promise.all([
      documentRequest<ContractDetailData>(base, { signal: controller.signal }),
      documentRequest<VersionPage>(`${base}/versions`, { signal: controller.signal }),
      selectedVersion
        ? documentRequest<ContractVersion | ContractDetailData>(
            `${base}/versions/${encodeURIComponent(selectedVersion)}`,
            { signal: controller.signal }
          )
        : Promise.resolve(null),
    ])
      .then(([contract, page, chosen]) => {
        if (controller.signal.aborted) return;
        const version = chosen
          ? staff
            ? (chosen as ContractVersion)
            : (chosen as ContractDetailData).version
          : staff
            ? contract.currentVersion
            : contract.version;
        if (!version || !version.content) throw new Error('Missing contract snapshot');
        setData({ contract, version });
        setVersions(page.versions);
        setNext(page.nextBefore);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, staff, selectedVersion, reload]);
  async function more() {
    const controller = active.current;
    if (next === null || !controller || loadingMore) return;
    setLoadingMore(true);
    setHistoryError(false);
    try {
      const page = await documentRequest<VersionPage>(
        `${contractBase(staff)}/${id}/versions?before=${next}`,
        { signal: controller.signal }
      );
      if (!controller.signal.aborted) {
        setVersions((previous) => [
          ...previous,
          ...page.versions.filter((item) => !previous.some((old) => old.id === item.id)),
        ]);
        setNext(page.nextBefore);
      }
    } catch {
      if (!controller.signal.aborted) setHistoryError(true);
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }
  function choose(command: 'accept' | 'submit' | 'publish' | 'request-changes') {
    if (!data) return;
    if (command === 'request-changes' && !reason.trim()) {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    setAction({
      title: word(command),
      description: `${word(data.contract.serviceType)} · ${word('version')} ${data.version.versionNumber.toLocaleString(locale)}`,
      path: `${contractBase(staff)}/${id}/${command}`,
      method: 'POST',
      body: {
        expectedVersionId: data.version.id,
        idempotencyKey: crypto.randomUUID(),
        ...(command === 'request-changes' ? { reason: reason.trim() } : {}),
      },
      conflictMessage: word('conflict'),
      forbiddenMessage: word('denied'),
    });
  }
  const currentId = data?.contract.currentVersionId ?? data?.contract.version?.id;
  const isCurrent = data?.version.id === currentId;
  return (
    <section
      className="flex flex-col gap-5 rounded-xl border bg-card p-5"
      aria-label={word('terms')}
    >
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold">
          {data ? word(data.contract.serviceType) : word('terms')}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {word('close')}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            {word('refresh')}
          </Button>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {time.notice}
          <StatusBadge label={word(data.contract.state)} />
          <div>
            <h3 className="font-semibold">
              {word('version')} {data.version.versionNumber.toLocaleString(locale)}
              {isCurrent ? ` · ${word('current')}` : ''}
            </h3>
            <p className="text-sm text-muted-foreground">{data.version.changeDescription}</p>
            <p className="text-sm">{time.format(data.version.createdAt)}</p>
            {staff && data.version.createdBy ? (
              <p className="text-sm">
                {word('changedBy')}: {data.version.createdBy}
              </p>
            ) : null}
          </div>
          <ContractTerms value={data.version.content} />
          {data.version.acceptedAt ? (
            <p role="status">
              {word('acceptedAt')}: {time.format(data.version.acceptedAt)}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{word('acceptNotice')}</p>
          {!staff && isCurrent && data.contract.canAccept ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="mt-1 size-4"
                />
                {word('acceptAcknowledgement')}
              </label>
              <Button
                className="self-start"
                disabled={!acknowledged}
                onClick={() => choose('accept')}
              >
                {word('accept')}
              </Button>
            </div>
          ) : null}
          {staff && isCurrent && data.contract.state === 'Draft' ? (
            <Button className="self-start" onClick={() => choose('submit')}>
              {word('submit')}
            </Button>
          ) : null}
          {staff && isCurrent && data.contract.state === 'AwaitingStaffReview' ? (
            <div className="flex flex-col gap-3">
              <Field data-invalid={reasonMissing || undefined}>
                <FieldLabel htmlFor="contract-change-reason">{word('reason')}</FieldLabel>
                <Textarea
                  id="contract-change-reason"
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-invalid={reasonMissing}
                />
                {reasonMissing ? <p role="alert">{word('reasonRequired')}</p> : null}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => choose('publish')}>{word('publish')}</Button>
                <Button variant="outline" onClick={() => choose('request-changes')}>
                  {word('request-changes')}
                </Button>
              </div>
            </div>
          ) : null}
          <h3 className="font-semibold">{word('versions')}</h3>
          <ol className="flex flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id} className="rounded-lg border p-3">
                <Button
                  variant="link"
                  onClick={() => setSelectedVersion(version.id)}
                  aria-pressed={version.id === data.version.id}
                >
                  {word('version')} {version.versionNumber.toLocaleString(locale)}
                </Button>
                <p>{version.changeDescription}</p>
                <p className="text-sm text-muted-foreground">
                  {time.format(version.createdAt)}
                  {staff && version.createdBy
                    ? ` · ${word('changedBy')}: ${version.createdBy}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
          {historyError ? <p role="alert">{word('error')}</p> : null}
          {next !== null ? (
            <Button variant="outline" disabled={loadingMore} onClick={() => void more()}>
              {word('next')}
            </Button>
          ) : null}
          <ContractActivationPanel
            key={'activation:' + data.version.id + ':' + reload}
            id={id}
            versionId={data.version.id}
            staff={staff}
            editableVersion={staff && isCurrent ? data.version : undefined}
            onChanged={() => {
              setSelectedVersion(null);
              setReload((value) => value + 1);
              onChanged();
            }}
          />
          <ContractSignaturePanel
            key={'signature:' + data.version.id + ':' + reload}
            id={id}
            versionId={data.version.id}
            profileId={data.contract.profileId}
            staff={staff}
            onChanged={() => {
              setReload((value) => value + 1);
              onChanged();
            }}
          />
          <ContractDocuments
            key={data.version.id + ':' + reload}
            contract={data.contract}
            version={data.version}
            staff={staff}
            isCurrent={isCurrent}
          />
        </>
      )}
      {action ? (
        <TeamActionDialog
          action={action}
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReload((value) => value + 1);
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
function ContractDocuments({
  contract,
  version,
  staff,
  isCurrent,
}: {
  contract: ContractDetailData;
  version: ContractVersion;
  staff: boolean;
  isCurrent: boolean;
}) {
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const [role, setRole] = useState<ContractDocumentAssociation['contractRole'] | null>(null);
  const [reload, setReload] = useState(0);
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'contract',
      state: '',
      category: '',
      query: '',
      profileId: contract.profileId,
      businessRecordId: contract.id,
      contractVersionId: version.id,
    }),
    [contract.profileId, contract.id, version.id]
  );
  const canUpload =
    isCurrent &&
    (staff
      ? !['Signed', 'Active', 'Completed', 'Cancelled'].includes(contract.state)
      : ['Accepted', 'AwaitingSignature'].includes(contract.state));
  return (
    <section className="flex flex-col gap-4" aria-label={word('documents')}>
      <h3 className="font-semibold">{word('documents')}</h3>
      <p className="text-sm text-muted-foreground">{word('copyNotice')}</p>
      {canUpload && !role ? (
        <div className="flex flex-wrap gap-2">
          {(staff ? (['original', 'signed', 'amendment'] as const) : (['signed'] as const)).map(
            (value) => (
              <Button key={value} variant="outline" onClick={() => setRole(value)}>
                {word(
                  value === 'original'
                    ? 'uploadOriginal'
                    : value === 'signed'
                      ? 'uploadSigned'
                      : 'uploadAmendment'
                )}
              </Button>
            )
          )}
        </div>
      ) : null}
      {role ? (
        <DocumentUpload
          staff={staff}
          profileId={contract.profileId}
          replacement={null}
          association={{
            businessRecordType: 'contract',
            businessRecordId: contract.id,
            contractVersionId: version.id,
            contractRole: role,
          }}
          onClose={() => setRole(null)}
          onUploaded={() => {
            setRole(null);
            setReload((value) => value + 1);
          }}
        />
      ) : null}
      <DocumentResults
        key={reload}
        staff={staff}
        filters={filters}
        profileId={contract.profileId}
      />
    </section>
  );
}
