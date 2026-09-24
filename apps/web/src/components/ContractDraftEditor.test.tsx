import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import type { ContractDetailData, ContractVersion } from '../lib/contracts.js';
import type { TeamAction } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  result: null as unknown,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onClose,
    onSuccess,
  }: {
    action: TeamAction;
    onClose: () => void;
    onSuccess: (result: unknown) => Promise<void>;
  }) => {
    harness.action = action;
    return (
      <div role="dialog">
        <button onClick={onClose}>Cancel confirmation</button>
        <button onClick={() => void onSuccess(harness.result)}>Confirm</button>
      </div>
    );
  },
}));
const ID = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  ORDER = '33333333-3333-4333-8333-333333333333';
const version: ContractVersion = {
  id: '44444444-4444-4444-8444-444444444444',
  versionNumber: 2,
  content: {
    title: ' Original ',
    text: 'Old terms',
    price: '9007199254740993',
    nested: { policy: ['keep', false] },
  },
  changeDescription: 'Initial',
  createdAt: '2026-09-21T00:00:00Z',
  acceptedAt: null,
};
const contract: ContractDetailData = {
  id: ID,
  profileId: PROFILE,
  serviceType: 'solar',
  state: 'Draft',
  currentVersionId: version.id,
  currentVersion: version,
};
let container: HTMLDivElement, root: Root;
const onSaved = vi.fn();
beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  harness.result = { id: ID, currentVersion: { id: version.id } };
  onSaved.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('profileId=')
              ? { orders: [{ id: ORDER, serviceType: 'electricity' }], nextBefore: null }
              : {
                  profiles: [{ id: PROFILE, title: 'Acme', profileType: 'LEGAL' }],
                  nextBefore: null,
                }
          )
        )
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const words = () => (harness.locale === 'fa' ? fa : en);
async function click(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(
      (node) => node.textContent === label
    );
    expect(button).toBeDefined();
    button!.click();
  });
}
async function field(label: string, value: string) {
  await act(async () => {
    const node = [...container.querySelectorAll('label')].find(
      (node) => node.textContent === label
    )!;
    expect(node).toBeDefined();
    const input = document.getElementById(node.htmlFor) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const proto =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : input instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function render(existing?: { contract: ContractDetailData; version: ContractVersion }) {
  await act(async () => root.render(<ContractDraftEditor existing={existing} onSaved={onSaved} />));
  await click(words()[existing ? 'draftEdit' : 'draftCreate']);
}
it.each(['en', 'fa'] as const)(
  'creates a selected draft with step-up and keeps input after cancellation in %s',
  async (locale) => {
    harness.locale = locale;
    await render();
    await click(words().draftReview);
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(harness.action).toBeNull();
    await field(words().draftProfile, PROFILE);
    await field(words().draftOrder, ORDER);
    await field(words().titleField, ' New contract ');
    await field(words().draftTerms, 'Safe <script>text</script>');
    await field(words().contextReason, 'Initial draft');
    await click(words().draftReview);
    expect(harness.action).toMatchObject({
      path: '/api/admin/contracts',
      method: 'POST',
      requiresPassword: true,
      body: {
        profileId: PROFILE,
        orderId: ORDER,
        serviceType: 'electricity',
        content: { title: 'New contract', text: 'Safe <script>text</script>' },
        changeDescription: 'Initial draft',
        idempotencyKey: expect.any(String),
      },
    });
    await click('Cancel confirmation');
    expect(container.querySelector('input[id$="-title"]')).toHaveProperty(
      'value',
      ' New contract '
    );
    await click(words().draftReview);
    await click('Confirm');
    expect(onSaved).toHaveBeenCalledWith(ID);
    expect(container.querySelector('form')).toBeNull();
  }
);
it.each(['en', 'fa'] as const)(
  'saves fixed and variable commercial terms without rounding in %s',
  async (locale) => {
    harness.locale = locale;
    await render();
    await field(words().draftProfile, PROFILE);
    await field(words().titleField, 'Supply terms');
    await field(words().draftTerms, 'Customer-approved terms');
    await field(words().contextReason, 'Initial draft');
    await field(words().statedContractValue, 'fixed');
    await field(words().fixedContractAmount, '9223372036854775808');
    await click(words().draftReview);
    expect(harness.action).toBeNull();
    await field(words().fixedContractAmount, '9007199254740993');
    await click(words().draftReview);
    expect(harness.action?.body).toMatchObject({
      content: { commercialValue: { kind: 'fixed', amountIrr: '9007199254740993' } },
    });
    await click('Cancel confirmation');
    await field(words().statedContractValue, 'variable');
    await field(words().variableContractDescription, 'Indexed to delivered kWh');
    await click(words().draftReview);
    expect(harness.action?.body).toMatchObject({
      content: {
        commercialValue: { kind: 'variable', description: 'Indexed to delivered kWh' },
      },
    });
  }
);
it('preserves opaque imported fields and unchanged whitespace, captures the exact version and resubmission notice', async () => {
  await render({ contract: { ...contract, state: 'ChangesRequested' }, version });
  expect(
    [...container.querySelectorAll('button')].find((b) => b.textContent === en.draftReview)
      ?.disabled
  ).toBe(true);
  await field(en.draftTerms, 'New terms');
  await field(en.contextReason, 'Requested revision');
  await click(en.draftReview);
  expect(harness.action).toMatchObject({
    method: 'PATCH',
    path: '/api/admin/contracts/' + ID,
    description: en.contextResubmitNotice,
    body: { expectedVersionId: version.id, content: { ...version.content, text: 'New terms' } },
  });
  expect(harness.action!.body).not.toHaveProperty('activationContext');
  expect(version.content!.text).toBe('Old terms');
});
it.each(['en', 'fa'] as const)(
  'proposes a replacement version with preserved terms and a reason in %s',
  async (locale) => {
    harness.locale = locale;
    await act(async () =>
      root.render(
        <ContractDraftEditor
          existing={{ contract: { ...contract, state: 'Active' }, version }}
          amendment
          onSaved={onSaved}
        />
      )
    );
    await click(words().amendmentCreate);
    expect(container.textContent).toContain(words().amendmentBaseNotice);
    await field(words().draftTerms, 'Replacement terms');
    await field(words().contextReason, 'Extend term');
    await click(words().amendmentReview);
    expect(harness.action).toMatchObject({
      method: 'POST',
      path: `/api/admin/contracts/${ID}/amendments`,
      requiresPassword: true,
      body: {
        expectedVersionId: version.id,
        content: { ...version.content, text: 'Replacement terms' },
        changeDescription: 'Extend term',
        idempotencyKey: expect.any(String),
      },
    });
  }
);
it('preserves structured imported fields and rejects oversized UTF-8 content', async () => {
  await render({
    contract,
    version: {
      ...version,
      content: { title: { fa: 'Imported' }, text: 'Editable', nested: ['keep'] },
    },
  });
  expect(container.querySelector('input[id$="-title"]')).toHaveProperty('disabled', true);
  await field(en.draftTerms, 'ب'.repeat(33000));
  await field(en.contextReason, 'Large');
  await click(en.draftReview);
  expect(harness.action).toBeNull();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  await field(en.draftTerms, 'Changed');
  await click(en.draftReview);
  expect(harness.action!.body).toMatchObject({
    content: { title: { fa: 'Imported' }, text: 'Changed', nested: ['keep'] },
  });
});
it('requires an explicit replacement for an unsupported imported commercial value', async () => {
  await render({
    contract,
    version: { ...version, content: { ...version.content, commercialValue: { legacy: true } } },
  });
  await field(en.draftTerms, 'Updated terms');
  await field(en.contextReason, 'Correct imported value');
  await click(en.draftReview);
  expect(harness.action).toBeNull();
  await field(en.statedContractValue, 'unstated');
  await click(en.draftReview);
  expect((harness.action?.body as { content: Record<string, unknown> }).content).not.toHaveProperty(
    'commercialValue'
  );
});
it('clears a linked order when its service or profile search changes', async () => {
  await render();
  await field(en.draftProfile, PROFILE);
  await field(en.draftOrder, ORDER);
  await field(en.serviceType, 'solar');
  expect(container.querySelectorAll('select')[2]).toHaveProperty('value', '');
  await field(en.draftSearchProfiles, 'Next');
  await click(en.draftSearch);
  expect(container.querySelector(`option[value="${ORDER}"]`)).toBeNull();
  expect(fetch).toHaveBeenLastCalledWith(
    expect.stringContaining('search=Next'),
    expect.any(Object)
  );
});
it('recovers option failures and appends distinct pagination results', async () => {
  const fetcher = vi.mocked(fetch);
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 403 }));
  await render();
  expect(container.querySelector('[role=alert]')!.textContent).toBe(en.draftOptionsError);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        profiles: [{ id: PROFILE, title: 'Acme', profileType: 'LEGAL' }],
        nextBefore: PROFILE,
      })
    )
  );
  await click(en.refresh);
  fetcher.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        profiles: [
          { id: PROFILE, title: 'Acme', profileType: 'LEGAL' },
          { id: ID, title: 'New', profileType: 'INDIVIDUAL' },
        ],
        nextBefore: null,
      })
    )
  );
  await click(en.next);
  expect(container.querySelectorAll('select')[0]!.options).toHaveLength(3);
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('before=' + PROFILE),
    expect.any(Object)
  );
});
