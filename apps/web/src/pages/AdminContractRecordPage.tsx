import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { ContractDetailLoader } from '../components/ContractDetailLoader.js';
import { ContractDraftEditor } from '../components/ContractDraftEditor.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { validContractDetail, validContractSnapshot } from '../lib/contract-detail-records.js';
import {
  type ContractActivationData,
  type ContractDetailData,
  type ContractVersion,
} from '../lib/contracts.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import { contractActivationData } from '../lib/contract-authoring-form.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

const ContractContextEditor = lazy(() =>
  import('../components/ContractContextEditor.js').then(({ ContractContextEditor }) => ({
    default: ContractContextEditor,
  }))
);

type Entry =
  | { mode: 'new' }
  | { mode: 'detail' | 'edit' | 'amendment' | 'service-dates'; contractId: string }
  | {
      mode: 'request-changes' | 'signature-request' | 'record-signature';
      contractId: string;
      versionId: string;
    };
type Source = {
  contract: ContractDetailData;
  version: ContractVersion;
  activation?: ContractActivationData;
};

export default function AdminContractRecordPage({
  entry,
  search,
}: {
  entry: Entry;
  search: Record<string, unknown>;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const navigate = useNavigate();
  const contractId = entry.mode === 'new' ? null : entry.contractId;
  const authoring = entry.mode !== 'detail';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (authoring) heading.current?.focus({ preventScroll: true });
  }, [authoring, entry.mode, contractId]);
  const word = (key: string) => contractText(key, locale);
  const onSaved = (id: string) => {
    const savedId = staffOrderId(id);
    if (!savedId) return;
    void navigate({
      to: '/admin/contracts/$contractId/{-$action}/{-$item}',
      params: { contractId: savedId, action: undefined, item: undefined },
      search: entry.mode === 'new' ? { ...search, cursor: undefined } : search,
      replace: true,
    });
  };

  if (entry.mode === 'request-changes')
    return (
      <div className="mx-auto max-w-3xl" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <ContractDetailLoader
          id={entry.contractId}
          staff
          recordPage
          requestChangesVersionId={entry.versionId}
          staffRecordSearch={search}
        />
      </div>
    );

  if (entry.mode === 'signature-request' || entry.mode === 'record-signature')
    return (
      <div className="mx-auto max-w-3xl" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
        <ContractDetailLoader
          id={entry.contractId}
          staff
          recordPage
          signingOperation={entry.mode === 'signature-request' ? 'request' : 'record'}
          initialVersionId={entry.versionId}
          staffRecordSearch={search}
        />
      </div>
    );

  return (
    <div
      className={authoring ? 'mx-auto max-w-3xl space-y-3' : 'mx-auto max-w-5xl space-y-3'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {authoring && contractId ? (
        <Link
          to="/admin/contracts/$contractId/{-$action}/{-$item}"
          params={{ contractId, action: undefined, item: undefined }}
          search={search}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {word('backToContract')}
        </Link>
      ) : (
        <Link
          to="/admin/contracts"
          search={search}
          className="touch-action text-sm text-primary underline underline-offset-4"
        >
          {word('backToContracts')}
        </Link>
      )}
      {entry.mode === 'detail' ? (
        <ContractDetailLoader
          key={entry.contractId}
          id={entry.contractId}
          staff
          recordPage
          initialVersionId={staffOrderId(search.versionId) || undefined}
          staffRecordSearch={search}
        />
      ) : (
        <>
          <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
            {word(
              entry.mode === 'new'
                ? 'draftCreate'
                : entry.mode === 'edit'
                  ? 'draftEdit'
                  : entry.mode === 'service-dates'
                    ? 'editContext'
                    : 'amendmentCreate'
            )}
          </h1>
          {entry.mode === 'new' ? (
            <ContractDraftEditor recordPage onSaved={onSaved} />
          ) : (
            <ContractAuthoringSource
              key={JSON.stringify([actor, revision, entry.contractId, entry.mode])}
              contractId={entry.contractId}
              mode={entry.mode}
              onSaved={onSaved}
            />
          )}
        </>
      )}
    </div>
  );
}

function ContractAuthoringSource({
  contractId,
  mode,
  onSaved,
}: {
  contractId: string;
  mode: 'edit' | 'amendment' | 'service-dates';
  onSaved: (id: string) => void;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const read = useOwnedContractRead(actor, revision, undefined, contractId);
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<'error' | 'denied' | 'draftUnavailable' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setError(null);
    void read<ContractDetailData>(`/api/admin/contracts/${encodeURIComponent(contractId)}`, {
      signal: controller.signal,
    })
      .then(async (contract) => {
        if (controller.signal.aborted) return;
        const version = contract?.currentVersion;
        if (
          !validContractDetail(contract, contractId) ||
          !validContractSnapshot(version, contractId, contract.currentVersionId)
        )
          throw new Error('Invalid contract source');
        const eligible =
          mode === 'amendment'
            ? contract.amendmentSupported === true &&
              !contract.pendingAmendment &&
              ['Accepted', 'Signed', 'Active'].includes(contract.state)
            : ['Draft', 'ChangesRequested'].includes(contract.state);
        if (!eligible) {
          setError('draftUnavailable');
        } else if (mode === 'service-dates') {
          const response = await read<unknown>(
            `/api/admin/contracts/${encodeURIComponent(contractId)}/activation?versionId=${encodeURIComponent(version.id)}`,
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;
          const activation = contractActivationData(response, contractId, version.id);
          if (!activation) throw new Error('Invalid contract activation source');
          if (activation.isCurrent && activation.state === contract.state) {
            setSource({ contract, version, activation });
          } else {
            setError('draftUnavailable');
          }
        } else {
          setSource({ contract, version });
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const status = (failure as { status?: number } | null)?.status;
        setError(status && [401, 403, 404].includes(status) ? 'denied' : 'error');
      });
    return () => controller.abort();
  }, [mode, attempt, contractId, read]);

  const denied = () => {
    setSource(null);
    setError('denied');
  };

  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{contractText(error, locale)}</AlertDescription>
        {error === 'error' && (
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {contractText('refresh', locale)}
          </Button>
        )}
      </Alert>
    );
  if (!source) return <PageLoading label={contractText('loading', locale)} />;
  if (source.activation) {
    return (
      <>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <div className="min-w-0">
            <dt className="text-muted-foreground">{contractText('contractNumber', locale)}</dt>
            <dd className="break-all font-medium">
              <bdi>{source.contract.contractNumber ?? contractId}</bdi>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{contractText('version', locale)}</dt>
            <dd className="font-medium">{numbers.number(source.version.versionNumber)}</dd>
          </div>
        </dl>
        <Suspense fallback={<PageLoading label={contractText('loading', locale)} />}>
          <ContractContextEditor
            context={source.activation}
            version={source.version}
            source={source.contract}
            recordPage
            onChanged={() => onSaved(contractId)}
            onDenied={denied}
          />
        </Suspense>
      </>
    );
  }
  return (
    <ContractDraftEditor
      existing={source}
      amendment={mode === 'amendment'}
      recordPage
      onSaved={onSaved}
      onDenied={denied}
    />
  );
}
