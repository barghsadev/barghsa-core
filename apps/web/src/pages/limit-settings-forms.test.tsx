import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Limits from './AdminContractLimitsPage.js';
import Wallet from '../components/WalletTopUpLimitConfigPanel.js';
import Threshold from '../components/DualApprovalThresholdPanel.js';
import type { TeamAction } from '../components/TeamActionDialog.js';

interface Confirmation {
  action: TeamAction;
  confirmationDisabled: boolean;
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
}
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  confirmation: null as Confirmation | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Confirmation) => {
    harness.confirmation = props;
    return <div data-testid="confirmation">{props.action.description}</div>;
  },
}));
const cases = [
  {
    name: 'contract',
    Page: Limits,
    field: 'leadTimeDays',
    selector: '#contract-limit-leadTimeDays',
    initial: { maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 0 },
    saved: { maxQuantityIncreasePercent: 20, maxContractDuration: 24, leadTimeDays: 14 },
    raw: ' ۱۴ ',
    invalid: '1e3',
    normalized: '14',
    body: {
      max_quantity_increase_percent: 20,
      max_contract_duration_months: 24,
      lead_time_days: 14,
    },
  },
  {
    name: 'wallet',
    Page: Wallet,
    field: 'limitIrR',
    selector: '#online-top-up-limit',
    initial: { limitIrR: 2_000_000_000, version: 0 },
    saved: { limitIrR: 250000, version: 1 },
    raw: ' ۲۵۰٬۰۰۰ ',
    invalid: '12,5',
    normalized: '250000',
    body: { limit_irr: 250000, expected_version: 0 },
  },
  {
    name: 'threshold',
    Page: Threshold,
    field: 'thresholdIrR',
    selector: '#receipt-threshold',
    initial: { thresholdIrR: 100000 },
    saved: { thresholdIrR: 250000 },
    raw: ' ٢٥٠٬٠٠٠ ',
    invalid: '9007199254740992',
    normalized: '250000',
    body: { threshold_irr: 250000 },
  },
] as const;
let host: HTMLDivElement, root: Root, readValue: unknown, failed: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.confirmation = null;
  failed = false;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(readValue, { status: failed ? 503 : 200 }))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function field(selector: string) {
  return host.querySelector<HTMLInputElement>(selector)!;
}
async function fill(selector: string, raw: string) {
  await act(async () => {
    const input = field(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, raw);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('form')?.getAttribute('aria-busy')).not.toBe('true');
  });
}
async function reload() {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /^(Refresh|Reload current value|Retry loading threshold)$/.test(b.textContent!.trim())
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
for (const item of cases) {
  it.each(['en', 'fa'] as const)(
    `${item.name}: raw validation and owned API errors focus the retained draft (%s)`,
    async (locale) => {
      harness.locale = locale;
      readValue = item.initial;
      await act(async () => root.render(<QueryProvider>{<item.Page />}</QueryProvider>));
      await fill(item.selector, item.invalid);
      await submit();
      expect(harness.confirmation).toBeNull();
      expect(field(item.selector).value).toBe(item.invalid);
      await vi.waitFor(() => expect(document.activeElement).toBe(field(item.selector)));
      expect(field(item.selector).getAttribute('aria-invalid')).toBe('true');
      await fill(item.selector, item.raw);
      await submit();
      const command = harness.confirmation!;
      expect(command.action.body).toEqual(item.body);
      expect(command.action.requiresOtp).toBe(item.name === 'threshold' ? true : undefined);
      expect(field(item.selector).matches(':disabled')).toBe(true);
      await act(async () => {
        expect(command.onValidationError([item.field, 'actorUserId'])).toBe(false);
        expect(command.onValidationError([item.field])).toBe(true);
        command.onClose();
      });
      await vi.waitFor(() => expect(document.activeElement).toBe(field(item.selector)));
      expect(field(item.selector).value).toBe(item.raw);
      expect(field(item.selector).matches(':disabled')).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );
  it(`${item.name}: failed and unchanged reads preserve raw edits; changed settings reset them`, async () => {
    readValue = item.initial;
    await act(async () => root.render(<QueryProvider>{<item.Page />}</QueryProvider>));
    await fill(item.selector, item.raw);
    failed = true;
    await reload();
    expect(field(item.selector).value).toBe(item.raw);
    expect(field(item.selector).matches(':disabled')).toBe(true);
    failed = false;
    await reload();
    expect(field(item.selector).value).toBe(item.raw);
    expect(field(item.selector).matches(':disabled')).toBe(false);
    readValue = item.saved;
    await reload();
    expect(field(item.selector).value).toBe(item.normalized);
  });
  it(`${item.name}: uncertain receipts require cancellation and recovery; saved status clears on editing`, async () => {
    readValue = item.initial;
    await act(async () => root.render(<QueryProvider>{<item.Page />}</QueryProvider>));
    await fill(item.selector, item.raw);
    await submit();
    await act(async () =>
      expect(harness.confirmation!.onSuccess(item.initial)).rejects.toThrow('acknowledgement')
    );
    expect(harness.confirmation!.confirmationDisabled).toBe(true);
    await act(async () => harness.confirmation!.onClose());
    expect(field(item.selector).value).toBe(item.raw);
    expect(field(item.selector).matches(':disabled')).toBe(true);
    await reload();
    await submit();
    readValue = item.saved;
    await act(async () => harness.confirmation!.onSuccess(item.saved));
    expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await fill(item.selector, '2');
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
}
it('wallet: a newer version with the same amount replaces an unsaved draft and cannot reuse an old receipt', async () => {
  readValue = cases[1].initial;
  await act(async () => root.render(<QueryProvider>{<Wallet />}</QueryProvider>));
  await fill('#online-top-up-limit', '250000');
  await submit();
  const old = harness.confirmation!;
  await act(async () => old.onClose());
  readValue = { limitIrR: 2_000_000_000, version: 1 };
  await reload();
  expect(field('#online-top-up-limit').value).toBe('2000000000');
  await fill('#online-top-up-limit', '300000');
  await submit();
  expect(harness.confirmation!.action.body).toEqual({ limit_irr: 300000, expected_version: 1 });
  await act(async () => {
    await old.onSuccess(cases[1].saved);
    old.onClose();
  });
  expect(host.querySelector('[data-testid="confirmation"]')).not.toBeNull();
  expect(field('#online-top-up-limit').value).toBe('300000');
  await act(async () =>
    expect(harness.confirmation!.onSuccess({ limitIrR: 300000, version: 1 })).rejects.toThrow(
      'acknowledgement'
    )
  );
  expect(harness.confirmation!.confirmationDisabled).toBe(true);
});
