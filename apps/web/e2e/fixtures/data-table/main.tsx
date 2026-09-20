import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from '../../../../../packages/ui/src/components/base-ui/data-table';

const rows = [
  { id: 'b', name: 'Beta', fixed: 'Kept B' },
  { id: 'a', name: 'Alpha', fixed: 'Kept A' },
];
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [locale, setLocale] = React.useState<'en' | 'fa'>(
    params.get('locale') === 'fa' ? 'fa' : 'en'
  );
  const [sortable, setSortable] = React.useState(!params.has('no-sort'));
  const [mode, setMode] = React.useState(params.get('state') ?? 'rows');
  const [selected, setSelected] = React.useState<Set<string | number>>(new Set());
  const [sortEvents, setSortEvents] = React.useState(0);
  const [selectionEvents, setSelectionEvents] = React.useState(0);
  const controlled = !new URLSearchParams(location.search).has('uncontrolled');
  return (
    <main>
      <button onClick={() => setSelected(new Set(['a']))}>Select Alpha externally</button>
      <button onClick={() => setSelected(new Set())}>Clear externally</button>
      <button onClick={() => setLocale((value) => (value === 'en' ? 'fa' : 'en'))}>
        Switch language
      </button>
      <button onClick={() => setMode('loading')}>Show loading</button>
      <button onClick={() => setMode('empty')}>Show empty</button>
      <button onClick={() => setMode('rows')}>Show rows</button>
      <button onClick={() => setSortable((value) => !value)}>Toggle sorting</button>
      <DataTable
        sortable={sortable}
        {...(params.has('initial-sort')
          ? { initialSortColumn: 'name', initialSortDirection: 'asc' as const }
          : {})}
        locale={locale}
        {...(params.has('latin') ? { numerals: 'latn' as const } : {})}
        loading={mode === 'loading'}
        columns={[
          { id: 'name', header: 'Name', accessorKey: 'name' },
          {
            id: 'fixed',
            header: 'Fixed column',
            accessorKey: 'fixed',
            enableHiding: false,
            sortable: false,
          },
        ]}
        data={mode === 'empty' ? [] : rows}
        keyExtractor={(row) => row.id}
        selectable
        {...(controlled ? { selectedRows: selected } : {})}
        onSelectionChange={(value) => {
          setSelected(value);
          setSelectionEvents((count) => count + 1);
        }}
        onSortChange={() => setSortEvents((count) => count + 1)}
      />
      <output aria-label="Sort events">{sortEvents}</output>
      <output aria-label="Selection events">{selectionEvents}</output>
      <output aria-label="Selected keys">{[...selected].sort().join(',')}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>
);
