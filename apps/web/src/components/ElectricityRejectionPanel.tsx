import { lazy, Suspense, useState } from 'react';
import { PageLoading } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { useLocale } from '../hooks/useLocale.js';
const Editor = lazy(() => import('./ContractCancellationEditor.js'));
export function ElectricityRejectionPanel({
  contractId,
  unavailable,
  onChanged,
}: {
  contractId: string;
  unavailable: boolean;
  onChanged: () => void;
}) {
  const locale = useLocale(),
    [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-md border p-4"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpen(true);
      }}
    >
      <summary className="cursor-pointer font-medium">
        {contractText('rejectionTitle', locale)}
      </summary>
      {open ? (
        <Suspense fallback={<PageLoading label={contractText('loading', locale)} />}>
          <Editor
            id={contractId}
            terminalAction="reject"
            customerRequestId={null}
            canChooseRefund={false}
            unavailable={unavailable}
            onChanged={onChanged}
          />
        </Suspense>
      ) : null}
    </details>
  );
}
