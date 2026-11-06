import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ListPage } from './components/ui/list-page';
import { ListToolbar } from './components/ui/list-toolbar';
import { TextFilter } from './components/ui/text-filter';
import { ListFilterPanel } from './components/ui/list-filter-panel';

it('shows clear-all controls only for applied filters, including inside the drawer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (count: number) =>
    act(async () =>
      root.render(
        <ListFilterPanel
          activeCount={count}
          countLabel={String(count)}
          onClear={vi.fn()}
          labels={{
            filters: 'Filters',
            clear: 'Clear all',
            activeCount: `${count} active filters`,
            selected: 'Selected filters',
            remove: 'Remove {filter}',
          }}
          drawer={{
            dir: 'ltr',
            onOpen: vi.fn(),
            onApply: vi.fn(),
            labels: {
              apply: 'Apply',
              cancel: 'Cancel',
              close: 'Close',
              description: 'Choose filters',
            },
          }}
        >
          <input aria-label="Search filter" />
        </ListFilterPanel>
      )
    );
  const clearButtons = () =>
    [...document.querySelectorAll('button')].filter((button) => button.textContent === 'Clear all');
  try {
    await render(0);
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(clearButtons()).toHaveLength(0);
    await render(2);
    expect(clearButtons()).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Clear all');
    await render(0);
    expect(clearButtons()).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('keeps accepted content mounted through page loading and errors, then replaces it for a new empty scope', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const mounted = vi.fn();
  function Rows() {
    useEffect(mounted, []);
    return <input aria-label="Existing row" defaultValue="untouched" />;
  }
  const render = (loading: boolean, error: boolean, retainContent: boolean) =>
    act(async () =>
      root.render(
        <ListPage>
          <ListPage.Content
            loading={loading}
            error={error}
            empty={!retainContent}
            retainContent={retainContent}
            loadingView={<p role="status">Loading</p>}
            errorView={<button>Retry</button>}
            emptyView="No items"
          >
            <Rows />
          </ListPage.Content>
        </ListPage>
      )
    );
  try {
    await render(false, false, true);
    const input = host.querySelector('input')!;
    input.value = 'draft';
    await render(true, false, true);
    expect(host.querySelector('input')).toBe(input);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Loading');
    await render(false, true, true);
    expect(host.querySelector('input')?.value).toBe('draft');
    expect(host.querySelector('button')?.textContent).toBe('Retry');
    expect(mounted).toHaveBeenCalledOnce();
    await render(false, false, false);
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).toBe('No items');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('cursor controls retain their label, suppress duplicate loads and disappear at exhaustion', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const next = vi.fn();
  const render = (loading: boolean, hasMore = true) =>
    act(async () =>
      root.render(
        <ListPage.Pagination
          kind="cursor"
          hasMore={hasMore}
          loading={loading}
          onNext={next}
          label="History pages"
          nextLabel="Older rows"
        />
      )
    );
  try {
    await render(true);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe('Older rows');
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(next).not.toHaveBeenCalled();
    await render(false);
    await act(async () => host.querySelector('button')!.click());
    expect(next).toHaveBeenCalledOnce();
    await render(false, false);
    expect(host.querySelector('nav')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('toolbar composition keeps the standalone search debounce and native keyboard controls', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const change = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ListToolbar
          search={<TextFilter value="" onChange={change} label="Search" />}
          sort={
            <select aria-label="Sort">
              <option>Newest</option>
            </select>
          }
          filters={<button>Filters</button>}
          actions={<button>Create</button>}
        />
      )
    );
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        ' latest '
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(299);
    });
    expect(change).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300));
    expect(change).toHaveBeenCalledExactlyOnceWith('latest');
    expect(host.querySelectorAll('button')).toHaveLength(2);
    expect(host.querySelector('select')?.getAttribute('aria-label')).toBe('Sort');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('cursor back/next controls keep a last page navigable and block both while busy', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const previous = vi.fn(),
    next = vi.fn();
  const render = (loading: boolean) =>
    act(async () =>
      root.render(
        <ListPage.Pagination
          kind="cursor"
          hasMore={false}
          loading={loading}
          onNext={next}
          label="History pages"
          nextLabel="Next"
          previous={{ enabled: true, label: 'Previous', onClick: previous }}
        />
      )
    );
  try {
    await render(true);
    const buttons = host.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[1]!.disabled).toBe(true);
    await act(async () => buttons[0]!.click());
    expect(previous).not.toHaveBeenCalled();
    await render(false);
    await act(async () => host.querySelector('button')!.click());
    expect(previous).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button')[1]!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
