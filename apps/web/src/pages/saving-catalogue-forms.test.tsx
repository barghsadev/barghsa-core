import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SavingAgreementEditor } from './SavingAgreementEditor.js';
import { SavingInventoryPanel } from '../components/SavingInventoryPanel.js';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import { catalogueId, hardwareId, secondCatalogueId } from '../test/catalogue-fixtures.js';
import {
  savingAgreementConfig,
  savingAgreement,
  savingInventory,
} from '../test/saving-catalogue-fixtures.js';
type DialogProps = Extract<ComponentProps<typeof TeamActionDialog>, { action: unknown }>;
let dialog: DialogProps | null = null;
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: DialogProps) => {
    dialog = props;
    return (
      <div role="dialog">
        <button onClick={props.onClose}>Close</button>
      </div>
    );
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  dialog = null;
});
function button(host: ParentNode, name: string) {
  const found = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === name);
  expect(found, name).toBeDefined();
  return found!;
}
function fill(host: ParentNode, field: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#saving-${field}`)!;
  Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  )!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
async function flush(assert: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assert();
  });
}
async function mount(
  kind: 'agreement' | 'inventory',
  read: () => Response = () =>
    Response.json(kind === 'agreement' ? savingAgreementConfig : savingInventory)
) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => read())
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn(),
    denied = vi.fn(),
    busy = vi.fn();
  const render = (id = kind === 'agreement' ? catalogueId : hardwareId, refreshVersion = 0) =>
    root.render(
      kind === 'agreement' ? (
        <SavingAgreementEditor
          planId={id}
          refreshVersion={refreshVersion}
          onChanged={changed}
          onDenied={denied}
          onBusyChange={busy}
        />
      ) : (
        <SavingInventoryPanel
          hardwareId={id}
          refreshVersion={refreshVersion}
          onDenied={denied}
          onBusyChange={busy}
        />
      )
    );
  await act(async () => render());
  return {
    host,
    changed,
    denied,
    busy,
    render,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function submit(host: ParentNode, kind: 'agreement' | 'inventory') {
  await act(async () =>
    button(host, kind === 'agreement' ? 'Save agreement draft' : 'Save inventory settings').click()
  );
  await flush(() => expect(dialog).not.toBeNull());
}
it.each(['agreement', 'inventory'] as const)(
  '%s retains drafts through failure, malformed receipt and unchanged retry',
  async (kind) => {
    let mode = 'valid';
    const valid = kind === 'agreement' ? savingAgreementConfig : savingInventory;
    const view = await mount(kind, () =>
      mode === 'failed'
        ? new Response('{}', { status: 503 })
        : Response.json(mode === 'malformed' ? {} : valid)
    );
    try {
      const field = kind === 'agreement' ? 'agreement-title' : 'stock-count',
        raw = kind === 'agreement' ? '  Keep my draft  ' : ' ۰۱۲ ';
      await act(async () => fill(view.host, field, raw));
      for (const fail of ['failed', 'malformed']) {
        mode = fail;
        await act(async () => button(view.host, 'Refresh').click());
        expect(view.host.querySelector<HTMLInputElement>(`#saving-${field}`)?.value).toBe(raw);
        expect(view.host.querySelector(`form input`)?.matches(':disabled')).toBe(true);
        mode = 'valid';
        await act(async () => button(view.host, 'Try again').click());
        expect(view.host.querySelector<HTMLInputElement>(`#saving-${field}`)?.value).toBe(raw);
      }
      await submit(view.host, kind);
      const body = dialog!.action.body;
      expect(body).toMatchObject(
        kind === 'agreement' ? { title: 'Keep my draft' } : { stockCount: 12 }
      );
      expect(view.busy).toHaveBeenLastCalledWith(true);
      const captured = dialog!.action;
      await act(async () =>
        view.host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(dialog!.action).toBe(captured);
      await act(async () => {
        expect(dialog!.onValidationError?.(['internal', 'title'])).toBe(false);
        expect(dialog!.onValidationError?.([kind === 'agreement' ? 'title' : 'stockCount'])).toBe(
          true
        );
        dialog!.onClose();
      });
      await flush(() =>
        expect(document.activeElement).toBe(view.host.querySelector(`#saving-${field}`))
      );
      expect(view.host.querySelector<HTMLInputElement>(`#saving-${field}`)?.value).toBe(raw);
    } finally {
      await view.close();
    }
  }
);
it('agreement errors focus linked fields and unsaved edits block activation', async () => {
  const view = await mount('agreement');
  try {
    await act(async () => fill(view.host, 'agreement-title', ' '));
    await act(async () => button(view.host, 'Save agreement draft').click());
    await flush(() =>
      expect(document.activeElement).toBe(view.host.querySelector('#saving-agreement-title'))
    );
    const el = document.activeElement!;
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(el.getAttribute('aria-describedby')!)?.textContent).toContain(
      '1 to 300'
    );
    expect(dialog).toBeNull();
    expect(button(view.host, 'Activate agreement').disabled).toBe(true);
    await act(async () => fill(view.host, 'agreement-title', 'Saved terms'));
    await submit(view.host, 'agreement');
    expect(dialog!.action.body).toEqual({ title: 'Saved terms', body: 'Saved agreement text.' });
  } finally {
    await view.close();
  }
});
it('inventory invalid stock tracking is actionable and focuses the owning checkbox', async () => {
  const view = await mount('inventory');
  try {
    await act(async () =>
      view.host.querySelector<HTMLInputElement>('#saving-stock-tracking')!.click()
    );
    await act(async () => button(view.host, 'Save inventory settings').click());
    await flush(() =>
      expect(document.activeElement).toBe(view.host.querySelector('#saving-stock-tracking'))
    );
    expect(dialog).toBeNull();
    expect(view.host.textContent).toContain('while units are reserved');
  } finally {
    await view.close();
  }
});
it.each(['agreement', 'inventory'] as const)(
  '%s mismatched receipts block another write until an authoritative refresh',
  async (kind) => {
    const view = await mount(kind);
    try {
      await submit(view.host, kind);
      const callback = dialog!.onSuccess;
      await act(async () => {
        await expect(callback({})).rejects.toThrow('acknowledgement');
      });
      expect(dialog!.confirmationDisabled).toBe(true);
      await act(async () => dialog!.onClose());
      expect(
        button(
          view.host,
          kind === 'agreement' ? 'Save agreement draft' : 'Save inventory settings'
        ).matches(':disabled')
      ).toBe(true);
      await act(async () => button(view.host, 'Refresh').click());
      expect(
        button(
          view.host,
          kind === 'agreement' ? 'Save agreement draft' : 'Save inventory settings'
        ).matches(':disabled')
      ).toBe(false);
    } finally {
      await view.close();
    }
  }
);
it('matching saved draft is accepted without discarding work through a failed readback', async () => {
  let fail = false;
  const view = await mount('agreement', () =>
    fail ? new Response('{}', { status: 503 }) : Response.json(savingAgreementConfig)
  );
  try {
    await act(async () => fill(view.host, 'agreement-title', ' Revised terms '));
    await submit(view.host, 'agreement');
    fail = true;
    await act(async () => dialog!.onSuccess({ ...savingAgreement, title: 'Revised terms' }));
    expect(view.changed).not.toHaveBeenCalled();
    expect(view.host.querySelector<HTMLInputElement>('#saving-agreement-title')?.value).toBe(
      'Revised terms'
    );
    expect(view.host.textContent).toContain('draft is retained');
  } finally {
    await view.close();
  }
});
it('activation captures the saved version and rejects another plan or version', async () => {
  const view = await mount('agreement');
  try {
    await act(async () => button(view.host, 'Activate agreement').click());
    const captured = dialog!;
    expect(captured.action.path).toContain(savingAgreement.id + '/activate');
    expect(captured.action.body).toBeUndefined();
    await act(async () => {
      await expect(
        captured.onSuccess({
          ...savingAgreement,
          plan_id: secondCatalogueId,
          status: 'active',
          effective_from: '2026-10-03T00:00:00Z',
        })
      ).rejects.toThrow('acknowledgement');
    });
    await act(async () => captured.onClose());
    await act(async () => button(view.host, 'Refresh').click());
    await act(async () => button(view.host, 'Activate agreement').click());
    await act(async () =>
      dialog!.onSuccess({
        ...savingAgreement,
        status: 'active',
        effective_from: '2026-10-03T00:00:00Z',
      })
    );
    expect(view.changed).toHaveBeenCalledOnce();
  } finally {
    await view.close();
  }
});
it.each(['agreement', 'inventory'] as const)(
  '%s changed basis and changed identity cancel obsolete callbacks',
  async (kind) => {
    let changed = false;
    const view = await mount(kind, () =>
      Response.json(
        kind === 'agreement'
          ? {
              ...savingAgreementConfig,
              agreements: [
                { ...savingAgreement, title: changed ? 'Changed terms' : 'Saved terms' },
              ],
            }
          : { ...savingInventory, stockCount: changed ? 20 : 10 }
      )
    );
    try {
      await submit(view.host, kind);
      const old = dialog!.onSuccess;
      await act(async () => dialog!.onClose());
      changed = true;
      await act(async () => button(view.host, 'Refresh').click());
      await act(async () => old(kind === 'agreement' ? savingAgreement : savingInventory));
      expect(
        view.host.querySelector<HTMLInputElement>(
          kind === 'agreement' ? '#saving-agreement-title' : '#saving-stock-count'
        )?.value
      ).toBe(kind === 'agreement' ? 'Changed terms' : '20');
      await submit(view.host, kind);
      const obsolete = dialog!.onSuccess;
      await act(async () => view.render(secondCatalogueId));
      await act(async () => obsolete(kind === 'agreement' ? savingAgreement : savingInventory));
      expect(view.host.querySelector('form')).toBeNull();
    } finally {
      await view.close();
    }
  }
);
it.each(['agreement', 'inventory'] as const)(
  '%s denial clears private data and obsolete callbacks cannot restore it',
  async (kind) => {
    const view = await mount(kind);
    try {
      await submit(view.host, kind);
      const obsolete = dialog!.onSuccess;
      await act(async () => dialog!.onDenied?.(403));
      expect(view.host.querySelector('form')).toBeNull();
      expect(view.denied).toHaveBeenCalledOnce();
      await act(async () => obsolete(kind === 'agreement' ? savingAgreement : savingInventory));
      expect(view.host.querySelector('form')).toBeNull();
    } finally {
      await view.close();
    }
  }
);

it.each(['agreement', 'inventory'] as const)(
  '%s parent refresh cancels captured actions and adopts its changed basis',
  async (kind) => {
    let changed = false;
    const view = await mount(kind, () =>
      Response.json(
        kind === 'agreement'
          ? {
              ...savingAgreementConfig,
              agreements: [{ ...savingAgreement, title: changed ? 'New basis' : 'Saved terms' }],
            }
          : { ...savingInventory, reservedCount: changed ? 3 : 2 }
      )
    );
    try {
      await submit(view.host, kind);
      const obsolete = dialog!.onSuccess;
      changed = true;
      await act(async () => view.render(kind === 'agreement' ? catalogueId : hardwareId, 1));
      expect(view.host.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => obsolete(kind === 'agreement' ? savingAgreement : savingInventory));
      if (kind === 'agreement')
        expect(view.host.querySelector<HTMLInputElement>('#saving-agreement-title')?.value).toBe(
          'New basis'
        );
      else expect(view.host.textContent).toContain('Reserved units: 3');
    } finally {
      await view.close();
    }
  }
);
