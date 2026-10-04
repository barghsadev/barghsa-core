import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
for (const path of [
  '@barghsa/ui',
  '@barghsa/ui/direction-provider',
  '@barghsa/ui/sonner',
  '@barghsa/ui/form',
]) {
  test(`${path} loads matching ESM and CommonJS exports`, async () => {
    assert.deepEqual(Object.keys(await import(path)).sort(), Object.keys(require(path)).sort());
  });
}
for (const format of ['import', 'require']) {
  test(`${format} components render with the consumer's React runtime`, async () => {
    const ui = format === 'import' ? await import('@barghsa/ui') : require('@barghsa/ui');
    assert.match(
      renderToStaticMarkup(createElement(ui.PageLoading, { label: 'Loading' })),
      /role="status"/
    );
    assert.match(
      renderToStaticMarkup(
        createElement(ui.EmptyState, {
          title: 'No invoices',
          description: 'Complete a purchase first.',
        })
      ),
      /No invoices/
    );
  });
}
test('ESM and CommonJS consumers resolve strict public prop types', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scratch = mkdtempSync(join(root, '.distribution-'));
  try {
    const source = `
      import type { EmptyStateProps, ErrorBoundaryProps } from '@barghsa/ui';
      import { DataTable, CardListView, TextCell, NumberCell, DateCell, CurrencyCell, StatusCell, AvatarCell, ActionCell, LinkCell } from '@barghsa/ui';
      import type { DataTableProps, CardListViewProps, CellAction } from '@barghsa/ui';
      import { DirectionProvider } from '@barghsa/ui/direction-provider';
      import { useZodForm, FormField } from '@barghsa/ui/form';
      import type { FormInputProps, FormTextareaProps, FormPhoneInputProps, FormSelectProps, FormCheckboxProps, FormSwitchProps, FormRadioGroupProps, FormComboboxProps, FormSliderProps, FormDatePickerProps, FormDateRangePickerProps, FormStepProps } from '@barghsa/ui/form';
      import { z } from 'zod';
      import { createElement } from 'react';
      interface CatalogueRow { id: string; amount: string }
      const table: DataTableProps<CatalogueRow> = {
        columns: [{ id: 'amount', header: 'Amount', accessorKey: 'amount', rowHeader: true }], data: [], keyExtractor: row => row.id,
        scrollLabel: 'Invoice records',
        caption: 'Invoices', stickyHeader: true, rowLabel: row => row.id,
        renderCard: row => createElement(TextCell, { value: row.amount }),
        renderExpandedRow: row => row.id, canExpandRow: row => !!row.amount,
        expandedRows: new Set(['one']), onExpansionChange: keys => { const selected: Set<string | number> = keys; void selected; },
      };
      const cards: CardListViewProps<{ id: string }> = { data: [], keyExtractor: row => row.id, renderCard: row => row.id };
      const interfaceTable = createElement(DataTable<CatalogueRow>, table);
      // @ts-expect-error Stable row keys cannot be boolean.
      cards.keyExtractor = row => !!row.id;
      const action: CellAction = { id: 'view', label: 'View', onSelect: () => {} };
      const cellDate: Parameters<typeof DateCell>[0] = { value: null, mode: 'relative', format: value => String(value) };
      const currency: Parameters<typeof CurrencyCell>[0] = { amount: '9007199254740993123', format: amount => String(amount) };
      // @ts-expect-error Numbers cannot be ambiguous strings.
      const badNumber: Parameters<typeof NumberCell>[0] = { value: '1.5' };
      void [table, interfaceTable, cards, action, cellDate, currency, badNumber, DataTable, CardListView, TextCell, NumberCell, CurrencyCell, StatusCell, AvatarCell, ActionCell, LinkCell];
      function AddressForm() {
        const form = useZodForm(z.object({ postalCode: z.string().transform(Number) }), {
          defaultValues: { postalCode: '1234567890' },
        });
        form.handleSubmit((values) => { const postal: number = values.postalCode; void postal; });
        form.setValue('postalCode', '2345678901');
        const field: Parameters<typeof FormField<{ postalCode: string }, 'postalCode', { postalCode: number }>>[0] = {
          control: form.control, name: 'postalCode', render: () => createElement('input'),
        };
        void field;
        const input: FormInputProps<{ postalCode: string }, 'postalCode', { postalCode: number }> = {
          control: form.control, name: 'postalCode', label: 'Postal code', inputProps: { inputMode: 'numeric' },
        };
        void input;
        const step: FormStepProps<{ postalCode: string }, { postalCode: number }> = {
          form, fields: ['postalCode'], stepKey: 1,
          onNext: values => { const postal: string = values.postalCode; void postal; },
          onSubmit: values => { const postal: number = values.postalCode; void postal; },
          children: ({ next, submit, pending }) => createElement('button', { disabled: pending, onClick: next }, String(submit)),
        };
        // @ts-expect-error Step field names must use schema input paths.
        step.fields = ['missing'];
        void step;
        // @ts-expect-error Schema input types must survive both public declaration formats.
        form.setValue('postalCode', 123);
        // @ts-expect-error Unknown field names must be rejected.
        form.setValue('missing', '123');
        return form;
      }
      type Values = { text: string; enabled: boolean; choice: string; choices: string[]; number: number; range: number[]; date: Date | null; dates: { from: Date; to?: Date } | null };
      const options = [{ value: 'alpha', label: 'Alpha' }];
      const text: FormInputProps<Values, 'text'> = { name: 'text', label: 'Text' };
      const textarea: FormTextareaProps<Values, 'text'> = { name: 'text', label: 'Notes' };
      const phone: FormPhoneInputProps<Values, 'text'> = text;
      const select: FormSelectProps<Values, 'choice'> = { name: 'choice', label: 'Select', options };
      const checkbox: FormCheckboxProps<Values, 'enabled'> = { name: 'enabled', label: 'Enabled' };
      const toggle: FormSwitchProps<Values, 'enabled'> = { name: 'enabled', label: 'Enabled' };
      const radio: FormRadioGroupProps<Values, 'choice'> = select;
      const combo: FormComboboxProps<Values, 'choice'> = { ...select, emptyMessage: 'None' };
      const multi: FormComboboxProps<Values, 'choices'> = { name: 'choices', label: 'Multi', options, emptyMessage: 'None', multiple: true, removeLabel: label => 'Remove ' + label };
      const slider: FormSliderProps<Values, 'number'> = { name: 'number', label: 'Quantity' };
      const range: FormSliderProps<Values, 'range'> = { name: 'range', label: 'Range', inputProps: { thumbLabels: ['From', 'To'] } };
      const date: FormDatePickerProps<Values, 'date'> = { name: 'date', label: 'Date', inputProps: { locale: 'fa' } };
      const dates: FormDateRangePickerProps<Values, 'dates'> = { name: 'dates', label: 'Dates', inputProps: { timezone: 'Asia/Tehran' } };
      // @ts-expect-error Text adapters cannot bind boolean fields.
      const badText: FormInputProps<Values, 'enabled'> = checkbox;
      // @ts-expect-error Boolean adapters cannot bind text fields.
      const badToggle: FormCheckboxProps<Values, 'text'> = text;
      // @ts-expect-error Date adapters cannot bind text fields.
      const badDate: FormDatePickerProps<Values, 'text'> = text;
      // @ts-expect-error A single combobox cannot bind an array field.
      const badCombo: FormComboboxProps<Values, 'choices'> = { name: 'choices', label: 'Multi', options, emptyMessage: 'None' };
      // @ts-expect-error Callers cannot override the adapter's binding.
      const badBinding: FormInputProps<Values, 'text'> = { name: 'text', label: 'Text', inputProps: { onChange: () => {} } };
      void [text, textarea, phone, select, checkbox, toggle, radio, combo, multi, slider, range, date, dates, badText, badToggle, badDate, badCombo, badBinding];
      const empty: EmptyStateProps = { title: 'None', description: 'Try a different filter.' };
      // @ts-expect-error Required guidance must remain typed.
      const invalid: EmptyStateProps = { title: 123 };
      const retry: ErrorBoundaryProps['onReset'] = () => {};
      void [empty, invalid, retry, DirectionProvider, AddressForm, FormField];
    `;
    for (const extension of ['mts', 'cts'])
      writeFileSync(join(scratch, `consumer.${extension}`), source);
    writeFileSync(
      join(scratch, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        include: ['consumer.mts', 'consumer.cts'],
      })
    );
    for (const compiler of ['tsc', join(root, '../../node_modules/.bin/tsc')]) {
      const result = spawnSync(compiler, ['-p', join(scratch, 'tsconfig.json')], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
