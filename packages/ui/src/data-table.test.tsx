import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CardListView, DataTable, type ColumnDef } from './components/base-ui/data-table';

type Row = { id: string; value: number | string | Date | null };
const columns: ColumnDef<Row>[] = [
  { id: 'value', header: 'Value', accessorKey: 'value', cell: (row) => row.id },
];
const keyExtractor = (row: Row) => row.id;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const rows = () => [...container.querySelectorAll('tbody tr')].map((row) => row.textContent);
async function click(selector: string) {
  const element = container.querySelector<HTMLButtonElement>(selector);
  expect(element).not.toBeNull();
  await act(async () => element!.click());
}

for (const [kind, values] of [
  ['number', [10, 2]],
  ['natural text', ['item10', 'item2']],
  ['date', [new Date('2026-02-01'), new Date('2026-01-01')]],
] as const) {
  it(`sorts ${kind} values in both directions, keeps null last, then restores input order`, async () => {
    const data: Row[] = [
      { id: 'missing', value: null },
      { id: 'high', value: values[0] },
      { id: 'low', value: values[1] },
      { id: 'also missing', value: null },
    ];
    const onSortChange = vi.fn();
    await act(async () =>
      root.render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={keyExtractor}
          onSortChange={onSortChange}
        />
      )
    );
    await click('thead button');
    expect(rows()).toEqual(['low', 'high', 'missing', 'also missing']);
    expect(container.querySelector('th')?.getAttribute('aria-sort')).toBe('ascending');
    await click('thead button');
    expect(rows()).toEqual(['high', 'low', 'missing', 'also missing']);
    expect(container.querySelector('th')?.getAttribute('aria-sort')).toBe('descending');
    await click('thead button');
    expect(rows()).toEqual(data.map((row) => row.id));
    expect(onSortChange.mock.calls).toEqual([
      [{ column: 'value', direction: 'asc' }],
      [{ column: 'value', direction: 'desc' }],
      [null],
    ]);
    expect(data.map((row) => row.id)).toEqual(['missing', 'high', 'low', 'also missing']);
  });
}

it('does not reorder rows when table sorting is disabled, even with initial sort props', async () => {
  const data: Row[] = [
    { id: 'high', value: 2 },
    { id: 'low', value: 1 },
  ];
  await act(async () =>
    root.render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={keyExtractor}
        sortable={false}
        initialSortColumn="value"
        initialSortDirection="asc"
      />
    )
  );
  expect(rows()).toEqual(['high', 'low']);
  expect(container.querySelector('thead button')).toBeNull();
  expect(container.querySelector('th')?.hasAttribute('aria-sort')).toBe(false);
});

it('keeps native row headers and an opt-in named keyboard scrolling viewport', async () => {
  await act(async () =>
    root.render(
      <DataTable
        data={[{ id: 'Model <script>literal</script>', value: 12 }]}
        keyExtractor={keyExtractor}
        scrollLabel="Model catalogue"
        columns={[
          { ...columns[0]!, rowHeader: true },
          { id: 'amount', header: 'Amount', cell: (row) => <button>{String(row.value)}</button> },
        ]}
        sortable={false}
      />
    )
  );
  const region = container.querySelector<HTMLElement>('[role="region"]');
  expect(region?.getAttribute('aria-label')).toBe('Model catalogue');
  expect(region?.tabIndex).toBe(0);
  region?.focus();
  expect(document.activeElement).toBe(region);
  const header = container.querySelector('tbody th');
  expect(header?.getAttribute('scope')).toBe('row');
  expect(header?.textContent).toBe('Model <script>literal</script>');
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('tbody td')?.textContent).toBe('12');
  expect(container.querySelector('tbody td')?.hasAttribute('scope')).toBe(false);
  const scroll = vi.fn();
  Object.defineProperty(region, 'scrollBy', { value: scroll });
  await act(async () => {
    region!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ left: 80 });
  await act(async () => {
    region!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })
    );
    container
      .querySelector('tbody button')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  });
  expect(scroll).toHaveBeenCalledTimes(1);
});

it('selects visible rows without removing selections on other pages', async () => {
  const data: Row[] = [
    { id: 'one', value: 1 },
    { id: 'two', value: 2 },
  ];
  const onSelectionChange = vi.fn();
  const selected = new Set<string | number>(['other page', 'one']);
  const render = async (selectedRows: Set<string | number>) =>
    act(async () =>
      root.render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={keyExtractor}
          selectable
          selectedRows={selectedRows}
          onSelectionChange={onSelectionChange}
        />
      )
    );
  await render(selected);
  expect(container.querySelector('thead [role="checkbox"]')?.getAttribute('aria-checked')).toBe(
    'mixed'
  );
  await click('thead [role="checkbox"]');
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['other page', 'one', 'two']));
  expect(selected).toEqual(new Set(['other page', 'one']));
  await render(new Set(['other page', 'one', 'two']));
  await click('thead [role="checkbox"]');
  expect(onSelectionChange).toHaveBeenLastCalledWith(new Set(['other page']));
});

it('tracks uncontrolled row toggles and disables selection while loading', async () => {
  const data: Row[] = [{ id: 'one', value: 1 }];
  await act(async () =>
    root.render(<DataTable columns={columns} data={data} keyExtractor={keyExtractor} selectable />)
  );
  await click('tbody [role="checkbox"]');
  expect(container.querySelector('tbody tr')?.getAttribute('aria-selected')).toBe('true');
  await click('tbody [role="checkbox"]');
  expect(container.querySelector('tbody tr')?.getAttribute('aria-selected')).toBe('false');
  await act(async () =>
    root.render(
      <DataTable columns={columns} data={data} keyExtractor={keyExtractor} selectable loading />
    )
  );
  expect(container.querySelector('table')?.getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('thead [role="checkbox"]')?.getAttribute('aria-disabled')).toBe(
    'true'
  );
  expect(container.querySelector('tbody [role="checkbox"]')).toBeNull();
});

it('binds details to stable row keys through sorting and respects ineligible rows', async () => {
  const data: Row[] = [
    { id: 'high', value: 2 },
    { id: 'low', value: 1 },
  ];
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={keyExtractor}
        selectable
        rowLabel={(row) => row.id}
        canExpandRow={(row) => row.id === 'high'}
        renderExpandedRow={(row) => <p>Details {row.id}</p>}
        onExpansionChange={changed}
      />
    )
  );
  expect(container.querySelectorAll('[aria-expanded]')).toHaveLength(1);
  await click('[aria-label="Show details for high"]');
  const trigger = container.querySelector('[aria-label="Hide details for high"]')!;
  const id = trigger.getAttribute('aria-controls');
  expect(document.getElementById(id!)?.textContent).toBe('Details high');
  expect(document.getElementById(id!)?.closest('td')?.getAttribute('colspan')).toBe('3');
  await click('[data-table-sort]');
  expect(rows()).toEqual(['low', 'high', 'Details high']);
  expect(
    container.querySelector('[aria-label="Hide details for high"]')?.getAttribute('aria-controls')
  ).toBe(id);
  expect(changed).toHaveBeenCalledExactlyOnceWith(new Set(['high']));
  await click('[aria-label="Hide details for high"]');
  expect(document.getElementById(id!)).toBeNull();
});

it('controlled expansions retain other-page keys without mutating the caller', async () => {
  const data: Row[] = [{ id: 'one', value: 1 }];
  const selected = new Set<string | number>(['other page']);
  const changed = vi.fn();
  const render = async (expandedRows: Set<string | number>, loading = false) =>
    act(async () =>
      root.render(
        <DataTable
          columns={columns}
          data={data}
          keyExtractor={keyExtractor}
          expandedRows={expandedRows}
          onExpansionChange={changed}
          renderExpandedRow={(row) => <p>Details {row.id}</p>}
          loading={loading}
        />
      )
    );
  await render(selected);
  await click('[aria-expanded]');
  expect(changed).toHaveBeenLastCalledWith(new Set(['other page', 'one']));
  expect(selected).toEqual(new Set(['other page']));
  expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
  await render(new Set(['other page', 'one']));
  await click('[aria-expanded]');
  expect(changed).toHaveBeenLastCalledWith(new Set(['other page']));
  await render(new Set(['one']), true);
  expect(container.querySelector('[aria-expanded]')).toBeNull();
});

it('sort controls support logical arrows, Home and End without sorting or hijacking Tab', async () => {
  const changed = vi.fn();
  const cols: ColumnDef<Row>[] = [
    { ...columns[0]!, id: 'first' },
    { ...columns[0]!, id: 'second' },
  ];
  await act(async () =>
    root.render(
      <DataTable
        locale="fa"
        columns={cols}
        data={[]}
        keyExtractor={keyExtractor}
        onSortChange={changed}
      />
    )
  );
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-table-sort]')];
  buttons[0]!.focus();
  const press = (key: string) =>
    buttons
      .find((b) => b === document.activeElement)!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await act(async () => {
    press('ArrowLeft');
  });
  expect(document.activeElement).toBe(buttons[1]);
  await act(async () => {
    press('Home');
  });
  expect(document.activeElement).toBe(buttons[0]);
  await act(async () => {
    press('End');
  });
  expect(document.activeElement).toBe(buttons[1]);
  expect(press('Tab')).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it('mobile and table renderers share order, selection and expansion with distinct disclosure IDs', async () => {
  const data: Row[] = [
    { id: 'two', value: 2 },
    { id: 'one', value: 1 },
  ];
  await act(async () =>
    root.render(
      <DataTable
        columns={columns}
        data={data}
        keyExtractor={keyExtractor}
        renderCard={(row) => <p>Card {row.id}</p>}
        renderExpandedRow={(row) => <p>Details {row.id}</p>}
        rowLabel={(row) => row.id}
        selectable
      />
    )
  );
  const cards = container.querySelector('[data-slot="card-list-view"]')!;
  await click('[data-slot="card-list-view"] [aria-label="Show details for two"]');
  const disclosures = [...container.querySelectorAll('[aria-label="Hide details for two"]')];
  expect(disclosures).toHaveLength(2);
  const ids = disclosures.map((e) => e.getAttribute('aria-controls'));
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(document.getElementById(id!)?.textContent).toBe('Details two');
  await click('[data-slot="card-list-view"] [role="checkbox"]');
  expect(container.querySelector('tbody [role="checkbox"]')?.getAttribute('aria-checked')).toBe(
    'true'
  );
  await click('thead [data-table-sort]');
  expect(cards.firstElementChild?.textContent).toContain('Card one');
  expect(cards.lastElementChild?.textContent).toContain('Details two');
  expect(container.querySelector('thead')?.className).toContain('sticky');
});

it('standalone cards describe loading/empty states without invoking private row renderers', async () => {
  const renderCard = vi.fn(() => 'Private row');
  const render = (loading: boolean) =>
    act(async () =>
      root.render(
        <CardListView
          locale="fa"
          data={[{ id: 'one' }]}
          keyExtractor={(row) => row.id}
          renderCard={renderCard}
          loading={loading}
        />
      )
    );
  await render(true);
  expect(container.textContent).toContain('در حال بارگذاری');
  expect(renderCard).not.toHaveBeenCalled();
  await act(async () =>
    root.render(
      <CardListView locale="fa" data={[]} keyExtractor={keyExtractor} renderCard={renderCard} />
    )
  );
  expect(container.textContent).toContain('نتیجه‌ای یافت نشد');
  expect(container.querySelector('ol')?.getAttribute('dir')).toBe('rtl');
  expect(renderCard).not.toHaveBeenCalled();
});
