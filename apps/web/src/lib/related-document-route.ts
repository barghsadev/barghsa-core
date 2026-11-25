import { savingOrderFilters, staffOrderId } from './staff-order-list-query.js';
import { savingOperationPath } from './saving-operation-route.js';
import { documentActions, type BusinessDocument, type DocumentAction } from './documents.js';

export const solarDocumentRoute = '/solar/requests/$requestId/documents/$documentId/{-$operation}';
export const contractDocumentRoute =
  '/contracts/$contractId/versions/$versionId/documents/$documentId/{-$operation}';
export const staffContractDocumentRoute =
  '/admin/contracts/$contractId/versions/$versionId/documents/$documentId/{-$operation}';

export type RelatedDocumentEntry =
  | { mode: 'upload' }
  | { mode: 'detail' | 'replace'; documentId: string }
  | { mode: 'decision'; documentId: string; decision: DocumentAction };

export type RelatedDocumentContext =
  | { kind: 'solar_request'; id: string }
  | {
      kind: 'contract';
      id: string;
      versionId: string;
      returnVersionId?: string | undefined;
      staff: boolean;
      search: Record<string, unknown>;
    }
  | {
      kind: 'order';
      id: string;
      orderId: string;
      staff: boolean;
      search?: ReturnType<typeof savingOrderFilters> | undefined;
    };

export type RelatedDocumentLinks = {
  context: RelatedDocumentContext;
  allowChanges?: boolean | undefined;
  allowUpload?: boolean | undefined;
  disabled?: boolean | undefined;
  blocked?: (() => boolean) | undefined;
};

export function relatedDocumentEntry(
  documentId: string,
  operation?: string
): RelatedDocumentEntry | null {
  if (documentId === 'new' && !operation) return { mode: 'upload' };
  const id = staffOrderId(documentId).toLowerCase();
  if (!id) return null;
  if (!operation || operation === 'replace')
    return { mode: operation === 'replace' ? 'replace' : 'detail', documentId: id };
  const decision = documentActions.find((action) => action === operation);
  return decision ? { mode: 'decision', documentId: id, decision } : null;
}

export function relatedDocumentOperation(entry: RelatedDocumentEntry) {
  return entry.mode === 'decision'
    ? entry.decision
    : entry.mode === 'replace'
      ? 'replace'
      : undefined;
}

export function relatedDocumentLocation(
  context: RelatedDocumentContext,
  documentId: string,
  operation?: 'replace' | DocumentAction
) {
  if (context.kind === 'solar_request')
    return {
      to: solarDocumentRoute,
      params: { requestId: context.id, documentId, operation },
    } as const;
  if (context.kind === 'contract')
    return {
      to: context.staff ? staffContractDocumentRoute : contractDocumentRoute,
      params: { contractId: context.id, versionId: context.versionId, documentId, operation },
      search: { ...context.search, versionId: undefined },
    } as const;
  const params = { orderId: context.orderId, documentId, operation };
  return context.staff
    ? ({
        to: '/admin/saving-orders/$orderId/documents/$documentId/{-$operation}',
        params,
        search: context.search ?? {},
      } as const)
    : ({ to: '/savings/orders/$orderId/documents/$documentId/{-$operation}', params } as const);
}

export function relatedDocumentListLocation(context: RelatedDocumentContext) {
  if (context.kind === 'solar_request')
    return {
      to: '/solar/requests/$requestId/documents',
      params: { requestId: context.id },
    } as const;
  if (context.kind === 'contract')
    return {
      to: context.staff
        ? '/admin/contracts/$contractId/{-$action}/{-$item}'
        : '/contracts/$contractId/{-$action}',
      params: { contractId: context.id, action: undefined, item: undefined },
      search: { ...context.search, versionId: context.returnVersionId },
      hash: 'contract-documents',
    } as const;
  const params = { orderId: context.orderId, operation: undefined, upgradeId: undefined };
  const hash = 'order-documents';
  return context.staff
    ? ({ to: savingOperationPath, params, search: context.search ?? {}, hash } as const)
    : ({ to: '/savings/orders/$orderId', params, hash } as const);
}

export function savingDocumentsEditable(status: string) {
  return !['completed', 'cancelled', 'rejected'].includes(status);
}

export function relatedDocumentMatches(
  document: Pick<
    Partial<BusinessDocument>,
    'businessRecordType' | 'businessRecordId' | 'contractVersionId'
  >,
  context: RelatedDocumentContext
) {
  return (
    document.businessRecordType === context.kind &&
    document.businessRecordId === context.id &&
    (context.kind !== 'contract' || document.contractVersionId === context.versionId)
  );
}
