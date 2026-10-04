import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { SavingOrderChangePanel } from '../components/SavingOrderChangePanel.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { ids, source, fullQuote } from '../lib/saving-change-form.fixtures.js';
import { SavingOrderDetailPage } from './SavingOrderDetailPage.js';
const panel = vi.hoisted(() => ({
  props: null as ComponentProps<typeof SavingOrderChangePanel> | null,
}));
const sibling = vi.hoisted(() => ({ changed: null as (() => void) | null }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ orderId: ids.orderId }),
  Link: ({ children }: { children: ReactNode }) => <a href="/savings/orders">{children}</a>,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../components/SavingOrderChangePanel.js', () => ({
  SavingOrderChangePanel: (props: ComponentProps<typeof SavingOrderChangePanel>) => {
    panel.props = props;
    return <p>Private change workspace</p>;
  },
}));
vi.mock('../components/ContractCancellationPanel.js', () => ({
  ContractCancellationPanel: ({ onChanged }: { onChanged: () => void }) => {
    sibling.changed = onChanged;
    return null;
  },
}));
vi.mock('../components/SavingOrderComments.js', () => ({ SavingOrderComments: () => null }));
vi.mock('../components/SavingOrderDocuments.js', () => ({ SavingOrderDocuments: () => null }));
vi.mock('../components/SavingOrderRevisionHistory.js', () => ({
  SavingOrderRevisionHistory: () => null,
}));
vi.mock('../components/SavingAddressAmendmentHistory.js', () => ({
  SavingAddressAmendmentHistory: () => null,
}));
vi.mock('../components/SavingHardwareAmendmentHistory.js', () => ({
  SavingHardwareAmendmentHistory: () => null,
}));
vi.mock('../components/SavingHardwareUpgradeHistory.js', () => ({
  SavingHardwareUpgradeHistory: () => null,
}));
vi.mock('../components/SavingFulfillmentProgress.js', () => ({
  SavingFulfillmentProgress: () => null,
}));
vi.mock('../components/AcceptedSavingAgreement.js', () => ({
  AcceptedSavingAgreement: () => null,
}));
const detail = () => ({
  id: ids.orderId,
  order_id: ids.orderId,
  profile_id: ids.profileId,
  saving_plan_id: ids.planId,
  hardware_product_id: ids.hardware,
  current_hardware_title: { fa: 'فعلی', en: 'Current' },
  installation_address_id: ids.address,
  can_edit: true,
  bill_identifier: source.billIdentifier,
  submitted_at: '2026-10-05T10:00:00.000Z',
  address_snapshot: { full_address: 'Old street', postal_code: '1234567890' },
  pricing_snapshot: fullQuote(),
  verification_result: { status: 'verified' },
  agreement_version_id: ids.agreement,
  agreement_snapshot: 'Accepted terms\nOriginal accepted agreement body',
  agreement_updated: false,
  contract_version_id: ids.version,
  contract_id: ids.city,
  contract_state: 'ChangesRequested',
  invoice_id: ids.invoice,
  invoice_state: 'Draft',
  financial_status: 'unpaid',
  status: 'awaiting_staff_review',
  stages: [],
  revisions: [],
  addressAmendments: [],
  hardwareAmendments: [],
  hardwareUpgrades: [],
});
let root: Root | undefined;
let host: HTMLDivElement;
async function render(mock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', mock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AccountUserProvider value="buyer">
        <SavingOrderDetailPage />
      </AccountUserProvider>
    )
  );
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  panel.props = null;
  sibling.changed = null;
  vi.unstubAllGlobals();
});
it('binds source IDs and blocks sibling refresh/remount while captured command remains unresolved', async () => {
  const mock = vi.fn(async () => Response.json(detail()));
  await render(mock);
  expect(panel.props).toMatchObject({
    currentVersionId: ids.version,
    invoiceId: ids.invoice,
    billIdentifier: source.billIdentifier,
    agreementVersionId: ids.agreement,
  });
  await act(async () => {
    panel.props!.onCommandLock!(true);
    sibling.changed!();
  });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Private change workspace');
  await act(async () => {
    panel.props!.onCommandLock!(false);
    panel.props!.onChanged();
  });
  expect(mock).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Private change workspace');
});
it('fences old refresh/lock callbacks after confirmed profile revision with unchanged detail source', async () => {
  const mock = vi.fn(async () => Response.json(detail()));
  await render(mock);
  const old = panel.props!;
  await act(async () => refreshProfileContext());
  expect(mock).toHaveBeenCalledTimes(2);
  const fresh = panel.props!;
  await act(async () => {
    old.onCommandLock!(true);
    old.onChanged();
    old.onWithdrawal!();
  });
  expect(mock).toHaveBeenCalledTimes(2);
  await act(async () => fresh.onChanged());
  expect(mock).toHaveBeenCalledTimes(3);
});

it('withdraws current whole-resource detail and ignores an obsolete same-scope withdrawal after authorized retry', async () => {
  const mock = vi.fn(async () => Response.json(detail()));
  await render(mock);
  const old = panel.props!;
  await act(async () => {
    old.onCommandLock!(true);
    old.onWithdrawal!();
  });
  expect(host.textContent).not.toContain('Private change workspace');
  expect(host.textContent).not.toContain('Old street');
  const retry = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Try again'
  )!;
  expect(retry).toBeDefined();
  await act(async () => retry.click());
  expect(mock).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Private change workspace');
  await act(async () => old.onWithdrawal!());
  expect(host.textContent).toContain('Private change workspace');
});
