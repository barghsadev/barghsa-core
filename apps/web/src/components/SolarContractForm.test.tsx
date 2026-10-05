import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SolarContractForm } from './SolarContractForm.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { contractReview } from '../test/solar-contract-fixtures.js';
import type { SolarContractBody } from '../lib/solar-contract-form.js';
import type { TeamAction } from './TeamActionDialog.js';

const harness = vi.hoisted(() => ({
  action: null as TeamAction | null,
  reviewedBody: null as Record<string, unknown> | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action, summary }: { action: TeamAction; summary?: ReactNode }) => {
    harness.action = action;
    return <div role="dialog">Review contract{summary}</div>;
  },
}));
const requestId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.action = null;
  harness.reviewedBody = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function input(label: string, value: string) {
  const linked = [...container.querySelectorAll('label')].find((item) =>
    item.textContent?.includes(label)
  );
  const control = container.querySelector('[id="' + linked?.htmlFor + '"]') as
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  expect(control, label).toBeDefined();
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
    control.dispatchEvent(
      new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}

function stubRequests() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/review')) {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        harness.reviewedBody = body;
        return Response.json(contractReview(body as unknown as SolarContractBody));
      }
      return new Response(
        JSON.stringify({
          templates: [{ version_id: versionId, name: 'Solar agreement', version_number: 2 }],
          documents: [],
        }),
        { status: 200 }
      );
    })
  );
}

it('uses a selected immutable source and invoice lines in the create command', async () => {
  stubRequests();
  await act(async () =>
    root.render(
      <AccountUserProvider value="staff-opaque">
        <SolarContractForm requestId={requestId} profileId={profileId} onCreated={() => {}} />
      </AccountUserProvider>
    )
  );
  await input('Contract source', `template:${versionId}`);
  await input('Contract title', 'Solar agreement');
  await input('Contract terms', 'Build the station.');
  await input('Draft description', 'Initial draft');
  await input('Description', 'Deposit');
  await input('Unit price', '100000');
  await input('Stated contract value', 'fixed');
  await input('Fixed amount (IRR)', '900000');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(harness.action).not.toBeNull();
  });
  expect(harness.action?.path).toBe(`/api/admin/solar/requests/${requestId}/create-contract`);
  expect(harness.reviewedBody).toMatchObject({ profileId, title: 'Solar agreement' });
  expect(harness.action?.body).toMatchObject({
    profileId,
    source: { kind: 'template', templateVersionId: versionId },
    commercialValue: { kind: 'fixed', amountIrr: '900000' },
    invoiceLines: [{ description: 'Deposit', quantity: 1, unitPrice: '100000', vatRate: 0 }],
    expectedReviewHash: 'a'.repeat(64),
  });
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Unpaid invoice total');
});

it('requires an explicit full value and supports a variable pricing rule', async () => {
  stubRequests();
  await act(async () =>
    root.render(
      <AccountUserProvider value="staff-opaque">
        <SolarContractForm requestId={requestId} profileId={profileId} onCreated={() => {}} />
      </AccountUserProvider>
    )
  );
  await input('Contract source', `template:${versionId}`);
  await input('Contract title', 'Solar agreement');
  await input('Contract terms', 'Build the station.');
  await input('Draft description', 'Initial draft');
  await input('Description', 'Deposit');
  await input('Unit price', '100000');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(harness.action).toBeNull();
  await input('Stated contract value', 'variable');
  await input('How the amount is determined', 'Final cost follows inspected capacity');
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(harness.action).not.toBeNull();
  });
  expect(harness.action?.body).toMatchObject({
    commercialValue: { kind: 'variable', description: 'Final cost follows inspected capacity' },
  });
});
