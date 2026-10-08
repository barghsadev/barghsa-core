import { QueryProvider, QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { act } from 'react';
import { refreshProfileContext } from '../lib/profile-context.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { WalletPage } from './WalletPage.js';

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
type ReceiptUploadModule = typeof import('../lib/invoice-bank-receipt-upload.js');
vi.mock('../lib/invoice-bank-receipt-upload.js', async (importOriginal) => ({
  ...(await importOriginal<ReceiptUploadModule>()),
  uploadInvoiceReceiptAttachment: upload,
}));
const json = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const PROFILE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const review = {
  schemaVersion: 1,
  scope: {
    action: 'wallet.online-topup-initiation',
    profileId: PROFILE_ID,
    resourceId: PROFILE_ID,
  },
  data: {
    profileId: PROFILE_ID,
    amountIrR: '250',
    onlineTopUpLimitIrR: '1000',
    configVersion: 0,
    paymentSource: 'external_gateway',
    stateAfterInitiation: 'Pending',
    creditRule: 'after_verified_gateway_payment',
  },
  hash: 'a'.repeat(64),
};
const receiptReview = {
  schemaVersion: 1,
  scope: {
    action: 'wallet.bank-receipt-topup-submission',
    profileId: PROFILE_ID,
    resourceId: PROFILE_ID,
  },
  data: {
    profileId: PROFILE_ID,
    amountIrR: '250',
    paymentDate: '2026-01-01',
    payerReference: 'BANK-1',
    attachmentKey: 'receipts/file.pdf',
    fileName: 'receipt.pdf',
    fileSizeBytes: '7',
    customerNote: null,
    stateAfterSubmission: 'Pending',
    creditRule: 'after_finance_confirmation',
  },
  hash: 'b'.repeat(64),
};
let host: HTMLDivElement, root: Root;
type ResponseMock = Mock<() => Promise<ReturnType<typeof json>>>;
let profiles: ResponseMock, wallet: ResponseMock, post: ResponseMock;
let reviewPost: ResponseMock | null;
let receiptReviewPost: ResponseMock;
let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  profiles = vi.fn().mockResolvedValue(json({ activeProfileId: PROFILE_ID }));
  wallet = vi
    .fn()
    .mockResolvedValue(json({ balance: '100', currency: 'IRR', onlineTopUpLimit: 1000 }));
  post = vi.fn().mockResolvedValue(json({}));
  reviewPost = null;
  receiptReviewPost = vi.fn().mockResolvedValue(json(receiptReview));
  upload.mockReset().mockResolvedValue('receipts/file.pdf');
  assign = vi.fn();
  vi.stubGlobal('location', { assign, href: 'http://localhost/' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/top-ups/review'))
        return reviewPost ? reviewPost() : post();
      if (init?.method === 'POST' && url.endsWith('/bank-receipt-top-ups/review'))
        return receiptReviewPost();
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
  await act(async () =>
    root.render(
      <QueryProvider>
        <WalletPage />
      </QueryProvider>
    )
  );
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
  for (
    let attempt = 0;
    attempt < 30 &&
    !element(receipt ? 'wallet-receipt-error' : 'wallet-error') &&
    !document.querySelector('[role="dialog"]') &&
    !host.querySelector('[aria-invalid=true]');
    attempt++
  ) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}
async function confirmReceipt() {
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (button) => button.textContent?.includes('Confirm and submit receipt')
  );
  expect(confirm).toBeDefined();
  await act(async () => confirm!.click());
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

it.each(['', '0', '9007199254740993', '1e3', '0x10', '1.5'])(
  'rejects invalid online amount %s before posting',
  async (amount) => {
    await render();
    await input('wallet-amount', amount);
    await submit();
    expect(element<HTMLInputElement>('wallet-amount').getAttribute('aria-invalid')).toBe('true');
    expect(element('wallet-amount').closest('form')?.textContent).toContain('positive whole-rial');
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
  expect(host.querySelector('[role=alert]')?.textContent).toBeTruthy();
  expect(assign).not.toHaveBeenCalled();
  expect(element<HTMLButtonElement>('wallet-submit').disabled).toBe(false);
});

it.each(['not a url', 'https://user:pass@pay.test/', 'http://pay.test/', ''])(
  'refuses unsafe redirect %s',
  async (redirectUrl) => {
    reviewPost = vi.fn().mockResolvedValue(json(review));
    post.mockResolvedValue(json({ redirectUrl }, 201));
    await render();
    await input('wallet-amount', '250');
    await submit();
    for (let attempt = 0; attempt < 10 && !document.querySelector('[role="dialog"]'); attempt++) {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent?.includes('Confirm'));
    expect(confirm).toBeDefined();
    await act(async () => confirm!.click());
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
  expect(host.querySelector('[role=alert]')?.textContent).toBeTruthy();
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
  expect(element('wallet-receipt-form').querySelector('[role=alert]')?.textContent).toBeTruthy();
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
  await confirmReceipt();
  expect(element('wallet-receipt-error').textContent).toBeTruthy();
  expect(element('wallet-receipt-success')).toBeNull();
});

it('retains successful receipt confirmation when the subsequent balance reload fails', async () => {
  post.mockResolvedValue(
    json({ transactionId: 'receipt-1', state: 'Pending', amount: '250' }, 201)
  );
  await render();
  await receiptFields();
  wallet.mockResolvedValue(json({}, 503));
  await submit(true);
  await confirmReceipt();
  expect(element('wallet-receipt-success').textContent).toContain('pending finance confirmation');
  expect(element('wallet-balance').textContent).toContain('100');
});

it('does not create a Pending receipt when the server review rejects it', async () => {
  receiptReviewPost.mockResolvedValue(json({}, 409));
  await render();
  await receiptFields();
  await submit(true);
  expect(element('wallet-receipt-error').textContent).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('renders an explicitly returned non-IRR currency without relabeling it', async () => {
  wallet.mockResolvedValue(json({ balance: '100', currency: 'USD', onlineTopUpLimit: 1000 }));
  await render();
  expect(element('wallet-balance').textContent).toContain('USD');
});

it.each(['review', 'confirm'] as const)(
  'recovers an owned receipt field error during %s using the existing upload',
  async (stage) => {
    const failure = json(
      {
        error: {
          code: 'VALIDATION:INPUT:INVALID',
          fields: ['payerReference'],
          message: 'private server text',
        },
      },
      400
    );
    if (stage === 'review') receiptReviewPost.mockResolvedValueOnce(failure);
    else post.mockResolvedValueOnce(failure);
    post.mockResolvedValue(json({ transactionId: 'tx-1', state: 'Pending', amount: '250' }, 201));
    await render();
    await receiptFields();
    await submit(true);
    if (stage === 'confirm') await confirmReceipt();
    await act(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    const payer = element<HTMLInputElement>('wallet-receipt-payer-ref');
    expect(payer.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(payer);
    expect(host.textContent).not.toContain('private server text');
    expect(element<HTMLInputElement>('wallet-receipt-file').files?.[0]?.name).toBe('receipt.pdf');
    await input('wallet-receipt-payer-ref', 'BANK-2');
    receiptReviewPost.mockResolvedValue(
      json({ ...receiptReview, data: { ...receiptReview.data, payerReference: 'BANK-2' } })
    );
    await submit(true);
    await confirmReceipt();
    expect(element('wallet-receipt-success')).not.toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
  }
);
it('ignores receipt metadata with unknown protected fields', async () => {
  receiptReviewPost.mockResolvedValue(
    json(
      {
        error: {
          code: 'VALIDATION:INPUT:INVALID',
          fields: ['payerReference', 'idempotencyKey'],
          message: 'private server text',
        },
      },
      400
    )
  );
  await render();
  await receiptFields();
  await submit(true);
  expect(element('wallet-receipt-error')).not.toBeNull();
  expect(element('wallet-receipt-payer-ref').getAttribute('aria-invalid')).toBeNull();
  expect(host.textContent).not.toContain('private server text');
});
it('ignores an upload belonging to the previous active profile', async () => {
  let finish!: (key: string) => void;
  upload.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await receiptFields();
  await act(async () =>
    element<HTMLFormElement>('wallet-receipt-form').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
  );
  await act(async () => refreshProfileContext());
  expect(element<HTMLInputElement>('wallet-receipt-amount').value).toBe('');
  await act(async () => finish('old-scope-key'));
  expect(receiptReviewPost).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it('locks repeated online submits before validation and review finish', async () => {
  let finish!: (response: ReturnType<typeof json>) => void;
  reviewPost = vi.fn().mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await input('wallet-amount', '250');
  await act(async () => {
    const form = element('wallet-amount').closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(element<HTMLButtonElement>('wallet-submit').disabled).toBe(true);
  expect(element<HTMLButtonElement>('wallet-submit').getAttribute('aria-busy')).toBe('true');
  expect(reviewPost).toHaveBeenCalledTimes(1);
  await act(async () => finish(json(review)));
  expect(post).not.toHaveBeenCalled();
});
it('does not open an obsolete online review after the active profile changes', async () => {
  let finish!: (response: ReturnType<typeof json>) => void;
  reviewPost = vi.fn().mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await render();
  await input('wallet-amount', '250');
  await act(async () =>
    element('wallet-amount')
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await act(async () => refreshProfileContext());
  await act(async () => finish(json(review)));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(element<HTMLInputElement>('wallet-amount').value).toBe('');
  expect(post).not.toHaveBeenCalled();
});

it('rejects numeric wallet money before rendering or enabling financial commands', async () => {
  wallet.mockResolvedValue(
    json(JSON.parse('{"balance":9007199254740993,"currency":"IRR","onlineTopUpLimit":1000}'))
  );
  await render();
  expect(host.querySelector('[data-testid=wallet-balance]')).toBeNull();
  expect(host.querySelector('[data-testid=wallet-amount]')).toBeNull();
  expect(host.querySelector('[data-testid=wallet-error]')).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('keeps failed wallet reads manual and cancels the explicit retry balance transport on unmount', async () => {
  profiles.mockResolvedValueOnce(json({}, 503));
  let signal!: AbortSignal, finish!: (value: ReturnType<typeof json>) => void;
  wallet.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/wallet/' + PROFILE_ID) signal = init?.signal as AbortSignal;
      return originalFetch(input, init);
    })
  );
  await render();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(profiles).toHaveBeenCalledTimes(1);
  const retry = [...host.querySelectorAll('button')].find(
    (button) => button.textContent === 'Try again'
  )!;
  expect(retry).toBeDefined();
  await act(async () => retry.click());
  expect(profiles).toHaveBeenCalledTimes(2);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal.aborted).toBe(false);
  await act(async () => root.unmount());
  expect(signal.aborted).toBe(true);
  await act(async () => finish(json({ balance: '100', currency: 'IRR', onlineTopUpLimit: 1000 })));
  expect(host.textContent).toBe('');
  expect(post).not.toHaveBeenCalled();
});

it('abandons old account authority before loading a wallet for its late profile', async () => {
  let signal!: AbortSignal, finish!: (value: ReturnType<typeof json>) => void;
  profiles.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/profiles' && profiles.mock.calls.length === 0)
        signal = init?.signal as AbortSignal;
      return originalFetch(input, init);
    })
  );
  const actor = async (id: string) =>
    act(async () =>
      root.render(
        <QueryComponentProvider>
          <AccountUserProvider value={id}>
            <WalletPage />
          </AccountUserProvider>
        </QueryComponentProvider>
      )
    );
  await actor('buyer');
  expect(signal.aborted).toBe(false);
  await actor('other-buyer');
  expect(signal.aborted).toBe(true);
  await act(async () => finish(json({ activeProfileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })));
  expect(element('wallet-balance').textContent).toContain('100');
  expect(profiles).toHaveBeenCalledTimes(2);
  expect(
    vi
      .mocked(globalThis.fetch)
      .mock.calls.some(([url]) => String(url).includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))
  ).toBe(false);
  expect(post).not.toHaveBeenCalled();
});

it('withdraws wallet command controls after current balance authority is denied', async () => {
  wallet.mockResolvedValue(json({}, 403));
  await render();
  expect(host.querySelector('[data-testid=wallet-balance]')).toBeNull();
  expect(host.querySelector('[data-testid=wallet-amount]')).toBeNull();
  expect(host.querySelector('[data-testid=wallet-receipt-form]')).toBeNull();
  expect(host.querySelector('[data-testid=wallet-error]')).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
});
