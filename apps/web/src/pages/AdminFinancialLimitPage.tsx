import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker } from '@tanstack/react-router';
import { Alert, LoadingStatus, buttonVariants } from '@barghsa/ui';
import { tWorkspace } from '@barghsa/i18n/workspace-admin';
import { tWalletLimit } from '@barghsa/i18n/wallet-limit';
import { tWalletReceipts } from '@barghsa/i18n/wallet-receipts';
import { RecordEditorActions } from '../components/RecordEditorLayout.js';
import { RouteNotFound } from '../components/RouteErrorBoundary.js';
import { useLocale } from '../hooks/useLocale.js';
import type { CatalogueEditorProps } from '../hooks/useCatalogueEditor.js';

const Wallet = lazy(() => import('../components/WalletTopUpLimitConfigPanel.js'));
const Threshold = lazy(() => import('../components/DualApprovalThresholdPanel.js'));
const settings = {
  wallet: {
    queue: '/admin/wallet-receipts',
    route: '/admin/wallet-receipts/settings/{-$view}',
    panel: Wallet,
  },
  threshold: {
    queue: '/admin/approval-requests',
    route: '/admin/approval-requests/thresholds/{-$view}',
    panel: Threshold,
  },
} as const;

type View = 'overview' | 'edit' | 'history';
export interface FinancialLimitViewProps extends CatalogueEditorProps {
  view?: View;
  overviewActions?: (ready: boolean) => ReactNode;
}

export default function AdminFinancialLimitPage({
  kind,
  viewParam,
  search,
}: {
  kind: keyof typeof settings;
  viewParam: string | undefined;
  search: Record<string, unknown>;
}) {
  const locale = useLocale();
  const { queue, route, panel: Panel } = settings[kind];
  const wallet = kind === 'wallet';
  const label = (key: string) =>
    wallet
      ? tWalletLimit(`admin.walletLimit.${key}`, locale)
      : tWalletReceipts(`admin.receiptThreshold.${key}`, locale);
  const backToQueue = wallet
    ? tWalletReceipts('admin.walletReceipts.backToQueue', locale)
    : tWorkspace('admin.approvals.backToQueue', locale);
  const heading = useRef<HTMLHeadingElement>(null);
  const [locked, setLocked] = useState(false);
  const [denied, setDenied] = useState(false);
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: () => locked });
  useEffect(() => {
    if (viewParam) heading.current?.focus({ preventScroll: true });
  }, [viewParam]);
  if (viewParam !== undefined && viewParam !== 'edit' && viewParam !== 'history')
    return <RouteNotFound />;
  const view = viewParam ?? 'overview';
  const back =
    'touch-action w-fit text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60';
  return (
    <div className="mx-auto w-full max-w-2xl min-w-0 space-y-4">
      <header className="space-y-1">
        {view === 'overview' ? (
          <Link to={queue} search={search} disabled={locked} className={back}>
            {backToQueue}
          </Link>
        ) : (
          <Link
            to={route}
            params={{ view: undefined }}
            search={search}
            disabled={locked}
            className={back}
          >
            {label('title')}
          </Link>
        )}
        <h1 ref={heading} tabIndex={-1} className="w-fit text-2xl font-semibold">
          {label(view === 'edit' ? 'editTitle' : view === 'history' ? 'recoveryTitle' : 'title')}
        </h1>
      </header>
      {denied ? (
        <Alert variant="destructive">{label('forbidden')}</Alert>
      ) : (
        <Suspense fallback={<LoadingStatus>{label('loading')}</LoadingStatus>}>
          <Panel
            view={view}
            onBusyChange={setLocked}
            onDenied={() => {
              setLocked(false);
              setDenied(true);
            }}
            overviewActions={(ready) => (
              <RecordEditorActions
                secondary={
                  <Link
                    to={route}
                    params={{ view: 'history' }}
                    search={search}
                    disabled={!ready}
                    className={buttonVariants({ variant: 'ghost', className: 'text-primary' })}
                  >
                    {label('recoveryTitle')}
                  </Link>
                }
              >
                <Link
                  to={route}
                  params={{ view: 'edit' }}
                  search={search}
                  disabled={!ready}
                  className={buttonVariants()}
                >
                  {label('editTitle')}
                </Link>
              </RecordEditorActions>
            )}
          />
        </Suspense>
      )}
    </div>
  );
}
