import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountUserProvider } from './useAccountUser.js';
import { useCommandFeedback } from './useCommandFeedback.js';
import { refreshProfileContext } from '../lib/profile-context.js';

const notice = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('../lib/toast-api.js', () => ({ toast: notice }));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  notice.success.mockClear();
  notice.error.mockClear();
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
function Harness({
  success,
  error,
  operation,
}: {
  success: string | null;
  error: string | null;
  operation: string;
}) {
  useCommandFeedback({ success, error, operation });
  return null;
}
async function render(
  success: string | null,
  error: string | null = null,
  owner = 'a',
  operation = 'save'
) {
  await act(async () =>
    root.render(
      <StrictMode>
        <AccountUserProvider value={owner}>
          <Harness success={success} error={error} operation={operation} />
        </AccountUserProvider>
      </StrictMode>
    )
  );
}

it('announces a validated result once across StrictMode and rerenders, then permits a new occurrence', async () => {
  await render(null);
  expect(notice.success).not.toHaveBeenCalled();
  await render('Saved');
  await render('Saved');
  expect(notice.success).toHaveBeenCalledExactlyOnceWith('Saved');
  await render(null);
  await render('Saved');
  expect(notice.success).toHaveBeenCalledTimes(2);
});

it('prioritizes an unconfirmed failure and never turns it into delayed success', async () => {
  await render(null);
  await render('Saved', 'Not confirmed');
  expect(notice.error).toHaveBeenCalledExactlyOnceWith('Not confirmed');
  expect(notice.success).not.toHaveBeenCalled();
  await render('Saved');
  expect(notice.success).not.toHaveBeenCalled();
});

it('withdraws stale feedback on account and operation changes', async () => {
  await render(null);
  await render('Old result', null, 'b');
  expect(notice.success).not.toHaveBeenCalled();
  await render(null, null, 'b');
  await render('Current result', null, 'b');
  expect(notice.success).toHaveBeenCalledExactlyOnceWith('Current result');
  await render('Old target result', null, 'b', 'different-target');
  expect(notice.success).toHaveBeenCalledTimes(1);
});

it('profile or locale changes do not announce stale or merely translated outcomes', async () => {
  await render(null);
  await render('Saved');
  await act(async () => refreshProfileContext());
  await render('Old profile result');
  expect(notice.success).toHaveBeenCalledTimes(1);
  await act(async () => {
    document.documentElement.lang = 'fa';
  });
  await render('ذخیره شد');
  expect(notice.success).toHaveBeenCalledTimes(1);
});

it('does not announce a new success while an existing error remains unresolved', async () => {
  await render(null);
  await render(null, 'Not confirmed');
  await render('Saved', 'Not confirmed');
  expect(notice.error).toHaveBeenCalledExactlyOnceWith('Not confirmed');
  expect(notice.success).not.toHaveBeenCalled();
});
