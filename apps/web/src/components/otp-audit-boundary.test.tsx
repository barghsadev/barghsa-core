import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OtpConfigPanel } from './OtpConfigPanel.js';
import { configAuditPage } from '../test/config-audit-fixtures.js';
const capture = vi.hoisted(() => ({
  success: null as null | ((raw: unknown) => Promise<void>),
  close: null as null | (() => void),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: (raw: unknown) => Promise<void>;
    onClose: () => void;
  }) => {
    capture.success = onSuccess;
    capture.close = onClose;
    return <div role="dialog">Review code expiry</div>;
  },
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (raw: string) => raw, notice: null }),
}));
it.each(['denied', 'cancelled', 'unmounted'] as const)(
  'does not restore OTP settings from a late completion after %s',
  async (kind) => {
    capture.success = capture.close = null;
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    document.documentElement.lang = 'en';
    let denied = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/audit?')
          ? Response.json(configAuditPage(), { status: denied ? 403 : 200 })
          : Response.json({ ttlSeconds: 300, version: 1 })
      )
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let mounted = true;
    const click = async (label: string) => {
      const button = [...host.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === label
      );
      expect(button, label).toBeDefined();
      await act(async () => button!.click());
    };
    try {
      await act(async () => root.render(<OtpConfigPanel />));
      const input = host.querySelector<HTMLInputElement>('#otp-lifetime')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          '120'
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click('Save code expiry');
      await vi.waitFor(() => expect(capture.success).toBeTypeOf('function'));
      const complete = capture.success!;
      if (kind === 'denied') {
        await click('View changes');
        denied = true;
        await click('Refresh changes');
        expect(host.querySelector('[data-testid=config-audit]')).toBeNull();
        expect(input.value).toBe('');
      } else if (kind === 'cancelled') await act(async () => capture.close!());
      else {
        await act(async () => root.unmount());
        mounted = false;
      }
      await act(async () => complete({ ttlSeconds: 120, version: 2 }));
      expect(host.textContent).not.toContain('Code expiry updated.');
      if (kind === 'denied') expect(input.value).toBe('');
    } finally {
      if (mounted) await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      document.documentElement.lang = 'fa';
    }
  }
);
