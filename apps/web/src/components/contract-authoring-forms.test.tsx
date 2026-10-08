import { QueryProvider } from '../test/query-provider.js';
import { act, StrictMode, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { en, fa } from '@barghsa/i18n/contracts';
import { tContractAuthoring } from '@barghsa/i18n/contract-authoring';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ContractDraftChoices } from './ContractDraftChoices.js';
import { ContractDraftEditor } from './ContractDraftEditor.js';
import { ContractContextEditor } from './ContractContextEditor.js';
import { ContractActivationPanel } from './ContractActivationPanel.js';
import type { TeamActionDialog } from './TeamActionDialog.js';
import {
  contract,
  version,
  context,
  PROFILE,
  ORDER,
  actor,
  authoringReceipt,
} from '../lib/contract-authoring-form.fixtures.js';
import type { ContractFormCoordination } from '../lib/contract-review-signature-form.js';
const harness = vi.hoisted(() => ({
  actor: 'builder',
  revision: 0,
  locale: 'en' as 'en' | 'fa',
  timezone: 'Asia/Tehran',
  timeStatus: 'ready',
  dialog: null as ComponentProps<typeof TeamActionDialog> | null,
}));
vi.mock('../hooks/useAccountUser.js', () => ({ useAccountUser: () => harness.actor }));
vi.mock('../lib/profile-context.js', () => ({ useProfileContextRevision: () => harness.revision }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    timezone: harness.timezone,
    status: harness.timeStatus,
    notice: null,
    format: String,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/contracts">{children}</a>,
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: ComponentProps<typeof TeamActionDialog>) => {
    harness.dialog = props;
    return <div role="dialog">Captured save</div>;
  },
}));
let host: HTMLDivElement, root: Root;
const saved = vi.fn(),
  denied = vi.fn();
beforeEach(() => {
  harness.actor = actor;
  harness.revision = 0;
  harness.locale = 'en';
  harness.timezone = 'Asia/Tehran';
  harness.timeStatus = 'ready';
  harness.dialog = null;
  saved.mockReset();
  denied.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('/activation')
              ? context
              : url.includes('profileId=')
                ? {
                    orders: [
                      { id: ORDER, serviceType: 'electricity', createdAt: version.createdAt },
                    ],
                    nextBefore: null,
                  }
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
  host.remove();
  vi.unstubAllGlobals();
});
const words = () => (harness.locale === 'en' ? en : fa);
async function render(node: ReactNode) {
  await act(async () => root.render(<QueryProvider>{node}</QueryProvider>));
}
async function click(text: string) {
  await act(async () => {
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === text);
    expect(button).toBeDefined();
    button!.click();
  });
  await vi.waitFor(() => expect(host.querySelector('button[aria-busy=true]')).toBeNull());
}
async function edit(label: string, value: string) {
  await act(async () => {
    const labelNode = [...host.querySelectorAll('label')].find(
      (node) => node.textContent === label
    )!;
    expect(labelNode).toBeDefined();
    const input = document.getElementById(labelNode.htmlFor) as
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
async function openDraft(coordination?: ContractFormCoordination) {
  await render(
    <StrictMode>
      <ContractDraftEditor
        existing={{ contract, version }}
        onSaved={saved}
        onDenied={denied}
        coordination={coordination}
      />
    </StrictMode>
  );
  await click(words().draftEdit);
  await vi.waitFor(() =>
    expect(host.querySelector('[data-testid=contract-draft-form]')).not.toBeNull()
  );
}
async function prepareDraft() {
  await edit(words().draftTerms, 'Changed raw terms');
  await edit(words().contextReason, ' Raw reason ');
  await click(words().draftReview);
  await vi.waitFor(() => expect(harness.dialog).not.toBeNull());
  return harness.dialog!;
}
const envelope = (fields: unknown[], code: string = ErrorCodes.VALIDATION_INPUT_INVALID.code) => ({
  error: { code, message: 'Input is invalid', correlationId: ORDER, fields },
});
function ownership() {
  let owner: object | null = null,
    revision = 0;
  return {
    blocked: () => !!owner,
    revision: () => revision,
    acquire: (claim: object) => {
      if (owner) return false;
      owner = claim;
      ++revision;
      return true;
    },
    release: (claim: object) => {
      if (owner === claim) owner = null;
    },
  } satisfies ContractFormCoordination;
}
it('keeps an immutable unknown command through rejected retry and StrictMode, then settles only the actual full receipt', async () => {
  const coordination = ownership();
  await openDraft(coordination);
  const first = await prepareDraft(),
    body = JSON.stringify(first.action!.body);
  await act(async () => {
    first.onPendingChange?.(true);
    first.onUnconfirmed?.();
  });
  expect(coordination.blocked()).toBe(true);
  expect(host.querySelector('textarea')).toHaveProperty('disabled', true);
  const toggle = [...host.querySelectorAll('button')].find(
    (node) => node.textContent === en.draftEdit
  )!;
  expect(toggle.disabled).toBe(true);
  await act(async () => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelector('form')).not.toBeNull();
  await click(tContractAuthoring('retryCaptured', 'en'));
  const retry = harness.dialog!;
  expect(JSON.stringify(retry.action!.body)).toBe(body);
  await act(async () => {
    const reject = retry.action!.errorMessages![ErrorCodes.CONFLICT_STATE.code];
    expect(typeof reject).toBe('function');
    if (typeof reject === 'function') reject(envelope([], ErrorCodes.CONFLICT_STATE.code));
  });
  expect(coordination.blocked()).toBe(true);
  await click(tContractAuthoring('retryCaptured', 'en'));
  const final = harness.dialog!;
  expect(JSON.stringify(final.action!.body)).toBe(body);
  await act(async () =>
    final.onSuccess(
      authoringReceipt({
        kind: 'revise',
        actor,
        body: final.action!.body as Record<string, unknown>,
        existing: { contract, version },
      })
    )
  );
  expect(saved).toHaveBeenCalledWith(contract.id);
  expect(coordination.blocked()).toBe(false);
  expect(host.querySelector('form')).toBeNull();
});
it.each(['en', 'fa'] as const)(
  'focuses complete owned server metadata without losing hidden commercial draft in %s',
  async (locale) => {
    harness.locale = locale;
    await openDraft();
    await edit(words().statedContractValue, 'fixed');
    await edit(words().fixedContractAmount, '9007199254740993');
    await edit(words().statedContractValue, 'variable');
    await edit(words().variableContractDescription, 'Indexed');
    const dialog = await prepareDraft();
    await act(async () => {
      dialog.onPendingChange?.(true);
      const mapping = dialog.action!.errorMessages![ErrorCodes.VALIDATION_INPUT_INVALID.code];
      expect(typeof mapping).toBe('function');
      if (typeof mapping === 'function') mapping(envelope(['changeDescription']));
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(
        document.getElementById('contract-draft-changeDescription')
      );
      expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
    });
    expect((document.activeElement as HTMLTextAreaElement).value).toBe(' Raw reason ');
    await edit(words().statedContractValue, 'fixed');
    expect(document.getElementById('contract-draft-commercialValueAmountIrr')).toHaveProperty(
      'value',
      '9007199254740993'
    );
  }
);
it('keeps mixed/protected metadata generic and retains the raw draft', async () => {
  await openDraft();
  const dialog = await prepareDraft();
  await act(async () => {
    const mapping = dialog.action!.errorMessages![ErrorCodes.VALIDATION_INPUT_INVALID.code];
    expect(typeof mapping).toBe('function');
    if (typeof mapping === 'function')
      mapping(envelope(['changeDescription', 'expectedVersionId']));
  });
  expect(host.textContent).toContain(en.error);
  expect(
    document.getElementById('contract-draft-changeDescription')?.getAttribute('aria-invalid')
  ).not.toBe('true');
  expect(document.getElementById('contract-draft-text')).toHaveProperty(
    'value',
    'Changed raw terms'
  );
});
it('ignores retained old actor callbacks while current complete missing withdrawal clears only current work', async () => {
  await openDraft();
  const old = await prepareDraft();
  await act(async () => old.onPendingChange?.(true));
  harness.actor = 'new-staff';
  await openDraft();
  await prepareDraft();
  await act(async () => {
    old.onDenied?.(403);
    await old.onSuccess({});
  });
  expect(denied).not.toHaveBeenCalled();
  expect(host.querySelector('form')).not.toBeNull();
  const current = harness.dialog!;
  await act(async () => {
    const mapping = current.action!.errorMessages![ErrorCodes.NOT_FOUND_RESOURCE.code];
    if (typeof mapping === 'function') mapping(envelope([], ErrorCodes.NOT_FOUND_RESOURCE.code));
  });
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('form')).toBeNull();
});
it('retains raw and hidden fields on same-source history/updated-time refresh, but resets for a material version', async () => {
  await openDraft();
  await edit(en.draftTerms, ' Unsaved terms ');
  await edit(en.statedContractValue, 'variable');
  await edit(en.variableContractDescription, ' Hidden variable ');
  await edit(en.statedContractValue, 'fixed');
  await render(
    <StrictMode>
      <ContractDraftEditor
        existing={{
          contract: {
            ...contract,
            history: [
              { id: ORDER, event: 'read', at: version.createdAt, actorType: 'staff', reason: null },
            ],
          },
          version: { ...version, history: [] },
        }}
        onSaved={saved}
      />
    </StrictMode>
  );
  expect(document.getElementById('contract-draft-text')).toHaveProperty('value', ' Unsaved terms ');
  await edit(en.statedContractValue, 'variable');
  expect(document.getElementById('contract-draft-commercialValueDescription')).toHaveProperty(
    'value',
    ' Hidden variable '
  );
  await render(
    <ContractDraftEditor
      existing={{
        contract,
        version: { ...version, id: ORDER, content: { ...version.content, text: 'Fresh' } },
      }}
      onSaved={saved}
    />
  );
  expect(host.querySelector('form')).toBeNull();
});
it('preserves the captured UTC context body/key through timezone loading/new preference and rejected uncertain retry', async () => {
  const coordination = ownership();
  const node = () => (
    <ContractContextEditor
      context={context}
      version={version}
      source={contract}
      onChanged={() => saved(contract.id)}
      coordination={coordination}
    />
  );
  await render(node());
  await click(en.editContext);
  await edit(en.serviceEndsAt, '2026-11-22T03:30');
  await edit(en.contextReason, ' Extend ');
  await click(en.saveContext);
  const first = harness.dialog!,
    body = JSON.stringify(first.action!.body);
  expect(first.action!.successStatus).toBe(200);
  await act(async () => {
    first.onPendingChange?.(true);
    first.onUnconfirmed?.();
  });
  harness.timeStatus = 'loading';
  await render(node());
  harness.timeStatus = 'ready';
  harness.timezone = 'UTC';
  await render(node());
  expect(document.getElementById('contract-context-start')).toHaveProperty(
    'value',
    '2026-09-22T03:30'
  );
  await click(tContractAuthoring('retryCaptured', 'en'));
  expect(JSON.stringify(harness.dialog!.action!.body)).toBe(body);
  await act(async () =>
    harness.dialog!.onSuccess(
      authoringReceipt({
        kind: 'context',
        actor,
        existing: { contract, version },
        body: harness.dialog!.action!.body as Record<string, unknown>,
      })
    )
  );
  expect(saved).toHaveBeenCalledOnce();
  expect(coordination.blocked()).toBe(false);
  expect(document.getElementById('contract-context-reason')).toHaveProperty('value', '');
});
it('gates context readiness and preserves unchanged raw dates through evaluation-only refresh', async () => {
  const node = (evaluatedAt = context.evaluatedAt) => (
    <ContractContextEditor
      context={{ ...context, evaluatedAt }}
      version={version}
      source={contract}
      onChanged={() => saved(contract.id)}
    />
  );
  await render(node());
  await click(en.editContext);
  await edit(en.contextReason, ' Private reason ');
  harness.timeStatus = 'error';
  await render(node());
  expect(
    [...host.querySelectorAll('button')].find((b) => b.textContent === en.saveContext)?.disabled
  ).toBe(true);
  await render(node('2026-10-05T02:00:00.000Z'));
  expect(document.getElementById('contract-context-reason')).toHaveProperty(
    'value',
    ' Private reason '
  );
  harness.timeStatus = 'ready';
  harness.timezone = 'UTC';
  await render(node('2026-10-05T02:00:00.000Z'));
  expect(document.getElementById('contract-context-start')).toHaveProperty(
    'value',
    '2026-09-22T00:00'
  );
});
it('withdraws a current denied activation source and ignores an obsolete held scope denial', async () => {
  let finish!: (response: Response) => void;
  const coordination = ownership(),
    claim = {};
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...context, initialInvoiceId: ORDER })))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...context, versionId: ORDER })));
  vi.stubGlobal('fetch', fetcher);
  await render(
    <ContractActivationPanel
      id={contract.id}
      versionId={version.id}
      staff
      source={contract}
      onDenied={denied}
      coordination={coordination}
    />
  );
  const invoice = host.querySelector<HTMLAnchorElement>('a[href]')!;
  expect(invoice.href).toContain('/admin/invoices?invoiceId=' + ORDER);
  await act(async () => {
    expect(coordination.acquire(claim)).toBe(true);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    invoice.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    coordination.release(claim);
  });
  await click(en.refresh);
  await render(
    <ContractActivationPanel
      id={contract.id}
      versionId={ORDER}
      staff
      source={contract}
      onDenied={denied}
      coordination={coordination}
    />
  );
  await act(async () => finish(new Response('{}', { status: 403 })));
  expect(denied).not.toHaveBeenCalled();
  expect(host.querySelectorAll('li')).toHaveLength(5);
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 404 }));
  await click(en.refresh);
  expect(denied).toHaveBeenCalledOnce();
  expect(host.querySelector('li')).toBeNull();
});

it('fences a held authoring-options denial synchronously after the shared parent claims a command', async () => {
  const coordination = ownership(),
    changed = vi.fn();
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  await render(
    <ContractDraftChoices
      value=""
      onChange={changed}
      coordination={coordination}
      onDenied={denied}
    />
  );
  await act(async () => {
    expect(coordination.acquire({})).toBe(true);
    finish(new Response('{}', { status: 403 }));
  });
  expect(denied).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
});
