import { Link, useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@barghsa/ui';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { SavingOrderComments } from '../components/SavingOrderComments.js';
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
  agreement_snapshot: string;
  contract_version_id: string;
  stages: Array<{
    stage: string;
    status: string;
    completed_at: string | null;
    explanation: string | null;
    handover_description: string | null;
  }>;
  revisions: SavingOrderRevision[];
  addressAmendments: SavingAddressAmendment[];
  hardwareAmendments: SavingHardwareAmendment[];
  hardwareUpgrades: SavingHardwareUpgrade[];
}

export function SavingOrderDetailPage() {
  const { orderId } = useParams({ from: '/_app/savings/orders/$orderId' });
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tSaving(key, locale);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/saving/orders/${orderId}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('order');
        return response.json() as Promise<Detail>;
      })
      .then((result) => {
        if (!controller.signal.aborted) {
          setDetail(result);
          setState('ready');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [orderId, revision]);
  const action = detail ? savingNextAction(detail) : null;
  const latestCompletedStage = detail?.stages.filter((stage) => stage.completed_at).at(-1);
  const actionOwner =
    action?.kind === 'none'
      ? 'none'
      : ['acceptContract', 'payInvoice', 'payUpgrade'].includes(action?.kind ?? '')
        ? 'customer'
        : 'staff';
  return (
    <main
      className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <Link to="/savings/orders" className="text-sm text-primary hover:underline">
          {copy('orders')}
        </Link>
        <h1 className="text-3xl font-semibold">{copy('orderDetail')}</h1>
      </header>
      {state === 'loading' && <p role="status">{copy('loading')}</p>}
      {state === 'error' && <p role="alert">{copy('error')}</p>}
      {detail && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={copy(
              detail.status === 'awaiting_staff_review'
                ? 'staffReview'
                : detail.status === 'in_progress'
                  ? 'inProgress'
                  : detail.status
            )}
            happened={latestCompletedStage ? copy(latestCompletedStage.stage) : copy('submitted')}
            nextAction={copy('action.' + action?.kind)}
            owner={actionOwner}
            actionHref={action?.href}
          />
          <Card>
            <CardContent className="space-y-4 pt-6">
              <h2 className="text-xl font-semibold">
                {detail.pricing_snapshot.plan.title[locale]}
              </h2>
              <dl className="grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{copy('stepHardware')}</dt>
                  <dd>{detail.current_hardware_title[locale]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('billIdentifier')}</dt>
                  <dd>
                    <bdi>{detail.bill_identifier}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('stepAddress')}</dt>
                  <dd>
                    {detail.address_snapshot.full_address} ·{' '}
                    <bdi>{detail.address_snapshot.postal_code}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{copy('submittedAt')}</dt>
                  <dd>
                    <time dateTime={detail.submitted_at}>
                      {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
                        new Date(detail.submitted_at)
                      )}
                    </time>
                  </dd>
                </div>
              </dl>
              {detail.verification_result.status !== 'verified' && (
                <p className="text-sm text-muted-foreground">{copy('manualReview')}</p>
              )}
            </CardContent>
          </Card>
          {detail.can_edit && (
            <SavingOrderChangePanel
              key={detail.contract_version_id}
              orderId={detail.id}
              profileId={detail.profile_id}
              planId={detail.saving_plan_id}
              currentHardwareId={detail.hardware_product_id}
              currentAddressId={detail.installation_address_id}
              onChanged={() => setRevision((value) => value + 1)}
            />
          )}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="text-xl font-semibold">{copy('invoice')}</h2>
              <p>
                {copy('subtotal')}: <bdi>{numbers.money(detail.pricing_snapshot.subtotalIrR)}</bdi>
              </p>
              <p>
                {copy('discount')}: <bdi>{numbers.money(detail.pricing_snapshot.discountIrR)}</bdi>
              </p>
              <p>
                {copy('vat')}: <bdi>{numbers.money(detail.pricing_snapshot.vatIrR)}</bdi>
              </p>
              <p className="font-semibold">
                {copy('total')}: <bdi>{numbers.money(detail.pricing_snapshot.totalIrR)}</bdi>
              </p>
              <p>{detail.invoice_state ? copy(detail.invoice_state) : copy('unavailable')}</p>
              <p className="text-sm text-muted-foreground">
                {copy('financialStatus')}: {copy('financial.' + detail.financial_status)}
              </p>
              {detail.invoice_id && (
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: detail.invoice_id }}
                  className="inline-block text-primary hover:underline"
                >
                  {copy('payment')}
                </Link>
              )}
            </CardContent>
          </Card>
          <SavingOrderRevisionHistory revisions={detail.revisions ?? []} />
          <SavingAddressAmendmentHistory amendments={detail.addressAmendments ?? []} />
          <SavingHardwareAmendmentHistory amendments={detail.hardwareAmendments ?? []} />
          <SavingHardwareUpgradeHistory upgrades={detail.hardwareUpgrades ?? []} />
          <Card>
            <CardContent className="space-y-2 pt-6">
              <h2 className="text-xl font-semibold">{copy('contract')}</h2>
              <p>{detail.contract_state ? copy(detail.contract_state) : copy('unavailable')}</p>
            </CardContent>
          </Card>
          {detail.contract_id && detail.contract_version_id && (
            <div id="saving-cancellation">
              <ContractCancellationPanel
                id={detail.contract_id}
                versionId={detail.contract_version_id}
                staff={false}
                onChanged={() => setRevision((value) => value + 1)}
              />
            </div>
          )}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <h2 className="text-xl font-semibold">{copy('fulfillment')}</h2>
              <ol className="grid gap-2 md:grid-cols-5" aria-label={copy('fulfillment')}>
                {detail.stages.map((stage, index) => (
                  <li
                    key={stage.stage}
                    aria-current={stage.status === 'in_progress' ? 'step' : undefined}
                    className={`rounded-md border p-3 text-sm ${stage.status === 'in_progress' ? 'border-primary bg-primary/5' : stage.status === 'completed' ? 'border-green-600/50 bg-green-600/5' : ''}`}
                  >
                    <span className="mb-2 block text-xs text-muted-foreground">
                      {numbers.number(index + 1)} / {numbers.number(detail.stages.length)}
                    </span>
                    <strong className="block">{copy(stage.stage)}</strong>
                    <span>{copy(stage.status)}</span>
                    {stage.completed_at && (
                      <time
                        className="mt-1 block text-xs text-muted-foreground"
                        dateTime={stage.completed_at}
                      >
                        {new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(
                          new Date(stage.completed_at)
                        )}
                      </time>
                    )}
                    {stage.handover_description && (
                      <p className="mt-2 text-xs">{stage.handover_description}</p>
                    )}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <SavingOrderDocuments orderId={detail.order_id} profileId={detail.profile_id} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <SavingOrderComments orderId={detail.id} />
            </CardContent>
          </Card>
          <details className="rounded-md border p-4">
            <summary className="cursor-pointer font-medium">{copy('agreement')}</summary>
            <p className="mt-3 whitespace-pre-wrap text-sm">{detail.agreement_snapshot}</p>
          </details>
        </>
      )}
    </main>
  );
}
