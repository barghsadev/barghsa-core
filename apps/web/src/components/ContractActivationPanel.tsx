import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading, StatusBadge } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  contractBase,
  type ContractActivationData,
  type ContractVersion,
} from '../lib/contracts.js';
import { documentRequest } from '../lib/documents.js';
import { ContractContextEditor } from './ContractContextEditor.js';
export function ContractActivationPanel({
  id,
  versionId,
  staff,
  editableVersion,
  onChanged,
}: {
  id: string;
  versionId: string;
  staff: boolean;
  editableVersion?: ContractVersion | undefined;
  onChanged?: () => void;
}) {
  const locale = useLocale(),
    time = useAccountTime();
  const word = (key: string) => contractText(key, locale);
  const [data, setData] = useState<ContractActivationData | null>(null),
    [error, setError] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(false);
    void documentRequest<ContractActivationData>(
      `${contractBase(staff)}/${id}/activation?versionId=${encodeURIComponent(versionId)}`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, versionId, staff, reload]);
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={word('activationTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{word('activationTitle')}</h3>
        <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
          {word('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{word('activationNotice')}</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word('error')}</AlertDescription>
        </Alert>
      ) : !data ? (
        <PageLoading label={word('loading')} />
      ) : (
        <>
          {!data.isCurrent ? <p>{word('historicalRequirements')}</p> : null}
          <ul className="divide-y">
            {data.checks.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3 py-3">
                <span>{word('prerequisite.' + item.key)}</span>
                <StatusBadge label={word('prerequisite.' + item.status)} />
              </li>
            ))}
          </ul>
          {data.initialInvoiceId ? (
            <p className="text-sm">
              {word('initialInvoiceLinked')}{' '}
              {!staff && (
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: data.initialInvoiceId }}
                  className="text-primary underline underline-offset-4"
                >
                  {word('openInitialInvoice')}
                </Link>
              )}
            </p>
          ) : data.checks.some((item) => item.key === 'initialPayment' && item.required) ? (
            <p className="text-sm text-muted-foreground">{word('initialInvoiceMissing')}</p>
          ) : null}
          {data.serviceStartsAt ? (
            <p className="text-sm">
              {word('prerequisite.serviceStart')}: {time.format(data.serviceStartsAt)}
            </p>
          ) : null}
          {data.serviceEndsAt ? (
            <p className="text-sm">
              {word('serviceEndsAt')}: {time.format(data.serviceEndsAt)}
            </p>
          ) : null}
          {data.state === 'Completed' ? <p role="status">{word('serviceCompleted')}</p> : null}
          {data.ready ? (
            <p role="status" className="font-medium">
              {word('prerequisitesReady')}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {word('evaluatedAt')}: {time.format(data.evaluatedAt)}
          </p>
          {staff &&
          data.isCurrent &&
          ['Draft', 'ChangesRequested'].includes(data.state) &&
          editableVersion?.id === data.versionId &&
          editableVersion.content &&
          onChanged ? (
            <ContractContextEditor context={data} version={editableVersion} onChanged={onChanged} />
          ) : null}
        </>
      )}
    </section>
  );
}
