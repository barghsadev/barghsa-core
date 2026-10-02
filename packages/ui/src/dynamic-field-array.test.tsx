import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DynamicFieldArray } from './components/ui/dynamic-field-array';

let host: HTMLDivElement, root: Root;
const changed = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  changed.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
type Item = { id: string; name: string; error?: string };
function Example({
  disabled = false,
  minItems = 0,
  maxItems = 3,
  reorder = true,
  initial = [
    { id: 'a', name: 'First', error: 'Check first row' },
    { id: 'b', name: 'Second' },
  ] as Item[],
}: {
  disabled?: boolean;
  minItems?: number;
  maxItems?: number;
  reorder?: boolean;
  initial?: Item[];
}) {
  const [items, setItems] = useState(initial);
  return (
    <form>
      <DynamicFieldArray<Item>
        dir="rtl"
        value={items}
        getItemKey={(item) => item.id}
        onChange={(next) => {
          changed(next);
          setItems(next);
        }}
        createItem={() => ({ id: 'new', name: '' })}
        addLabel="Add row"
        removeLabel={(item) => `Remove ${item.id}`}
        moveUpLabel={(item) => `Up ${item.id}`}
        moveDownLabel={(item) => `Down ${item.id}`}
        getItemError={(item) => item.error}
        disabled={disabled}
        minItems={minItems}
        maxItems={maxItems}
        reorder={reorder}
        renderItem={(item, _index, actions) => (
          <fieldset disabled={disabled}>
            <label>
              {item.id}
              <input aria-label={item.id} required defaultValue={item.name} />
            </label>
            {actions}
          </fieldset>
        )}
      />
    </form>
  );
}
const button = (name: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const add = () =>
  [...host.querySelectorAll('button')].find((item) => item.textContent === 'Add row')!;
it('moves complete rows without remounting fields, losing edits or moving their errors to another item', async () => {
  await act(async () => root.render(<Example />));
  const field = host.querySelector<HTMLInputElement>('input[aria-label=a]')!;
  field.value = 'Retained edit';
  await act(async () => button('Down a').click());
  expect(
    [...host.querySelectorAll('input')].map((item) => item.getAttribute('aria-label'))
  ).toEqual(['b', 'a']);
  expect(host.querySelector('input[aria-label=a]')).toBe(field);
  expect(field.value).toBe('Retained edit');
  expect(
    host.querySelector('[role=alert]')?.closest('[role=listitem]')?.querySelector('input')
  ).toBe(field);
  expect(document.activeElement).toBe(button('Up a'));
  expect(changed.mock.lastCall?.[0].map((item: Item) => item.id)).toEqual(['b', 'a']);
});
it('keeps remove and reorder controls bounded and preserves the original item objects', async () => {
  const original = [
    { id: 'a', name: 'First' },
    { id: 'b', name: 'Second' },
  ];
  await act(async () => root.render(<Example initial={original} minItems={1} maxItems={2} />));
  expect(button('Up a').disabled).toBe(true);
  expect(button('Down b').disabled).toBe(true);
  expect(add().disabled).toBe(true);
  await act(async () => button('Remove a').click());
  expect(changed.mock.lastCall?.[0][0]).toBe(original[1]);
  expect(original).toHaveLength(2);
  expect(button('Remove b').disabled).toBe(true);
  expect(document.activeElement).toBe(host.querySelector('input'));
});
it('focuses added fields and leaves their native required validation with the form', async () => {
  await act(async () => root.render(<Example initial={[]} />));
  await act(async () => add().click());
  const field = host.querySelector<HTMLInputElement>('input')!;
  expect(document.activeElement).toBe(field);
  expect(field.checkValidity()).toBe(false);
  await act(async () => button('Remove new').click());
  expect(document.activeElement).toBe(add());
  expect(host.querySelectorAll('[role=listitem]')).toHaveLength(0);
});
it('prevents every array mutation while the owning transaction is locked', async () => {
  await act(async () => root.render(<Example disabled />));
  for (const action of host.querySelectorAll('button')) {
    expect(action.disabled).toBe(true);
    await act(async () => action.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
  expect(changed).not.toHaveBeenCalled();
});
it('can turn off ordering for lists where only membership matters', async () => {
  await act(async () => root.render(<Example reorder={false} />));
  expect(host.querySelector('[data-array-action=up]')).toBeNull();
  expect(host.querySelector('[data-array-action=down]')).toBeNull();
  await act(async () => button('Remove a').click());
  expect(changed.mock.lastCall?.[0].map((item: Item) => item.id)).toEqual(['b']);
});
