import { useId } from 'react';
import { getRouteApi, Navigate, notFound } from '@tanstack/react-router';
import { Button, Skeleton } from '@barghsa/ui';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { tSaving } from '@barghsa/i18n/saving';
import SavingOrderDocumentScreen from '../components/SavingOrderDocumentScreen.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import {
  relatedDocumentEntry,
  relatedDocumentLocation,
  relatedDocumentOperation,
  type RelatedDocumentEntry,
} from '../lib/related-document-route.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { staffOrderId, type SavingQueueFilters } from '../lib/staff-order-list-query.js';

const customerRoute = getRouteApi(
  '/_app/savings/orders/$orderId_/documents/$documentId/{-$operation}'
);
const staffRoute = getRouteApi('/admin/saving-orders/$orderId/documents/$documentId/{-$operation}');

export function SavingOrderDocumentPage() {
  return <SavingDocumentRoute params={customerRoute.useParams()} staff={false} />;
}

export function SavingOrderDocumentRecord() {
  return (
    <SavingDocumentRoute params={staffRoute.useParams()} staff search={staffRoute.useSearch()} />
  );
}

function SavingDocumentRoute({
  params,
  staff,
  search,
}: {
  params: { orderId: string; documentId: string; operation?: string | undefined };
  staff: boolean;
  search?: SavingQueueFilters;
}) {
  const orderId = staffOrderId(params.orderId).toLowerCase();
  const entry = relatedDocumentEntry(params.documentId, params.operation);
  if (!entry || !orderId) throw notFound();
  const documentId = entry.mode === 'upload' ? 'new' : entry.documentId;
  if (params.orderId !== orderId || params.documentId !== documentId)
    return (
      <Navigate
        {...relatedDocumentLocation(
          { kind: 'order', id: orderId, orderId, staff, search },
          documentId,
          relatedDocumentOperation(entry)
        )}
        replace
      />
    );
  return (
    <SavingDocumentOrder
      key={orderId}
      orderId={orderId}
      staff={staff}
      search={search}
      entry={entry}
    />
  );
}

function SavingDocumentOrder({
  orderId,
  staff,
  search,
  entry,
}: {
  orderId: string;
  staff: boolean;
  search: SavingQueueFilters | undefined;
  entry: RelatedDocumentEntry;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const reader = useId();
  const locale = useLocale();
  const query = useServerDetailQuery({
    queryKey: queryKeys.saving.detail(
      {
        context: staff ? 'staff' : 'account',
        ownerId: actor || reader,
        accountId: actor,
        revision,
      },
      JSON.stringify([reader, orderId, 'documents'])
    ),
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/${staff ? 'staff/' : ''}saving/orders/${orderId}`, {
        credentials: 'include',
        signal,
      });
      if (!response.ok) throw new ServerQueryError(response.status);
      const value = (await response.json()) as Record<string, unknown> | null;
      const linkedId = staffOrderId(staff ? value?.orderId : value?.order_id);
      const profileId = staffOrderId(staff ? value?.profileId : value?.profile_id);
      if (
        value?.id !== orderId ||
        !linkedId ||
        !profileId ||
        typeof value.status !== 'string' ||
        !value.status.trim()
      )
        throw new Error('Invalid saving order response');
      const address = (staff ? value.addressSnapshot : value.address_snapshot) as {
        full_address?: unknown;
      } | null;
      const bill = staff ? value.billIdentifier : value.bill_identifier;
      return {
        linkedId,
        profileId,
        status: value.status,
        address: typeof address?.full_address === 'string' ? address.full_address : undefined,
        billIdentifier: typeof bill === 'string' ? bill : undefined,
      };
    },
  });
  const order = query.isSuccess ? query.data : null;
  const unavailable =
    query.error instanceof ServerQueryError && [401, 403, 404].includes(query.error.status);
  return (
    <SavingOrderDocumentScreen
      context={{ kind: 'order', id: order?.linkedId ?? orderId, orderId, staff, search }}
      entry={entry}
      order={order}
      feedback={
        query.isError ? (
          <div className="space-y-2">
            <p role="alert">
              {loadingText(unavailable ? 'recordUnavailable' : 'readError', locale)}
            </p>
            {!unavailable && (
              <Button variant="outline" onClick={() => void query.refetch()}>
                {tSaving('retry', locale)}
              </Button>
            )}
          </div>
        ) : (
          <div role="status" aria-label={loadingText('loading', locale)} className="space-y-3">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        )
      }
    />
  );
}
