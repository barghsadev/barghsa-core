import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { WalletPage } from './WalletPage.js';

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../hooks/useReceiptAttachmentUpload.js', () => ({
  useReceiptAttachmentUpload: () => upload,
}));
const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
let host: HTMLDivElement, root: Root;
type ResponseMock = Mock<() => Promise<ReturnType<typeof json>>>;
let profiles: ResponseMock, wallet: ResponseMock, post: ResponseMock;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  profiles = vi.fn().mockResolvedValue(json({ activeProfileId: 'profile-a' }));
  wallet = vi
    .fn()
    .mockResolvedValue(json({ balance: '100', currency: 'IRR', onlineTopUpLimit: 1000 }));
  post = vi.fn().mockResolvedValue(json({}));
  upload.mockReset().mockResolvedValue('receipts/file.pdf');
  assign = vi.fn();
  vi.stubGlobal('location', { assign, href: 'http://localhost/' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return post();
      if (url === '/api/profiles') return profiles();
      if (url.includes('/transactions')) return json({ transactions: [], nextCursor: null });
      return wallet();
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const element = <T extends Element>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
async function render() {
  await act(async () => root.render(<WalletPage />));
}
async function input(id: string, value: string) {
  await act(async () => {
    const el = element<HTMLInputElement>(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(receipt = false) {
  const form = receipt
    ? element<HTMLFormElement>('wallet-receipt-form')
    : element<HTMLInputElement>('wallet-amount').closest('form')!;
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function receiptFields({
  amount = '250',
  date = '2026-01-01',
  payer = 'BANK-1',
  type = 'application/pdf',
} = {}) {
  await input('wallet-receipt-amount', amount);
  await input('wallet-receipt-date', date);
  await input('wallet-receipt-payer-ref', payer);
  await act(async () => {
    const el = element<HTMLInputElement>('wallet-receipt-file');
    Object.defineProperty(el, 'files', {
      configurable: true,
      value: [new File(['receipt'], 'receipt.pdf', { type })],
    });
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it.each(['profiles', 'wallet', 'network'])(
  'shows a recoverable load failure for %s',
  async (failure) => {
    if (failure === 'profiles') profiles.mockResolvedValue(json({}, 503));
    if (failure === 'wallet') wallet.mockResolvedValue(json({}, 503));
    if (failure === 'network') profiles.mockRejectedValue(new Error('offline'));
    await render();
    expect(element('wallet-error').textContent).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  }
);

it.each(['', '0', '9007199254740993'])(
  'rejects invalid online amount %s before posting',
  async (amount) => {
    await render();
    await input('wallet-amount', amount);
    await submit();
    expect(element('wallet-error').textContent).toContain('positive whole-rial');
    expect(post).not.toHaveBeenCalled();
  }
);

it.each([
  [409, { message: 'Conflict' }],
  [502, { message: 'Unavailable' }],
  [504, { error: { message: 'Timeout' } }],
  [400, { error: { message: 'Amount exceeds limit', onlineTopUpLimit: 100, configVersion: 2 } }],
  [400, { message: 'Invalid amount' }],
  [500, null],
  [500, { error: {} }],
  [400, { message: 'exceeds' }],
] as const)('handles online rejection %s with %j without redirecting', async (status, body) => {
  post.mockResolvedValue(json(body, status));
  await render();
  await input('wallet-amount', '250');
  await submit();
  expect(element('wallet-error').textContent).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  expect(element<HTMLButtonElement>('wallet-submit').disabled).toBe(false);
});

it.each(['not a url', 'https://user:pass@pay.test/', 'http://pay.test/', ''])(
  'refuses unsafe redirect %s',
  async (redirectUrl) => {
    post.mockResolvedValue(json({ redirectUrl }, 201));
    await render();
    await input('wallet-amount', '250');
    await submit();
    expect(element('wallet-error').textContent).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  }
);

it.each(['network', 'json'])('recovers from online %s failure', async (failure) => {
  if (failure === 'network') post.mockRejectedValue(new Error('offline'));
  else
    post.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('invalid JSON');
      },
    });
  await render();
  await input('wallet-amount', '250');
  await submit();
  expect(element('wallet-error').textContent).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
});

it.each([
  { amount: '0' },
  { date: '' },
  { date: '2999-01-01' },
  { payer: ' ' },
  { type: 'text/plain' },
])('validates receipt fields %j before uploading', async (fields) => {
  await render();
  await receiptFields(fields);
  await submit(true);
  expect(element('wallet-receipt-error').textContent).toBeTruthy();
  expect(upload).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it.each(['empty', 'throw'])('handles %s attachment upload failure', async (failure) => {
  if (failure === 'empty') upload.mockResolvedValue(null);
  else upload.mockRejectedValue(new Error('offline'));
  await render();
  await receiptFields();
  await submit(true);
  expect(element('wallet-receipt-error').textContent).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it.each([
  [409, { state: 'Pending', amount: '250' }],
  [400, {}],
  [500, {}],
  [201, { state: 'Completed', amount: '250' }],
  [201, { state: 'Pending', amount: '251' }],
] as const)('does not report receipt success for %s %j', async (status, body) => {
  post.mockResolvedValue(json(body, status));
  await render();
  await receiptFields();
  await submit(true);
  expect(element('wallet-receipt-error').textContent).toBeTruthy();
  expect(element('wallet-receipt-success')).toBeNull();
});

it('retains successful receipt confirmation when the subsequent balance reload fails', async () => {
  post.mockResolvedValue(json({ state: 'Pending', amount: '250' }, 201));
  await render();
  await receiptFields();
  wallet.mockResolvedValue(json({}, 503));
  await submit(true);
  expect(element('wallet-receipt-success').textContent).toContain('pending finance confirmation');
  expect(element('wallet-balance').textContent).toContain('100');
});

it('renders an explicitly returned non-IRR currency without relabeling it', async () => {
  wallet.mockResolvedValue(json({ balance: '100', currency: 'USD', onlineTopUpLimit: 1000 }));
  await render();
  expect(element('wallet-balance').textContent).toContain('USD');
});
