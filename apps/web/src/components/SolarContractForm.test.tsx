import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SolarContractForm } from './SolarContractForm.js';
import type { TeamAction } from './TeamActionDialog.js';

const harness = vi.hoisted(() => ({ action: null as TeamAction | null }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: TeamAction }) => {
    harness.action = action;
    return <div role="dialog">Review contract</div>;
  },
}));
const requestId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  harness.action = null;
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
  const control = [...container.querySelectorAll('input,textarea,select')].find((item) =>
    item.closest('label')?.textContent?.includes(label)
  ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
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

it('uses a selected immutable source and invoice lines in the create command', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            templates: [{ version_id: versionId, name: 'Solar agreement', version_number: 2 }],
            documents: [],
          }),
          { status: 200 }
        )
    )
  );
  await act(async () =>
    root.render(
      <SolarContractForm requestId={requestId} profileId={profileId} onCreated={() => {}} />
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
  expect(harness.action?.path).toBe(`/api/admin/solar/requests/${requestId}/create-contract`);
  expect(harness.action?.body).toMatchObject({
    profileId,
    source: { kind: 'template', templateVersionId: versionId },
    commercialValue: { kind: 'fixed', amountIrr: '900000' },
    invoiceLines: [{ description: 'Deposit', quantity: 1, unitPrice: '100000', vatRate: 0 }],
  });
});

it('requires an explicit full value and supports a variable pricing rule', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            templates: [{ version_id: versionId, name: 'Solar agreement', version_number: 2 }],
            documents: [],
          }),
          { status: 200 }
        )
    )
  );
  await act(async () =>
    root.render(
      <SolarContractForm requestId={requestId} profileId={profileId} onCreated={() => {}} />
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
  expect(harness.action?.body).toMatchObject({
    commercialValue: { kind: 'variable', description: 'Final cost follows inspected capacity' },
  });
});
