import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import type { WorkflowOwner } from '../components/WorkflowStatusBanner.js';

export interface SolarActionRequest {
  status: string;
  contract_id: string | null;
  contract_published: boolean;
}

export function solarNextAction(
  request: SolarActionRequest,
  locale: 'fa' | 'en'
): { text: string; owner: WorkflowOwner; href?: string } {
  const copy = (key: string) => tSolar(key, locale);
  if (['submitted', 'uploading_documents', 'changes_requested'].includes(request.status))
    return { text: copy('workflowNextUpload'), owner: 'customer', href: '#solar-documents' };
  if (request.status === 'waiting_for_postal_submission')
    return { text: copy('workflowNextPostal'), owner: 'customer', href: '#solar-postal' };
  if (request.status === 'contract_created')
    return request.contract_published && request.contract_id
      ? {
          text: copy('solarViewContract'),
          owner: 'customer',
          href: `/contracts?contractId=${encodeURIComponent(request.contract_id)}`,
        }
      : { text: copy('solarContractAwaitingPublication'), owner: 'staff' };
  if (request.status === 'approved')
    return { text: copy('solarContractAwaitingPublication'), owner: 'staff' };
  if (['rejected', 'cancelled'].includes(request.status))
    return { text: t('workflow.none', locale), owner: 'none' };
  return {
    text: copy(request.status === 'documents_under_review' ? 'verifyStage' : 'finalStage'),
    owner: 'staff',
  };
}
