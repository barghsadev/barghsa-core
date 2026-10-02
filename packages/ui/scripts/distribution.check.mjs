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
      import { DirectionProvider } from '@barghsa/ui/direction-provider';
      import { useZodForm, FormField } from '@barghsa/ui/form';
      import type { FormInputProps, FormTextareaProps, FormPhoneInputProps, FormSelectProps, FormCheckboxProps, FormSwitchProps, FormRadioGroupProps, FormComboboxProps, FormSliderProps, FormDatePickerProps, FormDateRangePickerProps } from '@barghsa/ui/form';
      import { z } from 'zod';
      import { createElement } from 'react';
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
