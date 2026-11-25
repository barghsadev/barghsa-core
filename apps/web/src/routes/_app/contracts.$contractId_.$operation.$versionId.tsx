import { createFileRoute, lazyRouteComponent, notFound } from '@tanstack/react-router';
import { ContractDetailLoader } from '../../components/ContractDetailLoader.js';
import { useLocale } from '../../hooks/useLocale.js';
import { customerContractId, customerContractSearch } from '../../lib/customer-contract-search.js';

const SignedUpload = lazyRouteComponent(() => import('../../pages/ContractAttachmentPage.js'));

export const Route = createFileRoute('/_app/contracts/$contractId_/$operation/$versionId')({
  validateSearch: customerContractSearch,
  component: ContractDecision,
});

function ContractDecision() {
  const { contractId, versionId, operation } = Route.useParams();
  const search = Route.useSearch();
  const locale = useLocale();
  if (
    !customerContractId(contractId) ||
    !customerContractId(versionId) ||
    (operation !== 'accept' && operation !== 'record-signature' && operation !== 'upload-signed')
  )
    throw notFound();

  const id = contractId.toLowerCase();
  const version = versionId.toLowerCase();
  if (operation === 'upload-signed')
    return (
      <SignedUpload
        contractId={id}
        versionId={version}
        staff={false}
        attachmentRole="signed"
        search={search}
      />
    );

  return (
    <div className="mx-auto max-w-3xl" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <ContractDetailLoader
        id={id}
        staff={false}
        recordPage
        {...(operation === 'accept'
          ? { acceptanceVersionId: version }
          : { signingOperation: 'record' as const, initialVersionId: version })}
        customerRecordSearch={search}
      />
    </div>
  );
}
