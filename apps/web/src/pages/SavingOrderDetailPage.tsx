import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { statusFilterTone } from '../lib/status-filter-tone.js';
import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { queryKeys } from '../lib/query-keys.js';
import {
  LoadingStatus,
  Button,
  buttonVariants,
  Card,
  CardContent,
  DualStatusDisplay,
  statusTone,
} from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingChange } from '@barghsa/i18n/saving-change';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { OrderDiscussionSection } from '../components/OrderDiscussionSection.js';
import { SavingOrderDocuments } from '../components/SavingOrderDocuments.js';
import { SavingOrderChangePanel } from '../components/SavingOrderChangePanel.js';
import {
  SavingOrderRevisionHistory,
  type SavingOrderRevision,
} from '../components/SavingOrderRevisionHistory.js';
import {
  SavingAddressAmendmentHistory,
  type SavingAddressAmendment,
} from '../components/SavingAddressAmendmentHistory.js';
import {
  SavingHardwareAmendmentHistory,
  type SavingHardwareAmendment,
} from '../components/SavingHardwareAmendmentHistory.js';
import { ContractCancellationPanel } from '../components/ContractCancellationPanel.js';
import {
  SavingHardwareUpgradeHistory,
  type SavingHardwareUpgrade,
} from '../components/SavingHardwareUpgradeHistory.js';
import { savingNextAction, type SavingActionContext } from '../lib/saving-next-action.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { t } from '@barghsa/i18n/app';
import { AcceptedSavingAgreement } from '../components/AcceptedSavingAgreement.js';
import { SavingFulfillmentProgress } from '../components/SavingFulfillmentProgress.js';
import type { SavingFulfillmentEvent, SavingFulfillmentStage } from '../lib/saving-fulfillment.js';

interface Detail extends SavingActionContext {
  order_id: string;
  profile_id: string;
  saving_plan_id: string;
  hardware_product_id: string;
  current_hardware_title: { fa: string; en: string };
  installation_address_id: string;
  can_edit: boolean;
  bill_identifier: string;
  submitted_at: string;
  address_snapshot: { full_address: string; postal_code: string };
  pricing_snapshot: {
    plan: { title: { fa: string; en: string } };
    hardware: { title: { fa: string; en: string } };
    subtotalIrR: string;
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
  };
  verification_result: { status: string };
  agreement_version_id: string;
  agreement_snapshot: string;
  agreement_updated: boolean;
  contract_version_id: string;
  stages: SavingFulfillmentStage[];
  events?: SavingFulfillmentEvent[];
  eventsTruncated?: boolean;
  revisions: SavingOrderRevision[];
  addressAmendments: SavingAddressAmendment[];
  hardwareAmendments: SavingHardwareAmendment[];
  hardwareUpgrades: SavingHardwareUpgrade[];
}

const text = (value: unknown) => typeof value === 'string';
const optionalText = (value: unknown) => value == null || text(value);
const localized = (value?: { fa: string; en: string } | null) => text(value?.fa) && text(value?.en);
const amount = (value: unknown) => typeof value === 'string' && /^-?\d+$/.test(value);

function optionalRows<T>(rows: T[] | null | undefined, valid: (row: T) => boolean) {
  return rows == null || (Array.isArray(rows) && rows.every((row) => row != null && valid(row)));
}

function validDetail(detail: Detail | null, orderId: string): detail is Detail {
  const pricing = detail?.pricing_snapshot;
  return (
    detail?.id === orderId &&
    typeof detail.profile_id === 'string' &&
    !!detail.profile_id.trim() &&
    [detail.status, detail.financial_status, detail.submitted_at, detail.bill_identifier].every(
      text
    ) &&
    [detail.invoice_id, detail.contract_id, detail.agreement_snapshot].every(optionalText) &&
    localized(detail.current_hardware_title) &&
    text(detail.address_snapshot?.full_address) &&
    text(detail.address_snapshot?.postal_code) &&
    text(detail.verification_result?.status) &&
    !!pricing &&
    localized(pricing.plan?.title) &&
    [pricing.subtotalIrR, pricing.discountIrR, pricing.vatIrR, pricing.totalIrR].every(amount) &&
    Array.isArray(detail.stages) &&
    optionalRows(
      detail.stages,
      (stage) =>
        [stage.stage, stage.status].every(text) &&
        [stage.started_at, stage.completed_at, stage.handover_description].every(optionalText)
    ) &&
    optionalRows(
      detail.events,
      (event) =>
        [event.id, event.created_at, event.explanation].every(text) &&
        optionalText(event.handover_description)
    ) &&
    optionalRows(
      detail.revisions,
      (row) =>
        [row.previousAddress, row.address].every(optionalText) &&
        (row.previousHardwareTitle == null || localized(row.previousHardwareTitle)) &&
        (row.hardwareTitle == null || localized(row.hardwareTitle))
    ) &&
    optionalRows(detail.addressAmendments, (row) =>
      [row.previousAddress, row.address, row.previousPostalCode, row.postalCode, row.reason].every(
        text
      )
    ) &&
    optionalRows(
      detail.hardwareAmendments,
      (row) =>
        localized(row.previousTitle) &&
        localized(row.hardwareTitle) &&
        optionalText(row.reason) &&
        optionalText(row.adjustmentInvoiceId) &&
        amount(row.priceDeltaIrR)
    ) &&
    optionalRows(
      detail.hardwareUpgrades,
      (row) =>
        localized(row.previousTitle) &&
        localized(row.hardwareTitle) &&
        optionalText(row.reason) &&
        text(row.adjustmentInvoiceId) &&
        amount(row.priceDeltaIrR)
    )
  );
}

export function SavingOrderDetailPage() {
  const { orderId } = useParams({ from: '/_app/savings/orders/$orderId' });
  return <SavingOrderWorkspace orderId={orderId} />;
}

export function SavingOrderEditPage() {
  const { orderId } = useParams({ from: '/_app/savings/orders/$orderId_/edit' });
  return <SavingOrderWorkspace orderId={orderId} edit />;
}

function SavingOrderWorkspace({ orderId, edit = false }: { orderId: string; edit?: boolean }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const scope = JSON.stringify([actor, profileRevision, orderId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const commandLock = useRef<{ scope: string; locked: boolean }>({ scope, locked: false });
  const [lockedEditor, setLockedEditor] = useState<string | null>(null);
  const [loadedDetail, setDetail] = useState<{ scope: string; value: Detail } | null>(null);
  const currentDetail = useRef(loadedDetail);
  currentDetail.current = loadedDetail;
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'notFound'>('loading');
  const [revision, setRevision] = useState(0);
  const detail =
    loadedDetail?.scope === scope && loadedDetail.value.id === orderId ? loadedDetail.value : null;
  const canEdit = detail?.can_edit === true;
  function refresh() {
    if (
      currentScope.current !== scope ||
      (commandLock.current.scope === scope && commandLock.current.locked)
    )
      return;
    setRevision((value) => value + 1);
  }
  const detailQueryKey = queryKeys.saving.detail(
    {
      context: 'account',
      ownerId: actor?.trim() ? actor : reader,
      accountId: actor,
      revision: profileRevision,
    },
    JSON.stringify([reader, scope, orderId, revision])
  );
  const detailQuery = useServerDetailQuery<Detail>({
    queryKey: detailQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/saving/orders/${orderId}`, {
        credentials: 'include',
        signal,
      });
      if (!response.ok) throw new ServerQueryError(response.status);
      const result = (await response.json()) as Detail | null;
      if (!validDetail(result, orderId)) throw new Error('order');
      return result;
    },
  });
  useEffect(() => {
    if (commandLock.current.scope === scope && commandLock.current.locked) return;
    const controller = new AbortController();
    setDetail(null);
    setState('loading');
    void detailQuery
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted) return;
        if (!reply.isSuccess || !reply.data) throw reply.error ?? new Error('order');
        if (!controller.signal.aborted) {
          setDetail({ scope, value: reply.data });
          setState('ready');
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setDetail(null);
          setState(
            reason instanceof ServerQueryError && [401, 403, 404].includes(reason.status)
              ? 'notFound'
              : 'error'
          );
        }
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: detailQueryKey, exact: true });
    };
  }, [orderId, revision, scope]);
  const readFeedback = (
    <>
      {time.notice}
      {state === 'loading' &&
        (edit ? (
          <LoadingStatus>{loadingText('loading', locale)}</LoadingStatus>
        ) : (
          <RecordDetailSkeleton label={loadingText('loading', locale)} layout="order" />
        ))}
      {state === 'notFound' && <p role="alert">{loadingText('recordUnavailable', locale)}</p>}
      {state === 'error' && (
        <div className="space-y-2">
          <p role="alert">{loadingText('readError', locale)}</p>
          <Button variant="outline" onClick={refresh}>
            {copy('retry')}
          </Button>
        </div>
      )}
    </>
  );

  if (edit) {
    return (
      <div
        className="mx-auto w-full max-w-2xl min-w-0 space-y-4"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        <RecordCommandGuard
          blocked={() => commandLock.current.scope === scope && commandLock.current.locked}
        />
        <header className="space-y-2">
          <Link
            to="/savings/orders/$orderId"
            params={{ orderId }}
            disabled={lockedEditor === scope}
            className="touch-action text-sm text-primary hover:underline aria-disabled:opacity-60"
          >
            {copy('orderDetail')}
          </Link>
          <h1 className="text-2xl font-semibold">{copy('changeOrder')}</h1>
          {canEdit && <p className="text-sm text-muted-foreground">{copy('changeOrderHelp')}</p>}
        </header>
        {readFeedback}
        {detail &&
          (canEdit ? (
            <>
              <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{copy('stepPlan')}</dt>
                  <dd className="font-medium wrap-anywhere">
                    <bdi>{detail.pricing_snapshot.plan.title[locale]}</bdi>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    {tSavingChange('customerCurrentTotal', locale)}
                  </dt>
                  <dd className="font-medium wrap-anywhere">
                    <bdi>{numbers.money(detail.pricing_snapshot.totalIrR)}</bdi>
                  </dd>
                </div>
              </dl>
              <SavingOrderChangePanel
                key={detail.contract_version_id}
                orderId={detail.id}
                profileId={detail.profile_id}
                planId={detail.saving_plan_id}
                currentHardwareId={detail.hardware_product_id}
                currentAddressId={detail.installation_address_id}
                currentVersionId={detail.contract_version_id}
                invoiceId={detail.invoice_id ?? ''}
                billIdentifier={detail.bill_identifier}
                agreementVersionId={detail.agreement_version_id}
                currentOrder={{
                  totalIrR: detail.pricing_snapshot.totalIrR,
                  hardwareTitle: detail.current_hardware_title,
                  address: detail.address_snapshot,
                }}
                onCommandLock={(locked) => {
                  if (currentScope.current !== scope || currentDetail.current !== loadedDetail)
                    return;
                  commandLock.current = { scope, locked };
                  setLockedEditor(locked ? scope : null);
                }}
                onWithdrawal={() => {
                  if (currentScope.current !== scope || currentDetail.current !== loadedDetail)
                    return;
                  commandLock.current = { scope, locked: false };
                  setLockedEditor(null);
                  setDetail(null);
                  setState('error');
                }}
                onChanged={refresh}
              />
            </>
          ) : (
            <p role="status">{tSavingChange('customerEditingUnavailable', locale)}</p>
          ))}
      </div>
    );
  }

  const action = detail ? savingNextAction(detail) : null;
  const status =
    detail &&
    copy(
      detail.status === 'awaiting_staff_review'
        ? 'staffReview'
        : detail.status === 'in_progress'
          ? 'inProgress'
          : detail.status
    );
  const latestCompletedStage = detail?.stages.filter((stage) => stage.completed_at).at(-1);
  const actionOwner =
    action?.kind === 'none'
      ? 'none'
      : ['acceptContract', 'payInvoice', 'payUpgrade'].includes(action?.kind ?? '')
        ? 'customer'
        : 'staff';
  return (
    <div
      className="mx-auto w-full max-w-5xl min-w-0 space-y-4"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <Link
          to="/savings/orders"
          className="touch-action inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
          <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
          {copy('orders')}
        </Link>
        <div
          className={
            state === 'loading'
              ? 'sr-only'
              : 'flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-6'
          }
        >
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">
              {copy('orderDetail')}
            </h1>
            {detail && (
              <p className="text-sm text-muted-foreground wrap-anywhere">
                <bdi>{detail.order_id}</bdi>
              </p>
            )}
          </div>
          {detail && (
            <div className="flex flex-wrap items-center gap-3">
              {canEdit && (
                <Link
                  to="/savings/orders/$orderId/edit"
                  params={{ orderId }}
                  className={buttonVariants()}
                >
                  {copy('changeOrder')}
                </Link>
              )}
              <Link
                className="touch-action text-sm font-medium text-primary underline underline-offset-4"
                to="/tickets/new"
                search={{ relatedType: 'order', relatedId: detail.order_id }}
              >
                {tTicketForms('getHelp', locale)}
              </Link>
            </div>
          )}
        </div>
      </header>
      {readFeedback}
      {detail && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={status ?? ''}
            statusSummary={
              <DualStatusDisplay
                commercialLabel={t('historyView.status', locale)}
                commercialStatus={status ?? ''}
                commercialTone={statusFilterTone(detail.status)}
                financialLabel={copy('financialStatus')}
                financialStatus={copy('financial.' + detail.financial_status)}
                financialTone={statusTone(detail.financial_status)}
              />
            }
            happened={latestCompletedStage ? copy(latestCompletedStage.stage) : copy('submitted')}
            nextAction={copy('action.' + action?.kind)}
            owner={actionOwner}
            actionHref={action?.href}
          />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">
                <bdi>{detail.pricing_snapshot.plan.title[locale]}</bdi>
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('stepHardware')}</dt>
                  <dd className="mt-1 font-medium wrap-anywhere">
                    <bdi>{detail.current_hardware_title[locale]}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('billIdentifier')}</dt>
                  <dd className="mt-1">
                    <bdi>{detail.bill_identifier}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{copy('submittedAt')}</dt>
                  <dd className="mt-1">
                    <time dateTime={detail.submitted_at}>
                      {time.format(detail.submitted_at, {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </time>
                  </dd>
                </div>
                <div className="col-span-full border-t pt-3">
                  <dt className="text-xs text-muted-foreground">{copy('stepAddress')}</dt>
                  <dd className="mt-1 font-medium wrap-anywhere">
                    <bdi>{detail.address_snapshot.full_address}</bdi> ·{' '}
                    <bdi>{detail.address_snapshot.postal_code}</bdi>
                  </dd>
                </div>
              </dl>
              {detail.verification_result.status !== 'verified' && (
                <p className="text-sm text-muted-foreground">{copy('manualReview')}</p>
              )}
            </section>
            <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{copy('invoice')}</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="col-span-full border-b pb-3">
                  <dt className="text-sm text-muted-foreground">{copy('total')}</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums wrap-anywhere">
                    <bdi>{numbers.money(detail.pricing_snapshot.totalIrR)}</bdi>
                  </dd>
                </div>
                {(
                  [
                    ['subtotal', 'subtotalIrR'],
                    ['discount', 'discountIrR'],
                    ['vat', 'vatIrR'],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key}>
                    <dt className="text-xs text-muted-foreground">{copy(label)}</dt>
                    <dd className="mt-1 font-medium">
                      <bdi>{numbers.money(detail.pricing_snapshot[key])}</bdi>
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-t pt-3 text-sm">
                <p className="text-muted-foreground">
                  {detail.invoice_state ? copy(detail.invoice_state) : copy('unavailable')}
                </p>
                {detail.invoice_id && detail.invoice_state && detail.invoice_state !== 'Draft' && (
                  <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: detail.invoice_id }}
                    className="touch-action font-medium text-primary hover:underline underline-offset-4"
                  >
                    {copy('viewInvoice')}
                  </Link>
                )}
              </div>
            </section>
          </div>
          <OrderWalletBalance
            profileId={detail.profile_id}
            scopeKey={JSON.stringify([scope, detail.id, detail.contract_version_id])}
          />
          <SavingOrderRevisionHistory
            revisions={detail.revisions ?? []}
            formatTimestamp={time.format}
          />
          <SavingAddressAmendmentHistory
            amendments={detail.addressAmendments ?? []}
            formatTimestamp={time.format}
          />
          <SavingHardwareAmendmentHistory
            amendments={detail.hardwareAmendments ?? []}
            formatTimestamp={time.format}
          />
          <SavingHardwareUpgradeHistory upgrades={detail.hardwareUpgrades ?? []} />
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h2 className="text-xl font-semibold">{copy('contract')}</h2>
              <p>{detail.contract_state ? copy(detail.contract_state) : copy('unavailable')}</p>
              {detail.contract_id &&
              detail.contract_state &&
              ['AwaitingCustomerAcceptance', 'Accepted', 'Signed', 'Active', 'Completed'].includes(
                detail.contract_state
              ) ? (
                <Link
                  to="/contracts/$contractId/{-$action}"
                  params={{ contractId: detail.contract_id }}
                  className="inline-block text-primary hover:underline"
                >
                  {copy('viewContract')}
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {detail.contract_id && detail.contract_version_id && (
            <div id="saving-cancellation">
              <ContractCancellationPanel
                id={detail.contract_id}
                versionId={detail.contract_version_id}
                staff={false}
                onChanged={refresh}
              />
            </div>
          )}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <SavingFulfillmentProgress
                stages={detail.stages}
                events={detail.events ?? []}
                truncated={detail.eventsTruncated}
                status={detail.status}
                locale={locale}
                formatTimestamp={time.format}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <SavingOrderDocuments
                orderId={detail.order_id}
                recordId={orderId}
                profileId={detail.profile_id}
                status={detail.status}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <OrderDiscussionSection
                kind="saving"
                orderId={detail.id}
                profileId={detail.profile_id}
                sourceVersion={detail.contract_version_id}
                formatTimestamp={time.format}
              />
            </CardContent>
          </Card>
          <AcceptedSavingAgreement
            snapshot={detail.agreement_snapshot}
            updated={detail.agreement_updated}
            locale={locale}
          />
        </>
      )}
    </div>
  );
}
