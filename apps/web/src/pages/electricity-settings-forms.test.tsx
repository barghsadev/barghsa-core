import { act, useEffect, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AdminElectricityRulesPage from './AdminElectricityRulesPage.js';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import {
  greenConfig,
  greenSafety,
  templateSetting,
  templateId,
  inactiveTemplateId,
} from '../test/electricity-settings-fixtures.js';
type DialogProps = Extract<ComponentProps<typeof TeamActionDialog>, { action: unknown }>;
let dialog: DialogProps | null = null;
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: DialogProps) => {
    dialog = props;
    useEffect(
      () => () => {
        if (dialog === props) dialog = null;
      },
      [props]
    );
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
const fields = {
  rules: 'simpleOrder-threshold',
  retention: 'electricity-draft-ttl',
  template: 'electricity-contract-template',
};
const buttons = {
  rules: 'Save rules',
  retention: 'Save retention period',
  template: 'Save contract template',
};
type Kind = keyof typeof fields;
function button(host: ParentNode, name: string) {
  const el = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === name);
  expect(el, name).toBeDefined();
  return el!;
}
function field(host: ParentNode, kind: Kind) {
  return host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${fields[kind]}`)!;
}
function fill(host: ParentNode, kind: Kind, value: string) {
  const el = field(host, kind);
  Object.getOwnPropertyDescriptor(
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
    'value'
  )!.set!.call(el, value);
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
  );
}
async function flush(assert: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {});
    assert();
  });
}
async function mount(read: (path: string) => Response = defaultRead) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetch = vi.fn(async (path: string) => read(path));
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AdminElectricityRulesPage />));
  await flush(() => expect(field(host, 'retention')).not.toBeNull());
  return {
    host,
    fetch,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function defaultRead(path: string) {
  return Response.json(
    path.endsWith('safety-status')
      ? greenSafety
      : path.endsWith('green-electricity-rules')
        ? greenConfig
        : path.endsWith('wizard-draft-ttl')
          ? { days: 7 }
          : templateSetting
  );
}
async function submit(host: ParentNode, kind: Kind) {
  await act(async () => button(host, buttons[kind]).click());
  await flush(() => expect(dialog).not.toBeNull());
}
it.each(['rules', 'retention', 'template'] as const)(
  '%s focuses owned validation and captures valid localized values',
  async (kind) => {
    const selectedInactive = { ...templateSetting, selectedVersionId: inactiveTemplateId };
    const view = await mount((path) =>
      path.endsWith('electricity-contract-template')
        ? Response.json(selectedInactive)
        : defaultRead(path)
    );
    try {
      if (kind !== 'template')
        await act(async () => fill(view.host, kind, kind === 'rules' ? '1e3' : '366'));
      await act(async () => button(view.host, buttons[kind]).click());
      await flush(() => expect(document.activeElement).toBe(field(view.host, kind)));
      expect(field(view.host, kind).getAttribute('aria-invalid')).toBe('true');
      expect(dialog).toBeNull();
      await act(async () =>
        fill(
          view.host,
          kind,
          kind === 'rules' ? ' ۱۷۵۰ ' : kind === 'retention' ? ' ١٤ ' : templateId
        )
      );
      await submit(view.host, kind);
      expect(dialog!.action.body).toMatchObject(
        kind === 'rules'
          ? { simpleOrder: { averagePowerThresholdKw: 1750 } }
          : kind === 'retention'
            ? { days: 14 }
            : { versionId: templateId }
      );
      expect(field(view.host, kind).matches(':disabled')).toBe(true);
      expect(
        button(view.host, buttons[kind === 'rules' ? 'retention' : 'rules']).matches(':disabled')
      ).toBe(true);
      const captured = dialog!.action;
      await act(async () =>
        view.host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(dialog!.action).toBe(captured);
      const owned =
        kind === 'rules' ? 'simpleThreshold' : kind === 'retention' ? 'days' : 'versionId';
      await act(async () => {
        expect(dialog!.onValidationError?.([owned, 'private'])).toBe(false);
        expect(dialog!.onValidationError?.([owned])).toBe(true);
        dialog!.onClose();
      });
      await flush(() => expect(document.activeElement).toBe(field(view.host, kind)));
    } finally {
      await view.close();
    }
  }
);
it.each(['rules', 'retention', 'template'] as const)(
  '%s refuses mismatched acknowledgements until an accepted read',
  async (kind) => {
    const view = await mount();
    try {
      await act(async () =>
        fill(
          view.host,
          kind,
          kind === 'rules' ? ' ۱۷۵۰ ' : kind === 'retention' ? ' ١٤ ' : templateId
        )
      );
      await submit(view.host, kind);
      await act(async () => {
        await expect(dialog!.onSuccess({})).rejects.toThrow('acknowledgement');
      });
      expect(dialog!.confirmationDisabled).toBe(true);
      await act(async () => dialog!.onClose());
      expect(button(view.host, buttons[kind]).disabled).toBe(true);
      await act(async () => button(view.host, 'Refresh').click());
      await flush(() => expect(button(view.host, buttons[kind]).disabled).toBe(false));
      expect(field(view.host, kind).value).toBe(
        kind === 'rules' ? ' ۱۷۵۰ ' : kind === 'retention' ? ' ١٤ ' : templateId
      );
    } finally {
      await view.close();
    }
  }
);
it('one failed settings read keeps drafts and leaves the other editors usable', async () => {
  let failed = false;
  const view = await mount((path) =>
    failed && path.endsWith('wizard-draft-ttl')
      ? new Response('{}', { status: 503 })
      : defaultRead(path)
  );
  try {
    await act(async () => {
      fill(view.host, 'rules', '1750');
      fill(view.host, 'retention', ' ۱۴ ');
      fill(view.host, 'template', templateId);
    });
    failed = true;
    await act(async () => button(view.host, 'Refresh').click());
    await flush(() => expect(button(view.host, buttons.retention).disabled).toBe(true));
    expect(field(view.host, 'retention').value).toBe(' ۱۴ ');
    expect(button(view.host, buttons.rules).disabled).toBe(false);
    expect(button(view.host, buttons.template).disabled).toBe(false);
    failed = false;
    await act(async () => button(view.host, 'Retry').click());
    await flush(() => expect(button(view.host, buttons.retention).disabled).toBe(false));
    expect(field(view.host, 'retention').value).toBe(' ۱۴ ');
  } finally {
    await view.close();
  }
});
it('blocked activation focuses its checkbox and disabling it remains possible', async () => {
  const view = await mount((path) =>
    path.endsWith('safety-status')
      ? Response.json({ ...greenSafety, simpleOrder: { blocked: true, reasons: ['inactive'] } })
      : defaultRead(path)
  );
  try {
    await act(async () => button(view.host, buttons.rules).click());
    await flush(() =>
      expect(document.activeElement).toBe(view.host.querySelector('#simpleOrder-enabled'))
    );
    expect(dialog).toBeNull();
    await act(async () =>
      view.host.querySelector<HTMLInputElement>('#simpleOrder-enabled')!.click()
    );
    await submit(view.host, 'rules');
    expect(dialog!.action.body).toMatchObject({ simpleOrder: { mandatoryGreenEnabled: false } });
  } finally {
    await view.close();
  }
});
it('denial in one editor removes every private draft and stale callbacks cannot revive them', async () => {
  const view = await mount();
  try {
    await act(async () => {
      fill(view.host, 'rules', '1750');
      fill(view.host, 'retention', '14');
      fill(view.host, 'template', templateId);
    });
    await submit(view.host, 'retention');
    const old = dialog!;
    await act(async () => old.onDenied?.());
    await flush(() => expect(view.host.querySelector('form')).toBeNull());
    await act(async () => old.onSuccess({ days: 14 }));
    expect(view.host.textContent).not.toContain('Settings saved.');
    await act(async () => button(view.host, 'Refresh').click());
    await flush(() => expect(field(view.host, 'retention')?.value).toBe('7'));
    expect(field(view.host, 'rules').value).toBe('1000');
    expect(field(view.host, 'template').value).toBe('');
  } finally {
    await view.close();
  }
});
it('refresh invalidates a captured action even when values remain unchanged', async () => {
  const view = await mount();
  try {
    await act(async () => fill(view.host, 'retention', '14'));
    await submit(view.host, 'retention');
    const old = dialog!;
    await act(async () => button(view.host, 'Refresh').click());
    await flush(() => expect(dialog).toBeNull());
    await act(async () => old.onSuccess({ days: 14 }));
    expect(field(view.host, 'retention').value).toBe('14');
    expect(view.host.textContent).not.toContain('Settings saved.');
  } finally {
    await view.close();
  }
});
