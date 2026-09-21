import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import { ContractContextEditor } from './ContractContextEditor.js';
import type { ContractActivationData, ContractVersion } from '../lib/contracts.js';
import type { TeamAction } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  timezone: 'Asia/Tehran',
  status: 'ready',
  action: null as TeamAction | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ timezone: harness.timezone, status: harness.status, notice: null }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: () => Promise<void>;
  }) => {
    harness.action = action;
    return (
      <div role="dialog">
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => void onSuccess()}>Confirm</button>
      </div>
    );
  },
}));
let container: HTMLDivElement, root: Root;
const onChanged = vi.fn();
const version: ContractVersion = {
  id: '019a0000-0000-7000-8000-000000000002',
  versionNumber: 1,
  content: { price: '123', deliveryZone: 'Northern district' },
  changeDescription: 'Initial',
  createdAt: '2026-09-21T00:00:00Z',
  acceptedAt: null,
};
const context: ContractActivationData = {
  contractId: '019a0000-0000-7000-8000-000000000001',
  versionId: version.id,
  state: 'Draft',
  isCurrent: true,
  ready: false,
  ruleRevision: 1,
  initialInvoiceId: null,
  serviceStartsAt: '2026-09-22T00:00:35.123Z',
  serviceEndsAt: '2026-10-22T00:00:00Z',
  evaluatedAt: '2026-09-21T00:00:00Z',
  checks: [],
};
beforeEach(() => {
  harness.locale = 'en';
  harness.timezone = 'Asia/Tehran';
  harness.status = 'ready';
  harness.action = null;
  onChanged.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function click(text: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === text
    );
    expect(button).toBeDefined();
    button!.click();
  });
}
async function change(id: string, value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '#contract-context-' + id
    )!;
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render(extra: Partial<ContractActivationData> = {}) {
  await act(async () =>
    root.render(
      <ContractContextEditor
        context={{ ...context, ...extra }}
        version={version}
        onChanged={onChanged}
      />
    )
  );
  await click((harness.locale === 'fa' ? fa : en).editContext);
}
it.each(['en', 'fa'] as const)(
  'captures a versioned edit in the account timezone in %s',
  async (locale) => {
    harness.locale = locale;
    const words = locale === 'fa' ? fa : en;
    await render();
    expect(container.querySelector<HTMLInputElement>('#contract-context-start')!.value).toBe(
      '2026-09-22T03:30'
    );
    await change('end', '2026-11-22T03:30');
    await change('reason', 'Extend service term');
    await click(words.saveContext);
    expect(harness.action).toMatchObject({
      method: 'PATCH',
      path: '/api/admin/contracts/' + context.contractId,
      body: {
        expectedVersionId: version.id,
        content: version.content,
        changeDescription: 'Extend service term',
        activationContext: {
          initialInvoiceId: null,
          serviceStartsAt: context.serviceStartsAt,
          serviceEndsAt: '2026-11-22T00:00:00.000Z',
        },
      },
    });
    await click('Confirm');
    expect(onChanged).toHaveBeenCalledOnce();
  }
);
it('clears optional fields and explains resubmission', async () => {
  await render({ state: 'ChangesRequested' });
  await change('start', '');
  await change('end', '');
  await change('reason', 'Remove dates');
  await click(en.saveContext);
  expect(harness.action).toMatchObject({
    description: en.contextResubmitNotice,
    body: {
      activationContext: { initialInvoiceId: null, serviceStartsAt: null, serviceEndsAt: null },
    },
  });
  await click('Cancel');
  expect(onChanged).not.toHaveBeenCalled();
  expect(container.querySelector('[role=dialog]')).toBeNull();
});
it('rejects invalid invoice references and reversed date ranges', async () => {
  await render();
  await change('invoice', 'not-an-invoice');
  await change('reason', 'Change');
  await click(en.saveContext);
  expect(container.querySelector('[role=alert]')?.textContent).toBe(en.contextInvalid);
  expect(harness.action).toBeNull();
  await change('invoice', '');
  await change('end', '2026-09-21T03:30');
  await click(en.saveContext);
  expect(harness.action).toBeNull();
});
it('requires a reason and keeps saves disabled until a material edit', async () => {
  await render();
  expect(
    [...container.querySelectorAll('button')].find(
      (button) => button.textContent === en.saveContext
    )?.disabled
  ).toBe(true);
  await change('end', '2026-11-22T03:30');
  await click(en.saveContext);
  expect(harness.action).toBeNull();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
});
it('does not expose inputs before the saved timezone is available', async () => {
  harness.status = 'error';
  await render();
  expect(container.querySelector('form')).toBeNull();
});
it('rejects a nonexistent local time during a daylight-saving transition', async () => {
  harness.timezone = 'America/New_York';
  await render({ serviceStartsAt: null, serviceEndsAt: null });
  await change('start', '2027-03-14T02:30');
  await change('reason', 'Set start');
  await click(en.saveContext);
  expect(harness.action).toBeNull();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
});
