import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Toaster, toast, BaseToaster, createToastManager } from './index';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

for (const kind of ['success', 'error'] as const) {
  it(`public toast.${kind} reaches the public renderer and can be dismissed`, async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Toaster theme="light" duration={Infinity} />));
      let id: string | number = '';
      await act(async () => {
        id = toast[kind](`Public ${kind} message`);
      });
      await vi.waitFor(() => {
        expect(container.querySelector('[data-sonner-toast]')?.textContent).toContain(
          `Public ${kind} message`
        );
      });
      expect(container.querySelector('[data-sonner-toast]')?.getAttribute('data-type')).toBe(kind);
      await act(async () => {
        toast.dismiss(id);
      });
      await vi.waitFor(() => expect(container.querySelector('[data-sonner-toast]')).toBeNull());
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}

it('the explicit Base UI renderer uses its independent manager', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const manager = createToastManager();
  try {
    await act(async () => root.render(<BaseToaster toastManager={manager} />));
    await act(async () => {
      manager.add({ title: 'Base UI message', type: 'info', timeout: 0 });
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="toast-title"]')?.textContent).toBe(
        'Base UI message'
      )
    );
    expect(document.querySelector('[data-sonner-toast]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
