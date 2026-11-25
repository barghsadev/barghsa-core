import { useEffect, useMemo, useRef } from 'react';
import { tSaving } from '@barghsa/i18n/saving';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import { useLocale } from '../hooks/useLocale.js';
import { savingDocumentsEditable } from '../lib/related-document-route.js';
import type { SavingQueueFilters } from '../lib/staff-order-list-query.js';

export function SavingOrderDocuments({
  orderId,
  recordId,
  profileId,
  status,
  staff = false,
  search,
  disabled,
  blocked,
}: {
  orderId: string;
  recordId: string;
  profileId: string;
  status: string;
  staff?: boolean;
  search?: SavingQueueFilters | undefined;
  disabled?: boolean;
  blocked?: () => boolean;
}) {
  const locale = useLocale();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const writable = savingDocumentsEditable(status);
  useEffect(() => {
    if (window.location.hash !== '#order-documents') return;
    section.current?.scrollIntoView?.({ block: 'start' });
    heading.current?.focus({ preventScroll: true });
  }, [recordId]);
  const filters = useMemo<DocumentFilters>(
    () => ({
      kind: 'order',
      state: '',
      category: '',
      query: '',
      profileId,
      businessRecordId: orderId,
    }),
    [orderId, profileId]
  );
  return (
    <section
      id="order-documents"
      ref={section}
      className="scroll-mt-28 space-y-3"
      aria-label={tSaving('documents', locale)}
    >
      <h2
        ref={heading}
        tabIndex={-1}
        data-slot="editor-heading"
        className="text-xl font-semibold outline-none!"
      >
        {tSaving('documents', locale)}
      </h2>
      {!writable && (
        <p className="text-sm text-muted-foreground">{tSaving('orderDocumentsReadOnly', locale)}</p>
      )}
      <DocumentResults
        staff={staff}
        filters={filters}
        profileId={profileId}
        association={{ businessRecordType: 'order', businessRecordId: orderId }}
        relatedLinks={{
          context: { kind: 'order', id: orderId, orderId: recordId, staff, search },
          allowChanges: writable,
          disabled,
          blocked,
        }}
      />
    </section>
  );
}
