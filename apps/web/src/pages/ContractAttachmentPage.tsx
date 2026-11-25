import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { DocumentUpload } from '../components/DocumentUpload.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import {
  contractAttachmentActions,
  contractAttachmentTitle,
  contractVersionPosition,
  type ContractAttachmentRole,
} from '../lib/contract-attachments.js';
import { validContractDetail, validContractSnapshot } from '../lib/contract-detail-records.js';
import { contractBase, type ContractDetailData, type ContractVersion } from '../lib/contracts.js';

type AttachmentPageProps = {
  contractId: string;
  versionId: string;
  attachmentRole: ContractAttachmentRole;
  staff: boolean;
  search: Record<string, unknown>;
};

export default function ContractAttachmentPage(props: AttachmentPageProps) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedContractAttachment
      key={JSON.stringify([
        actor,
        revision,
        props.staff,
        props.contractId,
        props.versionId,
        props.attachmentRole,
      ])}
      {...props}
    />
  );
}

function OwnedContractAttachment({
  staff,
  contractId,
  versionId,
  attachmentRole: role,
  search,
}: AttachmentPageProps) {
  const navigate = useNavigate();
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const numbers = useNumberFormatting(locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedContractRead(
    actor,
    revision,
    undefined,
    JSON.stringify([staff, contractId, versionId, role])
  );
  const [source, setSource] = useState<{
    contract: ContractDetailData;
    version: ContractVersion;
    returnVersionId?: string;
  } | null>(null);
  const [error, setError] = useState<'error' | 'denied' | 'uploadUnavailable' | null>(null);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.contains(heading.current)) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [source]);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const base = `${contractBase(staff)}/${encodeURIComponent(contractId)}`;
    setSource(null);
    setError(null);
    void (async () => {
      const contract = await read<ContractDetailData>(base, options);
      if (controller.signal.aborted) return;
      if (!validContractDetail(contract, contractId)) throw new Error('Invalid contract record');
      const defaultVersion = staff ? contract.currentVersion : contract.version;
      if (
        !validContractSnapshot(
          defaultVersion,
          contractId,
          staff ? contract.currentVersionId : undefined
        )
      )
        throw new Error('Invalid contract version');
      const position = contractVersionPosition(contract, versionId, staff);
      if (!position.isCurrent && !position.isPendingAmendment) {
        setError('uploadUnavailable');
        return;
      }
      let version = defaultVersion;
      if (version.id !== versionId) {
        const snapshot = await read<ContractVersion | ContractDetailData>(
          `${base}/versions/${encodeURIComponent(versionId)}`,
          options
        );
        if (controller.signal.aborted) return;
        if (staff) {
          version = snapshot as ContractVersion;
        } else {
          const selectedContract = snapshot as ContractDetailData;
          if (
            !validContractDetail(selectedContract, contractId) ||
            selectedContract.profileId !== contract.profileId ||
            !validContractSnapshot(selectedContract.version, contractId, versionId)
          )
            throw new Error('Mismatched contract version');
          version = selectedContract.version;
        }
      }
      if (!validContractSnapshot(version, contractId, versionId))
        throw new Error('Invalid attachment version');
      if (!contractAttachmentActions(contract, version, staff).uploads.includes(role)) {
        setError('uploadUnavailable');
        return;
      }
      setSource({
        contract,
        version,
        ...(version.id !== defaultVersion.id ? { returnVersionId: version.id } : {}),
      });
    })().catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const status = (failure as { status?: number } | null)?.status;
      setError(status && [401, 403, 404].includes(status) ? 'denied' : 'error');
    });
    return () => controller.abort();
  }, [contractId, versionId, staff, role, read, retry]);

  const title = word(contractAttachmentTitle[role]);
  const backSearch = { ...search, versionId: source?.returnVersionId };
  const back = staff
    ? ({
        to: '/admin/contracts/$contractId/{-$action}/{-$item}',
        params: { contractId, action: undefined, item: undefined },
        search: backSearch,
        hash: 'contract-documents',
      } as const)
    : ({
        to: '/contracts/$contractId/{-$action}',
        params: { contractId, action: undefined },
        search: backSearch,
        hash: 'contract-documents',
      } as const);

  return (
    <div
      className="mx-auto w-full max-w-3xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
      data-slot="contract-attachment"
    >
      <Link
        {...back}
        className="touch-action inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {word('backToContract')}
      </Link>
      {source ? (
        <DocumentUpload
          staff={staff}
          profileId={source.contract.profileId}
          replacement={null}
          association={{
            businessRecordType: 'contract',
            businessRecordId: contractId,
            contractVersionId: versionId,
            contractRole: role,
          }}
          recordPage
          recordTitle={title}
          recordHeadingRef={heading}
          recordContext={
            <>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{word('contractNumber')}</dt>
                  <dd className="wrap-anywhere font-medium">
                    <bdi>{source.contract.contractNumber ?? contractId}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{word('version')}</dt>
                  <dd className="font-medium">{numbers.number(source.version.versionNumber)}</dd>
                </div>
              </dl>
              {role === 'signed' && (
                <p className="mt-3 text-sm text-muted-foreground">{word('copyNotice')}</p>
              )}
            </>
          }
          onClose={() => void navigate(back)}
          onUploaded={() => void navigate({ ...back, replace: true })}
        />
      ) : (
        <>
          <h1
            ref={heading}
            data-slot="editor-heading"
            tabIndex={-1}
            className="text-2xl font-semibold outline-none!"
          >
            {title}
          </h1>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>
                {error === 'uploadUnavailable'
                  ? tContractReviewSignature(error, locale)
                  : word(error)}
              </AlertDescription>
              {error === 'error' && (
                <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
                  {word('refresh')}
                </Button>
              )}
            </Alert>
          ) : (
            <PageLoading label={word('loading')} />
          )}
        </>
      )}
    </div>
  );
}
