import { useEffect, useState } from 'react';
import { getRouteApi, Link, Navigate, notFound } from '@tanstack/react-router';
import { Alert, AlertDescription, Button } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { documentText } from '@barghsa/i18n/documents';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RelatedDocumentEditor } from '../components/RelatedDocumentEditor.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { contractVersionPosition } from '../lib/contract-attachments.js';
import { validContractDetail, validContractSnapshot } from '../lib/contract-detail-records.js';
import { contractBase, type ContractDetailData, type ContractVersion } from '../lib/contracts.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import type { DocumentAction } from '../lib/documents.js';
import {
  relatedDocumentEntry,
  relatedDocumentListLocation,
  relatedDocumentLocation,
  relatedDocumentOperation,
  type RelatedDocumentContext,
} from '../lib/related-document-route.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';

const customer = getRouteApi(
  '/_app/contracts/$contractId_/versions/$versionId/documents/$documentId/{-$operation}'
);
const admin = getRouteApi(
  '/admin/contracts/$contractId/versions/$versionId/documents/$documentId/{-$operation}'
);

export function CustomerContractDocumentPage() {
  return (
    <ContractDocumentRoute
      params={customer.useParams()}
      staff={false}
      search={customer.useSearch()}
    />
  );
}

export function StaffContractDocumentPage() {
  return <ContractDocumentRoute params={admin.useParams()} staff search={admin.useSearch()} />;
}

type Context = Extract<RelatedDocumentContext, { kind: 'contract' }>;

function ContractDocumentRoute({
  params,
  staff,
  search,
}: {
  params: {
    contractId: string;
    versionId: string;
    documentId: string;
    operation?: string | undefined;
  };
  staff: boolean;
  search: Record<string, unknown>;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const id = staffOrderId(params.contractId).toLowerCase();
  const versionId = staffOrderId(params.versionId).toLowerCase();
  const entry = relatedDocumentEntry(params.documentId, params.operation);
  if (!id || !versionId || !entry || entry.mode === 'upload') throw notFound();
  const context = { kind: 'contract', id, staff, versionId, search } as const;
  const replacing = entry.mode === 'replace';
  const decision = entry.mode === 'decision' ? entry.decision : undefined;
  if (
    id !== params.contractId ||
    versionId !== params.versionId ||
    entry.documentId !== params.documentId
  )
    return (
      <Navigate
        {...relatedDocumentLocation(context, entry.documentId, relatedDocumentOperation(entry))}
        replace
      />
    );
  return (
    <ContractDocumentRecord
      key={JSON.stringify([
        actor,
        revision,
        staff,
        id,
        versionId,
        entry.documentId,
        replacing,
        decision,
      ])}
      context={context}
      documentId={entry.documentId}
      replacing={replacing}
      decision={decision}
    />
  );
}

function ContractDocumentRecord({
  context,
  documentId,
  replacing,
  decision,
}: {
  context: Context;
  documentId: string;
  replacing: boolean;
  decision: DocumentAction | undefined;
}) {
  const { id, versionId, staff } = context;
  const locale = useLocale();
  const copy = (key: string) => contractText(key, locale);
  const word = (key: string) => documentText(key, locale);
  const numbers = useNumberFormatting(locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([staff, id, versionId])
  );
  const [source, setSource] = useState<{
    contract: ContractDetailData;
    version: ContractVersion;
    isDefault: boolean;
  } | null>(null);
  const [error, setError] = useState<'denied' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const base = `${contractBase(staff)}/${id}`;
    setError(null);
    void (async () => {
      const contract = await read<ContractDetailData>(base, options);
      if (controller.signal.aborted) return;
      if (!validContractDetail(contract, id)) throw new Error('Invalid contract record');
      const current = staff ? contract.currentVersion : contract.version;
      if (!validContractSnapshot(current, id, staff ? contract.currentVersionId : undefined))
        throw new Error('Invalid contract version');
      if (current.id === versionId) {
        setSource({ contract, version: current, isDefault: true });
        return;
      }
      const snapshot = await read<ContractVersion | ContractDetailData>(
        `${base}/versions/${versionId}`,
        options
      );
      if (controller.signal.aborted) return;
      const historical = snapshot as ContractDetailData;
      if (
        !staff &&
        (!validContractDetail(historical, id) || historical.profileId !== contract.profileId)
      )
        throw new Error('Invalid historical contract');
      const version = staff ? (snapshot as ContractVersion) : historical.version;
      if (!validContractSnapshot(version, id, versionId))
        throw new Error('Invalid historical version');
      setSource({ contract, version, isDefault: false });
    })().catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const status = (failure as { status?: number } | null)?.status;
      setError(status && [401, 403, 404].includes(status) ? 'denied' : 'error');
    });
    return () => controller.abort();
  }, [id, versionId, staff, attempt, read]);

  const routed = {
    ...context,
    returnVersionId: source && !source.isDefault ? versionId : undefined,
  };
  const title = replacing ? copy('contractDocumentReplace') : word(decision ?? 'details');
  const backToFile = (replacing || decision) && !!source;
  const position = source && contractVersionPosition(source.contract, versionId, staff);
  const allowReplacement = !!position && (position.isCurrent || position.isPendingAmendment);
  const summary = source && (
    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{copy('contractNumber')}</dt>
        <dd className="wrap-anywhere font-medium">
          <bdi>{source.contract.contractNumber ?? id}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{copy('version')}</dt>
        <dd className="font-medium">{numbers.number(source.version.versionNumber)}</dd>
      </div>
    </dl>
  );
  return (
    <div
      className="mx-auto w-full max-w-3xl min-w-0 space-y-3"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      data-slot="contract-document"
    >
      <Link
        {...(backToFile
          ? relatedDocumentLocation(routed, documentId)
          : relatedDocumentListLocation(routed))}
        className="touch-action inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {backToFile ? word('backToDocument') : copy('backToContract')}
      </Link>
      {source ? (
        replacing ? (
          allowReplacement ? (
            <RelatedDocumentEditor
              context={routed}
              profileId={source.contract.profileId}
              replacementId={documentId}
              title={title}
              recordContext={summary}
            />
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{title}</h1>
              {summary}
              <Alert variant="destructive">
                <AlertDescription>
                  {tContractReviewSignature('uploadUnavailable', locale)}
                </AlertDescription>
              </Alert>
            </>
          )
        ) : (
          <>
            {summary}
            <DocumentDetail
              id={documentId}
              staff={staff}
              profileId={source.contract.profileId}
              related={routed}
              allowReplacement={allowReplacement}
              decision={decision}
            />
          </>
        )
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{word(error)}</AlertDescription>
              {error === 'error' && (
                <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                  {word('retry')}
                </Button>
              )}
            </Alert>
          ) : (
            <RecordDetailSkeleton label={word('loading')} />
          )}
        </>
      )}
    </div>
  );
}
