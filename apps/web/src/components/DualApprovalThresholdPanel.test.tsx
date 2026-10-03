import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import DualApprovalThresholdPanel from './DualApprovalThresholdPanel.js';
import type { TeamAction } from './TeamActionDialog.js';

interface Confirmation {
  action: TeamAction;
  onClose: () => void;
  onDenied: () => void;
  onSuccess: (result: unknown) => Promise<void>;
  onValidationError: (fields: unknown[]) => boolean;
}
const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  confirmation: null as Confirmation | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: (props: Confirmation) => {
    harness.confirmation = props;
    return <div data-testid="threshold-confirmation">{props.action.description}</div>;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.locale = 'en';
  harness.confirmation = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ thresholdIrR: 100000 }))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(key = 'threshold') {
  await act(async () => root.render(<DualApprovalThresholdPanel key={key} />));
}
function field() {
  return host.querySelector<HTMLInputElement>('#receipt-threshold')!;
}
async function fill(raw: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), raw);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(times = 1) {
  await act(async () => {
    for (let index = 0; index < times; index++)
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector('form')?.getAttribute('aria-busy')).not.toBe('true');
  });
}
async function focusFrame() {
  await act(
    async () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}
function message() {
  return t('admin.receiptThreshold.invalid', harness.locale);
}
function linkedError() {
  const ids = field().getAttribute('aria-describedby')!.split(' ');
  return ids
    .map((id) => document.getElementById(id))
    .find((node) => node?.getAttribute('role') === 'alert');
}

it.each(['', ' ', '-10', '1e3', '12.5', '12,5', '9007199254740992', 'NaN'])(
  'retains and focuses invalid threshold %j without opening a financial command',
  async (raw) => {
    await render();
    await fill(raw);
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await submit();
    await vi.waitFor(() => expect(field().getAttribute('aria-invalid')).toBe('true'));
    expect(linkedError()?.textContent).toBe(message());
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field().value).toBe(raw);
    expect(harness.confirmation).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

it.each(['en', 'fa'] as const)(
  'validates on touch and clears localized feedback on correction (%s)',
  async (locale) => {
    harness.locale = locale;
    await render();
    await fill('-1');
    expect(linkedError()).toBeUndefined();
    await act(async () => {
      field().focus();
      field().blur();
    });
    await vi.waitFor(() => expect(linkedError()?.textContent).toBe(message()));
    await fill('۲۵۰٬۰۰۰');
    await vi.waitFor(() => expect(linkedError()).toBeUndefined());
    expect(field().value).toBe('۲۵۰٬۰۰۰');
    expect(field().getAttribute('aria-invalid')).toBeNull();
  }
);

it.each([
  ['۰', 0],
  ['1', 1],
  ['250,000', 250000],
  ['۲۵۰٬۰۰۰', 250000],
  ['٢٥٠٬٠٠٠', 250000],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
] as const)('captures exact IRR %s with OTP and locks duplicate submits', async (raw, value) => {
  await render();
  await fill(raw);
  await submit(2);
  expect(harness.confirmation?.action).toMatchObject({
    path: '/api/admin/config/dual-approval-threshold',
    method: 'PUT',
    body: { threshold_irr: value },
    requiresOtp: true,
  });
  const captured = harness.confirmation!.action;
  expect(field().matches(':disabled')).toBe(true);
  expect(host.querySelector('button[type="submit"]')?.matches(':disabled')).toBe(true);
  await submit(2);
  expect(harness.confirmation!.action).toBe(captured);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('returns owned server validation to the retained raw draft and focuses the enabled field', async () => {
  await render();
  await fill(' ۲۵۰٬۰۰۰ ');
  await submit();
  await act(async () => {
    expect(harness.confirmation!.onValidationError(['thresholdIrR'])).toBe(true);
    harness.confirmation!.onClose();
  });
  await focusFrame();
  expect(field().value).toBe(' ۲۵۰٬۰۰۰ ');
  expect(field().matches(':disabled')).toBe(false);
  expect(document.activeElement).toBe(field());
  expect(linkedError()?.textContent).toBe(message());
  expect(host.querySelector('[data-testid="threshold-confirmation"]')).toBeNull();
  await fill('300000');
  await submit();
  expect(harness.confirmation!.action.body).toEqual({ threshold_irr: 300000 });
});

it.each(
  [[], ['thresholdIrR', 'actorUserId'], ['threshold_irr'], ['constructor'], [null]].map(
    (fields) => ({ fields })
  )
)(
  'keeps unowned or mixed metadata %j inside confirmation without field errors',
  async ({ fields }) => {
    await render();
    await fill('250000');
    await submit();
    await act(async () => expect(harness.confirmation!.onValidationError(fields)).toBe(false));
    expect(linkedError()).toBeUndefined();
    expect(host.querySelector('[data-testid="threshold-confirmation"]')).not.toBeNull();
    expect(field().value).toBe('250000');
  }
);

it.each([null, {}, { thresholdIrR: '250000' }, { thresholdIrR: 250001 }])(
  'rejects malformed or mismatched acknowledgement %j without clearing the reviewed draft',
  async (result) => {
    await render();
    await fill('۲۵۰٬۰۰۰');
    await submit();
    await act(async () =>
      expect(harness.confirmation!.onSuccess(result)).rejects.toThrow(
        'Unverified catalogue acknowledgement'
      )
    );
    expect(field().value).toBe('۲۵۰٬۰۰۰');
    expect(host.textContent).not.toContain(t('admin.receiptThreshold.saved', 'en'));
    expect(host.querySelector('[data-testid="threshold-confirmation"]')).not.toBeNull();
    vi.mocked(fetch).mockImplementation(async () => Response.json({ thresholdIrR: 250000 }));
    await act(async () => {
      await harness.confirmation!.onSuccess({ thresholdIrR: 250000 });
      harness.confirmation!.onClose();
    });
    expect(field().value).toBe('250000');
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      t('admin.receiptThreshold.saved', 'en')
    );
  }
);

it('ignores callbacks from a cancelled proposal after a new proposal is captured', async () => {
  await render();
  await fill('250000');
  await submit();
  const old = harness.confirmation!;
  await act(async () => old.onClose());
  await fill('300000');
  await submit();
  const next = harness.confirmation!;
  await act(async () => {
    await old.onSuccess({ thresholdIrR: 250000 });
    expect(old.onValidationError(['thresholdIrR'])).toBe(false);
    old.onDenied();
    old.onClose();
  });
  expect(field().value).toBe('300000');
  expect(harness.confirmation!.action).toBe(next.action);
  expect(host.querySelector('[data-testid="threshold-confirmation"]')).not.toBeNull();
  expect(host.textContent).not.toContain(t('admin.receiptThreshold.saved', 'en'));
});

it('clears private work on command denial and ignores late acknowledgement', async () => {
  await render();
  await fill('250000');
  await submit();
  const old = harness.confirmation!;
  await act(async () => old.onDenied());
  expect(host.textContent).toBe('');
  await act(async () => {
    await old.onSuccess({ thresholdIrR: 250000 });
    old.onClose();
    expect(old.onValidationError(['thresholdIrR'])).toBe(false);
  });
  expect(host.textContent).toBe('');
});

it('ignores old command callbacks after the threshold workspace is replaced', async () => {
  await render();
  await fill('250000');
  await submit();
  const old = harness.confirmation!;
  await render('replacement');
  await fill('300000');
  await act(async () => {
    await old.onSuccess({ thresholdIrR: 250000 });
    old.onClose();
    old.onDenied();
    expect(old.onValidationError(['thresholdIrR'])).toBe(false);
  });
  expect(field().value).toBe('300000');
  expect(field().matches(':disabled')).toBe(false);
  expect(host.textContent).not.toContain(t('admin.receiptThreshold.saved', 'en'));
});

it.each([401, 403])('hides the private editor on denied threshold read %s', async (status) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ thresholdIrR: 100000 }, { status }))
  );
  await render();
  expect(host.textContent).toBe('');
});

it('ignores a late read from a replaced workspace', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(Response.json({ thresholdIrR: 300000 }));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await render('replacement');
  await fill('400000');
  await act(async () => finish(Response.json({ thresholdIrR: 100000 })));
  expect(field().value).toBe('400000');
});
