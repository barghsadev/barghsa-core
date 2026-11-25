import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { Alert, AlertDescription, Button, PageLoading, buttonVariants } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { ContractCancellationPanel } from '../components/ContractCancellationPanel.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import type { ContractCancellationView } from '../lib/contract-cancellation.js';
import { validContractDetail, validContractSnapshot } from '../lib/contract-detail-records.js';
import { contractBase, type ContractDetailData } from '../lib/contracts.js';
import { DocumentRequestError } from '../lib/documents.js';
import { useProfileContextRevision } from '../lib/profile-context.js';

type Props = {
  contractId: string;
  search: Record<string, unknown>;
  view: ContractCancellationView;
};

export default function ContractCancellationPage(props: Props) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <CancellationPage
      key={JSON.stringify([actor, revision, props.contractId, props.view])}
      {...props}
    />
  );
}

function CancellationPage({ contractId, search, view }: Props) {
  const staff = view.action !== 'request';
  const locale = useLocale();
  const word = (key: string) => contractText(key, locale);
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const read = useOwnedContractRead(actor, revision, undefined, contractId);
  const [version, setVersion] = useState<{ id: string; number: string | undefined } | null>(null);
  const [error, setError] = useState<'denied' | 'error' | null>(null);
  const [reload, setReload] = useState(0);
  const [locked, setLocked] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const refresh = () => setReload((value) => value + 1);
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: () => locked });
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setVersion(null);
    void read<ContractDetailData>(`${contractBase(staff)}/${encodeURIComponent(contractId)}`, {
      signal: controller.signal,
    })
      .then((contract) => {
        if (controller.signal.aborted) return;
        const snapshot = staff ? contract.currentVersion : contract.version;
        if (
          !validContractDetail(contract, contractId) ||
          !validContractSnapshot(
            snapshot,
            contractId,
            staff ? contract.currentVersionId : undefined
          )
        )
          throw new Error('Invalid cancellation source');
        setVersion({
          id: contract.currentVersionId ?? snapshot.id,
          number: contract.contractNumber,
        });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof DocumentRequestError && [401, 403, 404].includes(failure.status)
            ? 'denied'
            : 'error'
        );
      });
    return () => controller.abort();
  }, [contractId, staff, reload, read]);

  const titles = {
    request: 'cancellationRequestTitle',
    cancel: 'cancellationReview',
    reject: 'rejectionTitle',
    'review-cancellation': 'cancellationRequestReview',
    'decline-cancellation': 'cancellationRequestReject',
  };
  const back =
    'inline-flex min-h-10 items-center text-sm text-primary underline underline-offset-4';
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      {staff ? (
        <Link
          to="/admin/contracts/$contractId/{-$action}/{-$item}"
          params={{ contractId, action: undefined, item: undefined }}
          search={search}
          className={back}
          disabled={locked}
        >
          {word('backToContract')}
        </Link>
      ) : (
        <Link
          to="/contracts/$contractId/{-$action}"
          params={{ contractId, action: undefined }}
          search={search}
          className={back}
          disabled={locked}
        >
          {word('backToContract')}
        </Link>
      )}
      <header className="space-y-1">
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-none">
          {word(titles[view.action])}
        </h1>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
          {word(version?.number ? 'contractNumber' : 'cancellationQueueContract')}{' '}
          <bdi className="break-all" title={version?.number ? undefined : contractId}>
            {version?.number ?? contractId.slice(-8)}
          </bdi>
        </p>
      </header>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{word(error)}</AlertDescription>
          {error === 'error' && (
            <Button variant="outline" onClick={refresh}>
              {word('refresh')}
            </Button>
          )}
        </Alert>
      ) : version ? (
        <ContractCancellationPanel
          id={contractId}
          versionId={version.id}
          staff={staff}
          view={view}
          onLocked={setLocked}
          onChanged={refresh}
          renderAction={
            view.action === 'review-cancellation'
              ? (next, label, disabled) => (
                  <Link
                    to="/admin/contracts/$contractId/{-$action}/{-$item}"
                    params={{
                      contractId,
                      action: next.action,
                      item: 'requestId' in next ? next.requestId : undefined,
                    }}
                    search={search}
                    disabled={disabled || locked}
                    className={buttonVariants({ variant: 'outline', className: 'self-start' })}
                  >
                    {label}
                  </Link>
                )
              : undefined
          }
        />
      ) : (
        <PageLoading label={word('loading')} />
      )}
    </div>
  );
}
