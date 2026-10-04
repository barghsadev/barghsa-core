import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CatalogueRecordTable } from './CatalogueRecordTable.js';
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ numberStyle: 'western' }),
}));
interface RecordRow {
  id: string;
  title: string;
  description: string;
  count?: number;
}
const rows: RecordRow[] = [
  { id: 'z', title: 'Zeta <script>literal</script>', description: '<b>Description</b>', count: 12 },
  { id: 'a', title: 'Alpha', description: '', count: 0 },
];
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
  vi.unstubAllGlobals();
});
const render = (data: RecordRow[], onPick = (_id: string) => {}, locked = false) =>
  act(async () =>
    root.render(
      <CatalogueRecordTable
        locale="fa"
        rows={data}
        caption="Catalogue"
        nameLabel="Name"
        detailsLabel="Details"
        actionsLabel="Actions"
        renderDetails={(row) => <p>{row.count ?? '—'}</p>}
        renderActions={(row) => (
          <button disabled={locked} onClick={() => onPick(row.id)}>
            Open {row.title}
          </button>
        )}
      />
    )
  );
it('preserves the returned order and literal content in both presentations without creating local sorting', async () => {
  await render(rows);
  const titles = [...host.querySelectorAll('tbody h2')].map((node) => node.textContent);
  expect(titles).toEqual(rows.map((row) => row.title));
  expect(host.querySelector('thead button')).toBeNull();
  expect(host.querySelector('script')).toBeNull();
  expect(host.innerHTML).toContain('&lt;b&gt;Description&lt;/b&gt;');
  expect(host.querySelector('[data-slot="card-list-view"]')?.textContent).toContain(rows[0]!.title);
  expect(host.querySelector('[role="status"]')?.textContent).toBe('2 ردیف');
});
it('uses the selected row identity once and honors the owning page action lock in both renderers', async () => {
  const pick = vi.fn();
  await render(rows, pick);
  await act(async () => host.querySelector<HTMLButtonElement>('tbody button')!.click());
  expect(pick).toHaveBeenCalledExactlyOnceWith('z');
  await render(rows, pick, true);
  const controls = [
    ...host.querySelectorAll<HTMLButtonElement>(
      'tbody button, [data-slot="card-list-view"] button'
    ),
  ];
  expect(controls).toHaveLength(4);
  expect(controls.every((button) => button.disabled)).toBe(true);
  await act(async () => controls.forEach((button) => button.click()));
  expect(pick).toHaveBeenCalledTimes(1);
});
it('withdrawn records disappear from both representations and absent metadata stays unavailable', async () => {
  await render([{ id: 'private', title: 'Private row', description: 'Private description' }]);
  expect(host.querySelector('tbody')?.textContent).toContain('—');
  await render([]);
  expect(host.textContent).not.toContain('Private');
  expect(host.querySelector('tbody button')).toBeNull();
  expect(host.querySelector('[data-slot="card-list-view"] button')).toBeNull();
});
