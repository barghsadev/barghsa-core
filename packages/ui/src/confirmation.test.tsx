import { act, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DestructiveConfirmDialog, FinancialConfirmDialog } from './components/ui/confirm-dialog';
import { ConfirmProvider, useConfirm } from './components/ui/use-confirm';

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function button(label: string) {
  return [...document.querySelectorAll('button')].find((item) => item.textContent === label)!;
}
async function fill(value: string) {
  await act(async () => {
    const input = document.querySelector('input:not([type=hidden])')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const copy = {
  title: 'Remove resource',
  description: 'Permanent change',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
};

it('withdraws typed approval on target change, including a return to the previous target', async () => {
  const confirm = vi.fn();
  const render = (scope: string) =>
    act(async () =>
      root.render(
        <DestructiveConfirmDialog
          {...copy}
          scope={scope}
          open
          onCancel={() => {}}
          onConfirm={confirm}
          confirmation={{ phrase: 'REMOVE', label: 'Type REMOVE' }}
        />
      )
    );
  await render('one');
  await fill('remove');
  expect(button('Confirm').disabled).toBe(true);
  await fill('REMOVE');
  expect(button('Confirm').disabled).toBe(false);
  await render('two');
  expect(button('Confirm').disabled).toBe(true);
  await render('one');
  expect(button('Confirm').disabled).toBe(true);
  await act(async () => button('Confirm').click());
  expect(confirm).not.toHaveBeenCalled();
});

it('requires financial acknowledgement and the destructive phrase together, preserving exact money', async () => {
  const confirm = vi.fn();
  const render = (scope: string, loading = false) =>
    act(async () =>
      root.render(
        <FinancialConfirmDialog
          {...copy}
          scope={scope}
          open
          destructive
          loading={loading}
          acknowledgement="I understand"
          confirmation={{ phrase: 'تأیید', label: 'عبارت تأیید' }}
          onCancel={() => {}}
          onConfirm={confirm}
        >
          <p>9,007,199,254,740,993 IRR · 900,719,925,474,099.3 toman</p>
        </FinancialConfirmDialog>
      )
    );
  await render('hash-one');
  await fill('تأیید');
  expect(button('Confirm').disabled).toBe(true);
  await act(async () => document.querySelector<HTMLElement>('[role=checkbox]')!.click());
  expect(button('Confirm').disabled).toBe(false);
  expect(document.body.textContent).toContain('900,719,925,474,099.3 toman');
  await render('hash-one', true);
  await act(async () => button('Confirm').click());
  expect(confirm).not.toHaveBeenCalled();
  await render('hash-two');
  expect(button('Confirm').disabled).toBe(true);
  expect(document.querySelector('[role=checkbox]')?.getAttribute('aria-checked')).toBe('false');
});

it('invalidates changed phrase requirements and refuses an empty phrase', async () => {
  const render = (phrase: string) =>
    act(async () =>
      root.render(
        <DestructiveConfirmDialog
          {...copy}
          open
          onCancel={() => {}}
          onConfirm={() => {}}
          confirmation={{ phrase, label: 'Type the current phrase' }}
        />
      )
    );
  await render('ONE');
  await fill('ONE');
  expect(button('Confirm').disabled).toBe(false);
  await render('TWO');
  expect(button('Confirm').disabled).toBe(true);
  await render('');
  expect(button('Confirm').disabled).toBe(true);
});

it('settles one inline question, cancels overlap and never accepts an unmounted caller', async () => {
  let ask!: ReturnType<typeof useConfirm>;
  function Caller() {
    ask = useConfirm();
    return null;
  }
  await act(async () =>
    root.render(
      <ConfirmProvider>
        <Caller />
      </ConfirmProvider>
    )
  );
  let first!: Promise<boolean>;
  await act(async () => {
    first = ask(copy);
  });
  expect(await ask(copy)).toBe(false);
  await act(async () => button('Cancel').click());
  expect(await first).toBe(false);
  await act(async () => {
    first = ask(copy);
  });
  await act(async () => button('Confirm').click());
  expect(await first).toBe(true);
  await act(async () => {
    first = ask(copy);
  });
  await act(async () => root.render(<ConfirmProvider>{null}</ConfirmProvider>));
  expect(await first).toBe(false);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(await ask(copy)).toBe(false);
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

it('cancels the visible question when its authorization scope changes', async () => {
  let ask!: ReturnType<typeof useConfirm>;
  function Caller({ scope }: { scope: string }) {
    ask = useConfirm(scope);
    return null;
  }
  const render = (scope: string) =>
    act(async () =>
      root.render(
        <ConfirmProvider>
          <Caller scope={scope} />
        </ConfirmProvider>
      )
    );
  await render('profile-one');
  let result!: Promise<boolean>;
  await act(async () => {
    result = ask(copy);
  });
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  await render('profile-two');
  expect(await result).toBe(false);
  expect(document.querySelector('[role=dialog]')).toBeNull();
});

it('accepts a mounted StrictMode caller after its initial effect rehearsal', async () => {
  let ask!: ReturnType<typeof useConfirm>;
  function Caller() {
    ask = useConfirm('owner');
    return null;
  }
  await act(async () =>
    root.render(
      <StrictMode>
        <ConfirmProvider>
          <Caller />
        </ConfirmProvider>
      </StrictMode>
    )
  );
  let result!: Promise<boolean>;
  await act(async () => {
    result = ask(copy);
  });
  await act(async () => button('Confirm').click());
  expect(await result).toBe(true);
});

it('finishes restoring dialog focus before a caller focuses write feedback', async () => {
  function Caller() {
    const confirm = useConfirm();
    const feedback = useRef<HTMLInputElement>(null);
    return (
      <>
        <button
          onClick={async () => {
            if (await confirm(copy)) feedback.current?.focus();
          }}
        >
          Start
        </button>
        <input ref={feedback} aria-label="Owned field feedback" />
      </>
    );
  }
  await act(async () =>
    root.render(
      <ConfirmProvider>
        <Caller />
      </ConfirmProvider>
    )
  );
  await act(async () => button('Start').click());
  await act(async () => button('Confirm').click());
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Owned field feedback');
});
