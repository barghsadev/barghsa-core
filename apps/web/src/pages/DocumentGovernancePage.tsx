import { Link, notFound } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { documentText } from '@barghsa/i18n/documents';
import {
  DocumentRetentionPolicies,
  retentionKinds,
} from '../components/DocumentRetentionPolicies.js';
import { DocumentDestructionQueue } from '../components/DocumentDestructionQueue.js';
import { useLocale } from '../hooks/useLocale.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';

export default function DocumentGovernancePage({
  operation,
  recordId,
  search,
}: {
  operation: string | undefined;
  recordId: string | undefined;
  search: Record<string, unknown>;
}) {
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), [operation, recordId]);
  const word = (key: string) => documentText(key, locale);
  if (
    (operation !== 'retention' && operation !== 'destruction') ||
    (recordId &&
      !(operation === 'retention'
        ? retentionKinds.some((kind) => kind === recordId)
        : staffOrderId(recordId)))
  )
    throw notFound();

  const retention = operation === 'retention';
  return (
    <section className="mx-auto max-w-2xl space-y-3" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      {recordId ? (
        <Link
          to="/admin/documents/$documentId/{-$section}/{-$action}/{-$holdId}"
          params={{ documentId: 'governance', section: operation, action: undefined }}
          search={search}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {word(retention ? 'backToRetention' : 'backToDestruction')}
        </Link>
      ) : (
        <Link
          to="/admin/documents"
          search={search}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          {word('backToDocuments')}
        </Link>
      )}
      <h1
        ref={heading}
        tabIndex={-1}
        className="w-fit text-xl font-semibold focus-visible:outline-hidden! focus-visible:shadow-none! sm:text-2xl"
      >
        {word(
          retention
            ? recordId
              ? 'editRetention'
              : 'retentionPolicies'
            : recordId
              ? 'destructionApprove'
              : 'destructionQueue'
        )}
      </h1>
      {retention ? (
        <DocumentRetentionPolicies location={{ search, recordId }} />
      ) : (
        <DocumentDestructionQueue location={{ search, recordId: recordId?.toLowerCase() }} />
      )}
    </section>
  );
}
