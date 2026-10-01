import { listChoice, listPage, type ListQueryOptions } from './list-query.js';
import { isInvoiceUuid } from './invoice-uuid.js';

const correctionStatus = (value: unknown) =>
  listChoice(['Open', 'Under Review', 'Approved', 'Rejected'])(value) || 'Open';
export const crmCorrectionQueryOptions: ListQueryOptions = {
  searchLimit: 0,
  filters: { status: correctionStatus },
  sortFields: [],
  defaultSort: '',
  pageSizes: [20],
  defaultPageSize: 20,
  pagination: 'page',
};
export function crmCorrectionSearch(raw: Record<string, unknown>) {
  const status = correctionStatus(raw.status);
  const page = listPage(raw.page);
  return {
    profileId:
      typeof raw.profileId === 'string' &&
      raw.profileId === raw.profileId.trim() &&
      isInvoiceUuid(raw.profileId)
        ? raw.profileId
        : undefined,
    fieldName:
      listChoice(['first_name', 'last_name', 'national_id', 'legal_name', 'national_identifier'])(
        raw.fieldName
      ) || undefined,
    status: status === 'Open' ? undefined : status,
    page: page === 1 ? undefined : page,
  };
}
