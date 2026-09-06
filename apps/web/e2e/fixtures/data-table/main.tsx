import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from '../../../../../packages/ui/src/components/base-ui/data-table';

const rows = [
  { id: 'b', name: 'Beta', fixed: 'Kept B' },
  { id: 'a', name: 'Alpha', fixed: 'Kept A' },
];
function Fixture() {
  const [selected, setSelected] = React.useState<Set<string | number>>(new Set());
  const [sortEvents, setSortEvents] = React.useState(0);
  const [selectionEvents, setSelectionEvents] = React.useState(0);
  const controlled = !new URLSearchParams(location.search).has('uncontrolled');
  return (
    <main>
      <button onClick={() => setSelected(new Set(['a']))}>Select Alpha externally</button>
      <button onClick={() => setSelected(new Set())}>Clear externally</button>
      <DataTable
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
        data={rows}
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
