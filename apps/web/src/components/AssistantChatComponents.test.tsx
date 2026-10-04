import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import {
  ChatInput,
  ChatMessage,
  ChatPromptSuggestions,
  ChatWelcome,
} from './AssistantChatComponents.js';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mountInput(overrides: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  await act(async () =>
    root.render(
      <form noValidate>
        <ChatInput
          label="Message"
          sendLabel="Send"
          busy={false}
          disabled={false}
          textareaProps={{ id: 'test-input', value: 'Draft', onChange: () => {} }}
          {...overrides}
        />
      </form>
    )
  );
}
async function key(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...options,
  });
  await act(async () => host.querySelector('textarea')!.dispatchEvent(event));
  return event;
}
it('submits through the owning form while preserving newline, IME composition and legacy composition keys', async () => {
  await mountInput();
  const submit = vi
    .spyOn(host.querySelector('form')!, 'requestSubmit')
    .mockImplementation(() => {});
  expect((await key({ shiftKey: true })).defaultPrevented).toBe(false);
  expect((await key({ isComposing: true })).defaultPrevented).toBe(false);
  expect((await key({ keyCode: 229 })).defaultPrevented).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect((await key()).defaultPrevented).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
});
it('blocks keyboard submits when sending is disabled or busy, without clearing an editable cooldown draft', async () => {
  await mountInput({ disabled: true });
  const submit = vi
    .spyOn(host.querySelector('form')!, 'requestSubmit')
    .mockImplementation(() => {});
  expect((await key()).defaultPrevented).toBe(true);
  expect(host.querySelector('textarea')!.disabled).toBe(false);
  expect(host.querySelector('textarea')!.value).toBe('Draft');
  await mountInput({ busy: true });
  await key();
  expect(host.querySelector('textarea')!.disabled).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});
it('forwards the registered field ref, respects a parent key veto, and bounds resizing until the input is visible', async () => {
  const ref = vi.fn();
  const textareaProps = {
    id: 'test-input',
    value: 'Draft',
    onChange: () => {},
    ref,
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => event.preventDefault(),
  };
  await mountInput({ textareaProps });
  const input = host.querySelector('textarea')!;
  expect(ref).toHaveBeenCalledWith(input);
  const submit = vi
    .spyOn(host.querySelector('form')!, 'requestSubmit')
    .mockImplementation(() => {});
  await key();
  expect(submit).not.toHaveBeenCalled();
  Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 500 });
  await mountInput({ textareaProps: { ...textareaProps, value: 'Long draft' } });
  expect(input.style.height).toBe('240px');
  Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 120 });
  await mountInput({ active: false, textareaProps: { ...textareaProps, value: 'Hidden draft' } });
  expect(input.style.height).toBe('240px');
  await mountInput({ active: true, textareaProps: { ...textareaProps, value: 'Hidden draft' } });
  expect(input.style.height).toBe('120px');
});
it('keeps public sources and timestamps literal without exposing unrelated metadata', async () => {
  const timestamp = '2026-10-01T22:30:00Z',
    format = vi.fn(() => 'Recorded account-zone time');
  const knowledge = {
    sources: [
      {
        kbId: 'kb',
        title: '<img src=x>',
        documentTitle: 'Guide.txt',
        excerpt: '<script>private()</script>',
      },
    ],
    policyChecks: [{ type: 'content_filter' as const, count: 1 }],
    privateRules: ['Private authored rules'],
  };
  await act(async () =>
    root.render(
      <ChatMessage
        sender="assistant"
        locale="en"
        message="<a href=javascript:private()>Reply</a>"
        knowledge={knowledge}
        timestamp={timestamp}
        timestampLabel="Answered at"
        formatTimestamp={format}
      />
    )
  );
  expect(host.querySelector('img,script,a')).toBeNull();
  expect(host.textContent).toContain('<script>private()</script>');
  expect(host.textContent).not.toContain('Private authored rules');
  expect(host.querySelector('time')!.dateTime).toBe(timestamp);
  expect(format).toHaveBeenCalledWith(timestamp);
  expect(host.querySelector('article')!.getAttribute('aria-label')).toBe('AI message');
});
it('keeps legacy time and policy metadata unavailable, and distinguishes an empty policy list', async () => {
  const format = vi.fn(() => 'Invented time');
  const base = {
    sender: 'assistant' as const,
    locale: 'en' as const,
    message: 'Reply',
    timestamp: null,
    timestampLabel: 'Answered at',
    formatTimestamp: format,
  };
  await act(async () =>
    root.render(<ChatMessage {...base} knowledge={{ sources: [], policyChecks: null }} />)
  );
  expect(host.textContent).toContain(t('assistant.timeUnrecorded', 'en'));
  expect(host.textContent).toContain(t('assistant.policies.unrecorded', 'en'));
  expect(host.querySelector('time')).toBeNull();
  expect(format).not.toHaveBeenCalled();
  await act(async () =>
    root.render(<ChatMessage {...base} knowledge={{ sources: [], policyChecks: [] }} />)
  );
  expect(host.textContent).toContain(t('assistant.policies.none', 'en'));
  expect(host.textContent).not.toContain(t('assistant.policies.unrecorded', 'en'));
  await act(async () => root.render(<ChatMessage {...base} />));
  expect(host.textContent).toContain('AI message');
  expect(host.textContent).not.toContain(t('assistant.answer', 'en'));
});
it('welcome prompts remain explicit non-submitting buttons and stop selection while locked', async () => {
  const pick = vi.fn();
  const render = (disabled: boolean) => (
    <form>
      <ChatWelcome
        greeting="Hi <Customer>"
        description="How can we help?"
        profileContext="Individual profile"
      >
        <ChatPromptSuggestions
          label="Suggestions"
          suggestions={[{ key: 'support', label: 'Get support' }]}
          disabled={disabled}
          onPick={pick}
          disclosureRef={null}
        />
      </ChatWelcome>
    </form>
  );
  await act(async () => root.render(render(false)));
  const button = host.querySelector('button')!;
  expect(button.type).toBe('button');
  await act(async () => button.click());
  expect(pick).toHaveBeenCalledWith('support');
  expect(host.textContent).toContain('Hi <Customer>');
  expect(host.querySelector('Customer')).toBeNull();
  await act(async () => root.render(render(true)));
  await act(async () => button.click());
  expect(pick).toHaveBeenCalledTimes(1);
});
it('labels a direct account receipt separately from AI answers and uses its actual receive time', async () => {
  const receivedAt = '2026-10-04T15:01:00Z';
  await act(async () =>
    root.render(
      <ChatMessage
        sender="account"
        locale="en"
        timestamp={receivedAt}
        timestampLabel="Received at"
        formatTimestamp={() => 'Verified receipt time'}
      >
        <p>Current wallet balance</p>
      </ChatMessage>
    )
  );
  expect(host.querySelector('article')!.getAttribute('aria-label')).toBe('Direct account status');
  expect(host.querySelector('time')!.dateTime).toBe(receivedAt);
  expect(host.textContent).toContain('Current wallet balance');
  expect(host.textContent).not.toContain(t('assistant.answer', 'en'));
});
