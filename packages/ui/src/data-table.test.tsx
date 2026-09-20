import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataTable, type ColumnDef } from './components/base-ui/data-table';

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
